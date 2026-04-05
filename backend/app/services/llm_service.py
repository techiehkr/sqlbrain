import re
import httpx
import json
from typing import AsyncGenerator
import os

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
DEFAULT_SQL_MODEL = "sqlcoder"
DEFAULT_GENERAL_MODEL = "llama3.1"


# ── Dialect rules ─────────────────────────────────────────────────────────────
DIALECT_RULES = {
"mssql": """
MSSQL RULES (strictly follow):
- Use SELECT TOP N, never LIMIT
- Use GETDATE() not NOW()
- Use ISNULL(col, val) or COALESCE
- Use [brackets] around identifiers, NEVER "double quotes" — double quotes cause syntax errors in MSSQL
- Use INFORMATION_SCHEMA for metadata queries
- String concat: col1 + col2 or CONCAT(col1, col2)
- Always use fully qualified table names e.g. schema.TableName
""",
    "postgresql": """
POSTGRESQL RULES (strictly follow):
- Use LIMIT N at end of query
- Use NOW() or CURRENT_TIMESTAMP
- Use COALESCE(col, val)
- Use "double_quotes" for identifiers with spaces
- Use :: for casting: col::INT
- Use ILIKE for case-insensitive LIKE
""",
    "mysql": """
MYSQL RULES (strictly follow):
- Use LIMIT N at end of query
- Use NOW() for current time
- Use IFNULL(col, val)
- Use `backticks` for reserved-word identifiers
""",
    "sqlite": """
SQLITE RULES (strictly follow):
- Use LIMIT N at end of query
- Use datetime('now') for current time
- Use strftime() for date formatting
""",
}

# ── Few-shot SQL examples ─────────────────────────────────────────────────────
FEW_SHOT_EXAMPLES = """
-- Example 1: Count + group
-- Q: How many orders per customer?
SELECT c.name, COUNT(o.id) AS order_count
FROM customers c
JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
ORDER BY order_count DESC;

-- Example 2: Date filter (MSSQL)
-- Q: Sales in the last 30 days
SELECT SUM(amount) AS total_sales, COUNT(*) AS num_orders
FROM orders
WHERE created_at >= DATEADD(day, -30, GETDATE());

-- Example 3: Top N with join (MSSQL)
-- Q: Top 5 products by revenue
SELECT TOP 5 p.name, SUM(oi.quantity * oi.unit_price) AS revenue
FROM order_items oi
JOIN products p ON oi.product_id = p.id
GROUP BY p.id, p.name
ORDER BY revenue DESC;

-- Example 4: Existence check
-- Q: Customers who never placed an order
SELECT c.id, c.name
FROM customers c
WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.customer_id = c.id
);

-- Example 5: Schema metadata (MSSQL)
-- Q: What columns does the users table have?
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'users'
ORDER BY ORDINAL_POSITION;
"""

SQL_SYSTEM_PROMPT = """You are SQLBrain, an expert SQL query generator. You write accurate, optimized, production-ready SQL.

STRICT OUTPUT RULES:
- Return ONLY the raw SQL — no markdown, no backticks, no explanation
- Do NOT include ```sql fences
- Use ONLY the exact table and column names from the schema below — never invent names
- Always use fully qualified table names (schema.TableName) when schema prefix is shown
- Always use table aliases in multi-table queries
- Prefer CTEs over deeply nested subqueries
- Never use SELECT * — always list explicit columns

{dialect_rules}

EXAMPLE QUERIES:
{few_shot_examples}

DATABASE SCHEMA (ONLY these tables are available — do not reference any other tables):
{schema_context}
"""

GENERAL_SYSTEM_PROMPT = """You are SQLBrain, a helpful database assistant built into a SQL tool.
The user is currently connected to a {db_type} database.
Answer all database-related questions directly and confidently.
You are an expert in SQL, database design, normalization, performance tuning, and best practices.

Rules:
- Never say "I cannot be certain" or "without more information" — use the schema and db type provided
- For design/advice questions, give concrete recommendations based on the actual schema
- For concept questions, give clear practical explanations with examples where helpful
- Format in plain text, no markdown headers
- Be concise but complete

CONNECTED DATABASE TYPE: {db_type}

DATABASE SCHEMA:
{schema_context}
"""

