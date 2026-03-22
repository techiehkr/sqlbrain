from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.database import get_connection
from app.services.llm_service import get_ollama_service, DIALECT_RULES, SQL_SYSTEM_PROMPT, FEW_SHOT_EXAMPLES
from app.services.schema_scanner import SchemaScanner
from app.services.query_history import add_query
from app.api.database import _schema_cache

router = APIRouter()


class NLQueryRequest(BaseModel):
    session_id: str
    question: str
    model: str = "llama3.1"


class CandidatesRequest(BaseModel):
    session_id: str
    question: str
    model: str = "llama3.1"


class ConfirmRequest(BaseModel):
    session_id: str
    question: str
    confirmed_tables: list[dict]
    model: str = "llama3.1"


class ExecuteQueryRequest(BaseModel):
    session_id: str
    sql: str
    limit: int = 500


class ExplainQueryRequest(BaseModel):
    session_id: str
    sql: str
    model: str = "llama3.1"


class OptimizeQueryRequest(BaseModel):
    session_id: str
    sql: str
    model: str = "llama3.1"


def _get_schema(session_id: str, connector) -> dict:
    schema = _schema_cache.get(session_id)
    if not schema:
        scanner = SchemaScanner(connector)
        schema = scanner.scan()
        _schema_cache[session_id] = schema
    return schema


def _get_schema_context(session_id: str, connector) -> str:
    schema = _get_schema(session_id, connector)
    scanner = SchemaScanner(connector)
    return scanner.to_llm_context(schema)


def _dry_run(connector, sql: str) -> str | None:
    """Run a 1-row test to catch SQL errors early. Returns error string or None."""
    try:
        test = sql
        db = connector.config.db_type
        if db == "mssql" and "TOP" not in test.upper()[:30]:
            test = test.replace("SELECT ", "SELECT TOP 1 ", 1)
        elif db in ("postgresql", "mysql", "sqlite") and "LIMIT" not in test.upper():
            test = f"{test} LIMIT 1"
        connector.execute_query(test)
        return None
    except Exception as e:
        return str(e)


