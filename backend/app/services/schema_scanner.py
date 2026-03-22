import json
from typing import Any
from app.core.database import DatabaseConnector


class SchemaScanner:
    def __init__(self, connector: DatabaseConnector):
        self.connector = connector
        self.db_type = connector.config.db_type

    def scan(self) -> dict:
        tables = self._get_tables()
        columns = self._get_columns()
        foreign_keys = self._get_foreign_keys()
        indexes = self._get_indexes()
        row_counts = self._get_row_counts(tables)

        schema = {"tables": []}

        table_map = {}
        for table in tables:
            name = table["table_name"]
            table_map[name] = {
                "name": name,
                "schema": table.get("table_schema", "dbo"),
                "columns": [],
                "indexes": [],
                "foreign_keys": [],
                "row_count": row_counts.get(name, 0),
            }

        for col in columns:
            t = col["table_name"]
            if t in table_map:
                table_map[t]["columns"].append({
                    "name": col["column_name"],
                    "type": col["data_type"],
                    "nullable": col.get("is_nullable", "YES") == "YES",
                    "default": col.get("column_default"),
                    "max_length": col.get("character_maximum_length"),
                    "is_primary": col.get("is_primary", False),
                })

        for fk in foreign_keys:
            t = fk.get("table_name")
            if t and t in table_map:
                table_map[t]["foreign_keys"].append({
                    "column": fk.get("column_name"),
                    "references_table": fk.get("referenced_table"),
                    "references_column": fk.get("referenced_column"),
                    "constraint_name": fk.get("constraint_name"),
                })

        for idx in indexes:
            t = idx.get("table_name")
            if t and t in table_map:
                table_map[t]["indexes"].append({
                    "name": idx.get("index_name"),
                    "columns": idx.get("columns", []),
                    "is_unique": idx.get("is_unique", False),
                    "is_primary": idx.get("is_primary", False),
                })

        schema["tables"] = list(table_map.values())
        schema["summary"] = {
            "total_tables": len(schema["tables"]),
            "total_columns": sum(len(t["columns"]) for t in schema["tables"]),
            "total_relationships": sum(len(t["foreign_keys"]) for t in schema["tables"]),
            "total_indexes": sum(len(t["indexes"]) for t in schema["tables"]),
        }
        return schema

    def _get_tables(self) -> list[dict]:
        if self.db_type == "mssql":
            sql = """
                SELECT TABLE_NAME as table_name, TABLE_SCHEMA as table_schema
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_NAME
            """
        elif self.db_type == "postgresql":
            sql = """
                SELECT table_name, table_schema
                FROM information_schema.tables
                WHERE table_schema NOT IN ('pg_catalog','information_schema')
                AND table_type = 'BASE TABLE'
                ORDER BY table_name
            """
        elif self.db_type == "mysql":
            sql = f"""
                SELECT TABLE_NAME as table_name, TABLE_SCHEMA as table_schema
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = '{self.connector.config.database}'
                AND TABLE_TYPE = 'BASE TABLE'
                ORDER BY TABLE_NAME
            """
        elif self.db_type == "sqlite":
            sql = """
                SELECT name as table_name, 'main' as table_schema
                FROM sqlite_master
                WHERE type='table'
                ORDER BY name
            """
        return self.connector.execute_query(sql)

    def _get_columns(self) -> list[dict]:
        """Get columns — includes primary key flag where possible."""
        if self.db_type == "mssql":
            sql = """
                SELECT
                    c.TABLE_NAME as table_name,
                    c.COLUMN_NAME as column_name,
                    c.DATA_TYPE as data_type,
                    c.IS_NULLABLE as is_nullable,
                    c.COLUMN_DEFAULT as column_default,
                    c.CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
                    CASE WHEN kcu.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END as is_primary
                FROM INFORMATION_SCHEMA.COLUMNS c
                LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                    ON tc.TABLE_NAME = c.TABLE_NAME AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
                LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                    ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                    AND kcu.COLUMN_NAME = c.COLUMN_NAME
                ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
            """
        elif self.db_type == "postgresql":
            sql = """
                SELECT
                    c.table_name, c.column_name, c.data_type,
                    c.is_nullable, c.column_default, c.character_maximum_length,
                    CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END as is_primary
                FROM information_schema.columns c
                LEFT JOIN information_schema.table_constraints tc
                    ON tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY'
                    AND tc.table_schema = c.table_schema
                LEFT JOIN information_schema.key_column_usage kcu
                    ON kcu.constraint_name = tc.constraint_name
                    AND kcu.column_name = c.column_name
                WHERE c.table_schema NOT IN ('pg_catalog','information_schema')
                ORDER BY c.table_name, c.ordinal_position
            """
        elif self.db_type == "mysql":
            sql = f"""
                SELECT
                    c.TABLE_NAME as table_name,
                    c.COLUMN_NAME as column_name,
                    c.DATA_TYPE as data_type,
                    c.IS_NULLABLE as is_nullable,
                    c.COLUMN_DEFAULT as column_default,
                    c.CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
                    CASE WHEN c.COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END as is_primary
                FROM INFORMATION_SCHEMA.COLUMNS c
                WHERE c.TABLE_SCHEMA = '{self.connector.config.database}'
                ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
            """
        elif self.db_type == "sqlite":
            tables = self._get_tables()
            results = []
            for t in tables:
                rows = self.connector.execute_query(f"PRAGMA table_info({t['table_name']})")
                for row in rows:
                    results.append({
                        "table_name": t["table_name"],
                        "column_name": row.get("name"),
                        "data_type": row.get("type", "TEXT"),
                        "is_nullable": "YES" if not row.get("notnull") else "NO",
                        "column_default": row.get("dflt_value"),
                        "character_maximum_length": None,
                        "is_primary": bool(row.get("pk")),
                    })
            return results
        return self.connector.execute_query(sql)

    def _get_foreign_keys(self) -> list[dict]:
        if self.db_type == "mssql":
            sql = """
                SELECT
                    fk.name AS constraint_name,
                    tp.name AS table_name,
                    cp.name AS column_name,
                    tr.name AS referenced_table,
                    cr.name AS referenced_column
                FROM sys.foreign_keys fk
                INNER JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
                INNER JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
                INNER JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
                INNER JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
                INNER JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
            """
        elif self.db_type == "postgresql":
            sql = """
                SELECT
                    tc.constraint_name,
                    tc.table_name,
                    kcu.column_name,
                    ccu.table_name AS referenced_table,
                    ccu.column_name AS referenced_column
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
            """
        elif self.db_type == "mysql":
            sql = f"""
                SELECT
                    CONSTRAINT_NAME as constraint_name,
                    TABLE_NAME as table_name,
                    COLUMN_NAME as column_name,
                    REFERENCED_TABLE_NAME as referenced_table,
                    REFERENCED_COLUMN_NAME as referenced_column
                FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = '{self.connector.config.database}'
                AND REFERENCED_TABLE_NAME IS NOT NULL
            """
        elif self.db_type == "sqlite":
            tables = self._get_tables()
            results = []
            for t in tables:
                rows = self.connector.execute_query(f"PRAGMA foreign_key_list({t['table_name']})")
                for row in rows:
                    results.append({
                        "constraint_name": f"fk_{t['table_name']}_{row.get('from')}",
                        "table_name": t["table_name"],
                        "column_name": row.get("from"),
                        "referenced_table": row.get("table"),
                        "referenced_column": row.get("to"),
                    })
            return results
        try:
            return self.connector.execute_query(sql)
        except Exception:
            return []

    def _get_indexes(self) -> list[dict]:
        if self.db_type == "mssql":
            sql = """
                SELECT
                    t.name AS table_name,
                    i.name AS index_name,
                    i.is_unique,
                    i.is_primary_key AS is_primary,
                    STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
                FROM sys.indexes i
                INNER JOIN sys.tables t ON i.object_id = t.object_id
                INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE i.name IS NOT NULL
                GROUP BY t.name, i.name, i.is_unique, i.is_primary_key
            """
            try:
                rows = self.connector.execute_query(sql)
                for r in rows:
                    if isinstance(r.get("columns"), str):
                        r["columns"] = r["columns"].split(",")
                return rows
            except Exception:
                return []
        return []

    def _get_row_counts(self, tables: list[dict]) -> dict:
        counts = {}
        for table in tables:
            name = table["table_name"]
            try:
                if self.db_type == "mssql":
                    result = self.connector.execute_query(f"SELECT COUNT(*) as cnt FROM [{name}]")
                else:
                    result = self.connector.execute_query(f"SELECT COUNT(*) as cnt FROM {name}")
                counts[name] = result[0]["cnt"] if result else 0
            except Exception:
                counts[name] = -1
        return counts

    def _get_sample_values(self, table_name: str, column_name: str, limit: int = 5) -> list:
        """Fetch a handful of distinct non-null values for a column — helps the LLM understand data shape."""
        try:
            if self.db_type == "mssql":
                sql = f"SELECT DISTINCT TOP {limit} [{column_name}] FROM [{table_name}] WHERE [{column_name}] IS NOT NULL"
            elif self.db_type in ("postgresql", "mysql"):
                sql = f'SELECT DISTINCT "{column_name}" FROM "{table_name}" WHERE "{column_name}" IS NOT NULL LIMIT {limit}'
            else:
                sql = f"SELECT DISTINCT {column_name} FROM {table_name} WHERE {column_name} IS NOT NULL LIMIT {limit}"
            rows = self.connector.execute_query(sql)
            return [list(r.values())[0] for r in rows if r]
        except Exception:
            return []

    def to_llm_context(self, schema: dict, include_samples: bool = True) -> str:
        """
        Serialize schema to a compact, LLM-optimised context string.

        Improvements over original:
        - Primary keys are flagged with PK
        - Foreign keys shown inline on each column
        - Sample values included for low-cardinality / enum-like columns
        - Index columns listed clearly
        """
        lines = ["DATABASE SCHEMA (use EXACT names below — do not invent columns or tables):"]
        fk_lookup: dict[str, dict] = {}  # table -> {col -> referenced}

        for table in schema.get("tables", []):
            # Build FK lookup for this table
            fk_lookup = {
                fk["column"]: f"{fk['references_table']}.{fk['references_column']}"
                for fk in table.get("foreign_keys", [])
            }

            row_count = table.get("row_count", 0)
            lines.append(f"\nTABLE: {table['name']}  ({row_count:,} rows)")

            for col in table["columns"]:
                parts = [f"  {col['name']}"]
                parts.append(col["type"].upper())

                if col.get("is_primary"):
                    parts.append("PK")
                elif col["name"] in fk_lookup:
                    parts.append(f"FK→{fk_lookup[col['name']]}")

                if not col["nullable"]:
                    parts.append("NOT NULL")

                # Sample values for string/enum columns in small-rowcount tables
                # (skip for huge tables to avoid slowing down schema scans)
                if include_samples and row_count < 500_000:
                    col_type_upper = col["type"].upper()
                    is_text_like = any(t in col_type_upper for t in ("CHAR", "TEXT", "ENUM", "VARCHAR"))
                    is_numeric = any(t in col_type_upper for t in ("INT", "DECIMAL", "FLOAT", "NUMERIC"))

                    # Only fetch samples for text/enum columns or numeric status fields
                    should_sample = is_text_like or (
                        is_numeric and any(kw in col["name"].lower() for kw in ("status", "type", "code", "flag"))
                    )

                    if should_sample:
                        samples = self._get_sample_values(table["name"], col["name"], limit=5)
                        if samples:
                            sample_str = ", ".join(repr(str(s)) for s in samples[:5])
                            parts.append(f"[e.g. {sample_str}]")

                lines.append(" ".join(parts))

            # Indexes
            if table.get("indexes"):
                idx_parts = []
                for idx in table["indexes"]:
                    cols = ", ".join(idx["columns"]) if isinstance(idx["columns"], list) else idx["columns"]
                    kind = "PK" if idx["is_primary"] else ("UNIQUE" if idx["is_unique"] else "IDX")
                    idx_parts.append(f"{kind}({cols})")
                lines.append(f"  Indexes: {' | '.join(idx_parts)}")

        # Summary line
        summary = schema.get("summary", {})
        lines.append(
            f"\nSUMMARY: {summary.get('total_tables', 0)} tables, "
            f"{summary.get('total_columns', 0)} columns, "
            f"{summary.get('total_relationships', 0)} FK relationships"
        )

        return "\n".join(lines)