ROUTER_PROMPT = """You are a question classifier for a SQL database assistant.
Classify the user's question into exactly ONE category.
Reply with ONLY the category name — nothing else, no punctuation, no explanation.

Categories:
- SQL_GENERATION    → user wants to retrieve, insert, update or delete data
                      ("show me orders", "how many users", "find customers who...",
                       "what are the biggest tables by row count", "find duplicate records",
                       "show orphaned records", "which users have no orders",
                       "find nulls in the email column")

- SCHEMA_QUESTION   → user asks about database structure, design, or metadata
                      ("what columns does X have", "where is password stored",
                       "what tables exist", "is this schema normalized",
                       "what are the foreign keys", "is my schema well designed",
                       "what data types are used", "how are these tables related")

- SQL_EXPLANATION   → user wants a specific query explained or reviewed
                      ("what does this SQL do", "explain this query",
                       "is this query correct", "review my SQL")

- GENERAL_QUESTION  → database concepts, best practices, performance advice, greetings
                      ("how do indexes work", "what is a join", "hi", "thanks",
                       "why is my query slow", "what is normalization",
                       "what db are we using", "how do I improve performance",
                       "what is the difference between LEFT and INNER join",
                       "should I use a view or a CTE")

When in doubt between SQL_GENERATION and GENERAL_QUESTION:
- Does the answer require running a query against the data? → SQL_GENERATION
- Is it a concept, advice, or opinion question? → GENERAL_QUESTION
"""

EXPLAIN_SYSTEM_PROMPT = """You are SQLBrain, an expert SQL analyst.
Explain the given SQL query clearly for a developer.

Format:
1. WHAT IT DOES — plain English summary (2-3 sentences)
2. STEP BY STEP — numbered list of what each clause does
3. PERFORMANCE NOTES — any issues or recommendations

Be concise and practical.
"""

OPTIMIZE_SYSTEM_PROMPT = """You are SQLBrain, an expert SQL optimizer.

Format your response as:
ISSUES FOUND:
- list each issue

OPTIMIZED QUERY:
<the full optimized SQL here, raw, no fences>

CHANGES MADE:
- explain each change and why it helps

{dialect_rules}

DATABASE SCHEMA:
{schema_context}
"""

# ── Synonym map for smarter table matching ────────────────────────────────────
SYNONYMS: dict[str, list[str]] = {
    "user":      ["member", "user", "login", "account", "person", "contact"],
    "member":    ["member", "membership", "user", "account"],
    "login":     ["login", "auth", "session", "user", "member"],
    "order":     ["order", "purchase", "transaction", "sale"],
    "payment":   ["payment", "invoice", "billing", "transaction"],
    "product":   ["product", "item", "inventory", "vehicle", "lot"],
    "address":   ["address", "location", "city", "country"],
    "document":  ["document", "file", "attachment", "verification"],
    "approval":  ["approval", "review", "status"],
    "category":  ["category", "type", "ctrl", "control"],
    "lookup":    ["ctrl", "control", "ref", "reference"],
    "status":    ["ctrl", "status", "state"],
}