# ── Step 1: Classify + return table candidates ────────────────────────────────
@router.post("/nl-to-sql/candidates")
async def get_candidates(req: CandidatesRequest):
    connector = get_connection(req.session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found")

    llm = get_ollama_service(req.model)
    if not await llm.is_available():
        raise HTTPException(status_code=503, detail="Ollama is not running. Run: ollama serve")

    schema = _get_schema(req.session_id, connector)
    category = await llm.classify_question(req.question)

    # General → answer immediately
    if category == "GENERAL_QUESTION":
        schema_context = _get_schema_context(req.session_id, connector)
        answer = await llm.answer_general(req.question, schema_context, connector.config.db_type)
        return {"category": category, "answer": answer, "candidates": [], "needs_confirmation": False}

    # Schema metadata → direct INFORMATION_SCHEMA SQL, no LLM needed
    if category == "SCHEMA_QUESTION":
        sql = llm._schema_question_to_sql(req.question, connector.config.db_type)
        if sql:
            return {"category": category, "sql": sql, "candidates": [], "needs_confirmation": False}

    # SQL generation → score tables and ask user to confirm
    candidates = llm.get_table_candidates(req.question, schema)
    all_tables = [
        {
            "name": (
                f"{t.get('schema', 'dbo')}.{t['name']}"
                if t.get("schema") and t.get("schema", "").lower() != "dbo"
                else t["name"]
            ),
            "row_count": t.get("row_count", 0),
            "columns": t.get("columns", []),
            "foreign_keys": t.get("foreign_keys", []),
        }
        for t in schema.get("tables", [])
    ]

    return {
        "category": category,
        "candidates": candidates,
        "all_tables": all_tables,
        "needs_confirmation": True,
    }


# ── Step 2: Generate SQL from confirmed tables ────────────────────────────────
@router.post("/nl-to-sql/confirm")
async def confirm_and_generate(req: ConfirmRequest):
    connector = get_connection(req.session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found")

    llm = get_ollama_service(req.model)
    if not await llm.is_available():
        raise HTTPException(status_code=503, detail="Ollama is not running. Run: ollama serve")

    focused_schema = llm.build_schema_context_from_tables(req.confirmed_tables, connector.config.db_type)
    dialect_rules = DIALECT_RULES.get(connector.config.db_type, "")
    system = SQL_SYSTEM_PROMPT.format(
        dialect_rules=dialect_rules,
        few_shot_examples=FEW_SHOT_EXAMPLES,
        schema_context=focused_schema,
    )
    prompt = f"Database dialect: {connector.config.db_type}\n\nUser request: {req.question}\n\nWrite the SQL query:"

    raw = await llm.generate(prompt, system)
    sql = llm._extract_sql(raw)

    # Validation + retry loop
    for _ in range(2):
        error = llm._basic_sql_validate(sql, connector.config.db_type)
        if not error:
            break
        raw = await llm.generate(
            f"Database: {connector.config.db_type}\nRequest: {req.question}\n"
            f"Previous SQL was wrong:\n{sql}\nError: {error}\nFix and return ONLY corrected SQL:",
            system,
        )
        sql = llm._extract_sql(raw)

    # Execution dry-run — feed DB error back for final correction
    execution_error = _dry_run(connector, sql)
    if execution_error:
        try:
            raw = await llm.generate(
                f"Database: {connector.config.db_type}\nRequest: {req.question}\n"
                f"SQL caused DB error:\n{sql}\nError: {execution_error}\nFix and return ONLY corrected SQL:",
                system,
            )
            corrected = llm._extract_sql(raw)
            if corrected:
                sql = corrected
                execution_error = None
        except Exception:
            pass

    add_query(req.session_id, "nl_to_sql", req.question, sql)
    return {"sql": sql, "answer": "", "category": "SQL_GENERATION", "execution_error": execution_error}


# ── Execute ───────────────────────────────────────────────────────────────────
@router.post("/execute")
async def execute_query(req: ExecuteQueryRequest):
    connector = get_connection(req.session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found")

    sql = req.sql.strip()
    if sql.upper().lstrip().startswith("SELECT") and "LIMIT" not in sql.upper() and "TOP" not in sql.upper()[:30]:
        if connector.config.db_type == "mssql":
            sql = sql.replace("SELECT ", f"SELECT TOP {req.limit} ", 1)
        else:
            sql = f"{sql} LIMIT {req.limit}"

    try:
        rows = connector.execute_query(sql)
        columns = list(rows[0].keys()) if rows else []
        add_query(req.session_id, "manual", sql, sql)
        return {"columns": columns, "rows": rows, "row_count": len(rows), "truncated": len(rows) >= req.limit}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Explain ───────────────────────────────────────────────────────────────────
@router.post("/explain")
async def explain_query(req: ExplainQueryRequest):
    connector = get_connection(req.session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found")

    schema_context = ""
    schema = _schema_cache.get(req.session_id)
    if schema:
        schema_context = SchemaScanner(connector).to_llm_context(schema)

    llm = get_ollama_service(req.model)
    if not await llm.is_available():
        raise HTTPException(status_code=503, detail="Ollama is not running")

    return {"explanation": await llm.explain_query(req.sql, schema_context)}


# ── Optimize ──────────────────────────────────────────────────────────────────
@router.post("/optimize")
async def optimize_query(req: OptimizeQueryRequest):
    connector = get_connection(req.session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found")

    schema_context = _get_schema_context(req.session_id, connector)
    llm = get_ollama_service(req.model)
    if not await llm.is_available():
        raise HTTPException(status_code=503, detail="Ollama is not running")

    result = await llm.optimize_query(req.sql, schema_context, connector.config.db_type)
    if result.get("optimized_sql"):
        add_query(req.session_id, "optimized", req.sql, result["optimized_sql"])
    return result


# ── Index recommendations ─────────────────────────────────────────────────────
@router.post("/index-recommendations")
async def index_recommendations(req: ExplainQueryRequest):
    connector = get_connection(req.session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found")

    schema_context = _get_schema_context(req.session_id, connector)
    llm = get_ollama_service(req.model)
    if not await llm.is_available():
        raise HTTPException(status_code=503, detail="Ollama is not running")

    return {"recommendations": await llm.recommend_indexes(req.sql, schema_context, connector.config.db_type)}