class OllamaService:
    def __init__(
        self,
        base_url: str = OLLAMA_BASE_URL,
        sql_model: str = DEFAULT_SQL_MODEL,
        general_model: str = DEFAULT_GENERAL_MODEL,
    ):
        self.base_url = base_url
        self.sql_model = sql_model
        self.general_model = general_model
        self.model = sql_model  # backward-compat alias

    async def is_available(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                return resp.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[str]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                data = resp.json()
                return [m["name"] for m in data.get("models", [])]
        except Exception:
            return []

    async def generate(
        self,
        prompt: str,
        system: str = "",
        model: str | None = None,
        temperature: float = 0.0,
    ) -> str:
        payload = {
            "model": model or self.sql_model,
            "prompt": prompt,
            "system": system,
            "stream": False,
            "options": {
                "temperature": temperature,
                "top_p": 0.95,
                "num_predict": 2048,
                "repeat_penalty": 1.1,
            },
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{self.base_url}/api/generate", json=payload)
            resp.raise_for_status()
            return resp.json().get("response", "")

    async def stream_generate(self, prompt: str, system: str = "") -> AsyncGenerator[str, None]:
        payload = {
            "model": self.sql_model,
            "prompt": prompt,
            "system": system,
            "stream": True,
            "options": {"temperature": 0.0, "top_p": 0.95},
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", f"{self.base_url}/api/generate", json=payload) as resp:
                async for line in resp.aiter_lines():
                    if line:
                        data = json.loads(line)
                        token = data.get("response", "")
                        if token:
                            yield token
                        if data.get("done"):
                            break

    # ── Question router ───────────────────────────────────────────────────────

    async def classify_question(self, question: str) -> str:
        """Use llama3.1 to classify what kind of question this is."""
        raw = await self.generate(
            question,
            ROUTER_PROMPT,
            model=self.general_model,
            temperature=0.1,
        )
        token = raw.strip().upper().split()[0] if raw.strip() else ""
        valid = {"SQL_GENERATION", "SCHEMA_QUESTION", "SQL_EXPLANATION", "GENERAL_QUESTION"}
        return token if token in valid else "GENERAL_QUESTION"

    async def answer_general(self, question: str, schema_context: str, db_type: str) -> str:
        """Answer conversational / conceptual questions using llama3.1."""
        system = GENERAL_SYSTEM_PROMPT.format(db_type=db_type, schema_context=schema_context)
        prompt = f"FACT: The user is connected to a {db_type} database.\n\nQuestion: {question}"
        return await self.generate(prompt, system, model=self.general_model)

    # ── Table candidate scoring ───────────────────────────────────────────────

    def get_table_candidates(
        self,
        question: str,
        schema: dict,
        max_tables: int = 25,
    ) -> list[dict]:
        """
        Score every table in the schema against the question.
        Returns a ranked list of:
          {
            name: str,           # full qualified name e.g. novas.T_Membership
            score: float,        # relevance score
            confident: bool,     # True = pre-check, False = shown unchecked
            row_count: int,
            columns: [...],
            reason: str,         # why this table was selected
          }
        """
        question_lower = question.lower()
        question_words = set(
            re.sub(r"[?'\",.]", "", question_lower).split()
        )

        # Expand with synonyms
        expanded_words: set[str] = set(question_words)
        for word in list(question_words):
            if word in SYNONYMS:
                expanded_words.update(SYNONYMS[word])
            for key, values in SYNONYMS.items():
                if key in word or word in key:
                    expanded_words.update(values)

        # Build FK lookup: table -> set of tables it references
        fk_map: dict[str, set[str]] = {}
        for table in schema.get("tables", []):
            name = table["name"]
            fk_map[name] = {
                fk["references_table"]
                for fk in table.get("foreign_keys", [])
            }

        scored: list[dict] = []

        for table in schema.get("tables", []):
            name = table["name"]
            schema_prefix = table.get("schema", "dbo")
            full_name = (
                f"{schema_prefix}.{name}"
                if schema_prefix and schema_prefix.lower() != "dbo"
                else name
            )
            name_lower = name.lower()
            score: float = 0.0
            reasons: list[str] = []

            # ── Score: table name matches ────────────────────────────────────
            for w in expanded_words:
                if len(w) > 3 and w in name_lower:
                    if w in question_words:
                        score += 3.0   # exact question word in table name
                        reasons.append(f"table name matches '{w}'")
                    else:
                        score += 1.5   # synonym match
                        reasons.append(f"table name matches synonym '{w}'")

            # ── Score: column name matches ───────────────────────────────────
            for col in table.get("columns", []):
                col_lower = col["name"].lower()
                for w in expanded_words:
                    if len(w) > 3 and w in col_lower:
                        if w in question_words:
                            score += 1.0
                            reasons.append(f"column '{col['name']}' matches '{w}'")
                        else:
                            score += 0.4
                        break  # one score per column

            # ── Score: FK small lookup tables ────────────────────────────────
            # Tables referenced by a high-scoring table should be included
            # (will be boosted in second pass below)

            scored.append({
                "name": full_name,
                "base_name": name,
                "score": score,
                "confident": score >= 3.0,
                "row_count": table.get("row_count", 0),
                "columns": table.get("columns", []),
                "foreign_keys": table.get("foreign_keys", []),
                "reason": ", ".join(reasons) if reasons else "low relevance",
            })

        # ── Second pass: boost FK-linked tables ──────────────────────────────
        # If a table scores well, its FK targets (usually small lookup/ctrl tables)
        # get a relevance boost so they appear in the list too
        score_map = {t["base_name"]: t["score"] for t in scored}

        for t in scored:
            base = t["base_name"]
            if score_map.get(base, 0) >= 2.0:
                # This table is relevant — boost its FK targets
                for fk_target in fk_map.get(base, set()):
                    for other in scored:
                        if other["base_name"] == fk_target and other["score"] < 2.0:
                            other["score"] += 1.0
                            other["reason"] += f", FK from {base}"

        # Sort by score descending
        scored.sort(key=lambda x: x["score"], reverse=True)

        # Return top N, but always include score > 0
        result = [t for t in scored if t["score"] > 0][:max_tables]

        # Clean up internal field
        for t in result:
            del t["base_name"]

        return result

    def build_schema_context_from_tables(
        self,
        confirmed_tables: list[dict],
        db_type: str,
    ) -> str:
        """
        Build a focused schema context string from only the user-confirmed tables.
        This is what gets sent to SQLCoder.
        """
        lines = [
            f"DATABASE SCHEMA (ONLY use these {len(confirmed_tables)} tables):"
        ]

        for table in confirmed_tables:
            row_count = table.get("row_count", 0)
            lines.append(f"\nTABLE: {table['name']}  ({row_count:,} rows)")

            # Build FK lookup for this table
            fk_lookup = {
                fk["column"]: f"{fk['references_table']}.{fk['references_column']}"
                for fk in table.get("foreign_keys", [])
            }

            for col in table.get("columns", []):
                parts = [f"  {col['name']}", col["type"].upper()]
                if col.get("is_primary"):
                    parts.append("PK")
                elif col["name"] in fk_lookup:
                    parts.append(f"FK→{fk_lookup[col['name']]}")
                if not col.get("nullable", True):
                    parts.append("NOT NULL")
                lines.append(" ".join(parts))

        return "\n".join(lines)

    def _schema_question_to_sql(self, question: str, db_type: str) -> str:
        """
        Convert common schema/metadata questions directly to correct SQL —
        no LLM involved, so dialect is always right.
        """
        q = question.lower()
        stop = {
            "where", "is", "are", "which", "table", "find", "column", "stored",
            "have", "does", "the", "a", "an", "in", "our", "we", "do", "store",
            "hi", "hey", "what", "show", "list", "give", "me", "how",
        }

        if any(p in q for p in ["where is", "which table", "find column", "where are",
                                  "where do we store", "where does", "which table has"]):
            keywords = [w.strip("?,'\"") for w in q.split()
                        if w.strip("?,'\"") not in stop and len(w.strip("?,'\"")) > 2]
            if keywords:
                if db_type == "mssql":
                    clauses = " OR ".join(f"COLUMN_NAME LIKE '%{k}%'" for k in keywords[:3])
                    return (f"SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE\n"
                            f"FROM INFORMATION_SCHEMA.COLUMNS\n"
                            f"WHERE {clauses}\nORDER BY TABLE_SCHEMA, TABLE_NAME")
                elif db_type == "postgresql":
                    clauses = " OR ".join(f"column_name ILIKE '%{k}%'" for k in keywords[:3])
                    return (f"SELECT table_schema, table_name, column_name, data_type\n"
                            f"FROM information_schema.columns\n"
                            f"WHERE {clauses}\nORDER BY table_name")
                elif db_type == "mysql":
                    clauses = " OR ".join(f"COLUMN_NAME LIKE '%{k}%'" for k in keywords[:3])
                    return (f"SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE\n"
                            f"FROM INFORMATION_SCHEMA.COLUMNS\n"
                            f"WHERE TABLE_SCHEMA = DATABASE() AND ({clauses})\nORDER BY TABLE_NAME")

        if any(p in q for p in ["columns", "fields", "structure of", "describe"]):
            words = question.split()
            table = None
            for i, w in enumerate(words[:-1]):
                if w.lower() in ("table", "in", "for", "of"):
                    table = words[i + 1].strip("?,'\"")
                    break
            if not table:
                for w in reversed(words):
                    c = w.strip("?,'\"")
                    if c and c[0].isupper() and c.lower() not in stop:
                        table = c
                        break
            if table:
                if db_type == "mssql":
                    return (f"SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT\n"
                            f"FROM INFORMATION_SCHEMA.COLUMNS\n"
                            f"WHERE TABLE_NAME = '{table}'\nORDER BY ORDINAL_POSITION")
                elif db_type == "postgresql":
                    return (f"SELECT column_name, data_type, is_nullable, column_default\n"
                            f"FROM information_schema.columns\n"
                            f"WHERE table_name = '{table.lower()}'\nORDER BY ordinal_position")
                elif db_type == "mysql":
                    return (f"SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT\n"
                            f"FROM INFORMATION_SCHEMA.COLUMNS\n"
                            f"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{table}'\n"
                            f"ORDER BY ORDINAL_POSITION")
                elif db_type == "sqlite":
                    return f"PRAGMA table_info({table})"

        if any(p in q for p in ["what tables", "list tables", "all tables",
                                  "show tables", "list all tables", "what are the tables"]):
            if db_type == "mssql":
                return ("SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE\n"
                        "FROM INFORMATION_SCHEMA.TABLES\n"
                        "WHERE TABLE_TYPE = 'BASE TABLE'\nORDER BY TABLE_SCHEMA, TABLE_NAME")
            elif db_type == "postgresql":
                return ("SELECT table_schema, table_name\n"
                        "FROM information_schema.tables\n"
                        "WHERE table_schema NOT IN ('pg_catalog','information_schema')\n"
                        "ORDER BY table_name")
            elif db_type == "mysql":
                return ("SELECT TABLE_NAME, TABLE_TYPE\n"
                        "FROM INFORMATION_SCHEMA.TABLES\n"
                        "WHERE TABLE_SCHEMA = DATABASE()\nORDER BY TABLE_NAME")
            elif db_type == "sqlite":
                return ("SELECT name AS table_name\n"
                        "FROM sqlite_master\nWHERE type = 'table'\nORDER BY name")

        if any(p in q for p in ["indexes", "indices"]):
            if db_type == "mssql":
                return ("SELECT t.name AS table_name, i.name AS index_name,\n"
                        "       i.is_unique, i.is_primary_key\n"
                        "FROM sys.indexes i\n"
                        "JOIN sys.tables t ON i.object_id = t.object_id\n"
                        "WHERE i.name IS NOT NULL\nORDER BY t.name, i.name")

        return ""

    # ── Main entry points ─────────────────────────────────────────────────────

    async def natural_language_to_sql(
        self,
        question: str,
        schema_context: str,
        db_type: str = "mssql",
        max_retries: int = 2,
        confirmed_tables: list[dict] | None = None,
    ) -> dict:
        """
        Route → classify → handle.

        If confirmed_tables is provided, skip table selection and generate
        SQL directly using only those tables.

        Returns: { sql, answer, category, retries }
        """
        category = await self.classify_question(question)

        if category == "GENERAL_QUESTION":
            answer = await self.answer_general(question, schema_context, db_type)
            return {"sql": "", "answer": answer, "category": category, "retries": 0}

        if category == "SCHEMA_QUESTION":
            sql = self._schema_question_to_sql(question, db_type)
            if sql:
                return {"sql": sql, "answer": "", "category": category, "retries": 0}

        # SQL generation — use confirmed tables if provided
        if confirmed_tables:
            focused_schema = self.build_schema_context_from_tables(confirmed_tables, db_type)
        else:
            focused_schema = schema_context

        dialect_rules = DIALECT_RULES.get(db_type, "")
        system = SQL_SYSTEM_PROMPT.format(
            dialect_rules=dialect_rules,
            few_shot_examples=FEW_SHOT_EXAMPLES,
            schema_context=focused_schema,
        )
        prompt = (
            f"Database dialect: {db_type}\n\n"
            f"User request: {question}\n\n"
            f"Write the SQL query:"
        )

        raw = await self.generate(prompt, system)
        sql = self._extract_sql(raw)

        last_error = None
        attempt = 0
        for attempt in range(max_retries):
            error = self._basic_sql_validate(sql, db_type)
            if not error:
                break
            last_error = error
            raw = await self.generate(
                f"Database dialect: {db_type}\n\nUser request: {question}\n\n"
                f"Previous attempt (INCORRECT):\n{sql}\n\nError: {error}\n\n"
                f"Fix the SQL and return ONLY the corrected SQL:",
                system,
            )
            sql = self._extract_sql(raw)

        return {
            "sql": sql,
            "answer": "",
            "category": category,
            "retries": attempt if last_error else 0,
        }

    # ── Other operations ──────────────────────────────────────────────────────

    async def explain_query(self, sql: str, schema_context: str = "") -> str:
        system = EXPLAIN_SYSTEM_PROMPT
        if schema_context:
            system += f"\n\nDATABASE SCHEMA:\n{schema_context}"
        return await self.generate(f"Explain this SQL query:\n\n{sql}", system)

    async def optimize_query(self, sql: str, schema_context: str, db_type: str = "mssql") -> dict:
        system = OPTIMIZE_SYSTEM_PROMPT.format(
            dialect_rules=DIALECT_RULES.get(db_type, ""),
            schema_context=schema_context,
        )
        raw = await self.generate(f"Database type: {db_type}\n\nOptimize:\n\n{sql}", system)
        return {"optimized_sql": self._extract_sql(raw), "analysis": raw}

    async def recommend_indexes(self, sql: str, schema_context: str, db_type: str = "mssql") -> str:
        system = (
            f"You are a database index specialist. Recommend optimal indexes with CREATE INDEX statements.\n"
            f"{DIALECT_RULES.get(db_type, '')}\n\nDATABASE SCHEMA:\n{schema_context}"
        )
        return await self.generate(f"Database type: {db_type}\n\nRecommend indexes for:\n\n{sql}", system)

    async def score_complexity(self, sql: str) -> dict:
        system = 'Return ONLY valid JSON: {"score": 7, "factors": ["3 JOINs"], "summary": "..."}'
        raw = await self.generate(f"Score SQL complexity 1-10:\n\n{sql}", system)
        try:
            clean = raw.strip()
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            return json.loads(clean.strip())
        except Exception:
            return {"score": 5, "factors": [], "summary": raw[:200]}

    def _extract_sql(self, text: str) -> str:
        text = text.strip()
        if "```sql" in text:
            return text.split("```sql")[1].split("```")[0].strip()
        if "```" in text:
            return text.split("```")[1].strip()
        starters = ("SELECT", "WITH", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP")
        if any(text.upper().lstrip().startswith(k) for k in starters):
            return text
        lines = text.split("\n")
        sql_lines = []
        in_sql = False
        for line in lines:
            if not in_sql and any(line.strip().upper().startswith(k) for k in starters):
                in_sql = True
            if in_sql:
                sql_lines.append(line)
        return "\n".join(sql_lines).strip() if sql_lines else text

    def _basic_sql_validate(self, sql: str, db_type: str) -> str | None:
        if not sql or len(sql.strip()) < 5:
            return "Empty or too-short SQL."
        upper = sql.upper()
        if upper.strip().startswith(("HERE IS", "SURE", "CERTAINLY", "OF COURSE", "I CAN")):
            return "Response is explanation text, not SQL."
        if db_type == "mssql" and re.search(r"\bLIMIT\b", upper):
            return "MSSQL does not support LIMIT. Use SELECT TOP N."
        if db_type in ("postgresql", "mysql", "sqlite") and "SELECT TOP" in upper:
            return f"{db_type} does not support SELECT TOP. Use LIMIT."
        if sql.count("(") != sql.count(")"):
            return "Unbalanced parentheses."

        # ── ADD THIS ──────────────────────────────────────────────────────────────
        if db_type == "mssql" and re.search(r'"[^"]+"', sql):
            return 'MSSQL uses [brackets] for identifiers, not "double quotes". Replace all "col" with [col].'
        # ─────────────────────────────────────────────────────────────────────────

        return None

# ── Singleton ─────────────────────────────────────────────────────────────────
_ollama_service: OllamaService | None = None


def get_ollama_service(model: str = DEFAULT_SQL_MODEL) -> OllamaService:
    global _ollama_service
    if _ollama_service is None or _ollama_service.sql_model != model:
        _ollama_service = OllamaService(
            base_url=OLLAMA_BASE_URL,  
            sql_model=model,
            general_model=DEFAULT_GENERAL_MODEL,
        )
    return _ollama_service