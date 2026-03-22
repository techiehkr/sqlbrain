from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import json

from app.core.database import get_connection
from app.services.llm_service import get_ollama_service
from app.services.schema_scanner import SchemaScanner
from app.api.database import _schema_cache

router = APIRouter()


class ChartRequest(BaseModel):
    session_id: str
    question: str
    model: str = "llama3.1"
    chart_type: Optional[str] = None  # bar, line, pie, area — or auto


CHART_SYSTEM_PROMPT = """You are a data visualization expert.
Given a user request and database schema, generate a SQL query and chart configuration.

CRITICAL SQL RULES — violations will cause errors:
- Use ONLY the exact table names listed in the schema below — NEVER invent names
- Always use fully qualified table names: novas.T_Membership NOT just Membership
- Use [brackets] for MSSQL column/table identifiers, NEVER "double quotes"
- Use SELECT TOP N for MSSQL row limits, NEVER LIMIT
- Use table aliases in all JOINs
- Only SELECT the columns needed for the chart (x_axis and y_axis columns)

Respond with ONLY valid JSON — no markdown fences, no explanation, nothing else:
{
  "sql": "SELECT ...",
  "chart_type": "bar|line|pie|area",
  "x_axis": "column_name_for_x",
  "y_axis": "column_name_for_y",
  "title": "Chart title",
  "description": "What this chart shows"
}
"""


@router.post("/generate")
async def generate_chart(req: ChartRequest):
    connector = get_connection(req.session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found")

    # Load or scan schema
    schema = _schema_cache.get(req.session_id)
    if not schema:
        scanner = SchemaScanner(connector)
        schema = scanner.scan()
        _schema_cache[req.session_id] = schema

    llm = get_ollama_service(req.model)
    if not await llm.is_available():
        raise HTTPException(status_code=503, detail="Ollama not running")

    # Fix 2: Filter schema to only relevant tables for this question
    # Same scoring logic as the query tab — prevents model hallucinating table names
    candidates = llm.get_table_candidates(req.question, schema, max_tables=8)
    if candidates:
        schema_context = llm.build_schema_context_from_tables(
            candidates, connector.config.db_type
        )
    else:
        # Fallback to full schema if no candidates scored
        schema_context = SchemaScanner(connector).to_llm_context(schema)

    prompt = (
        f"Database type: {connector.config.db_type}\n\n"
        f"{schema_context}\n\n"
        f"User request: {req.question}\n"
        f"{f'Preferred chart type: {req.chart_type}' if req.chart_type else ''}\n\n"
        f"Generate SQL and chart configuration as JSON:"
    )

    raw = await llm.generate(prompt, CHART_SYSTEM_PROMPT)

    # Parse JSON response
    try:
        clean = raw.strip()
        if "```json" in clean:
            clean = clean.split("```json")[1].split("```")[0].strip()
        elif "```" in clean:
            clean = clean.split("```")[1].split("```")[0].strip()
        chart_config = json.loads(clean)
    except Exception:
        # Fallback: extract SQL and use defaults
        sql = llm._extract_sql(raw)
        chart_config = {
            "sql": sql,
            "chart_type": req.chart_type or "bar",
            "x_axis": None,
            "y_axis": None,
            "title": req.question,
            "description": "",
        }

    sql = chart_config.get("sql", "")
    if not sql:
        raise HTTPException(status_code=400, detail="LLM did not generate a SQL query")

    # Validate SQL before executing — catch dialect errors early
    validation_error = llm._basic_sql_validate(sql, connector.config.db_type)
    if validation_error:
        # One retry with the error fed back
        retry_prompt = (
            f"Database type: {connector.config.db_type}\n\n"
            f"{schema_context}\n\n"
            f"User request: {req.question}\n\n"
            f"Previous SQL was invalid:\n{sql}\n\n"
            f"Error: {validation_error}\n\n"
            f"Fix and return ONLY valid JSON with corrected SQL:"
        )
        raw = await llm.generate(retry_prompt, CHART_SYSTEM_PROMPT)
        try:
            clean = raw.strip()
            if "```json" in clean:
                clean = clean.split("```json")[1].split("```")[0].strip()
            elif "```" in clean:
                clean = clean.split("```")[1].split("```")[0].strip()
            chart_config = json.loads(clean)
            sql = chart_config.get("sql", sql)
        except Exception:
            sql = llm._extract_sql(raw) or sql

    # Add row limit for charts
    if "LIMIT" not in sql.upper() and "TOP" not in sql.upper()[:30]:
        if connector.config.db_type == "mssql":
            sql = sql.replace("SELECT ", "SELECT TOP 1000 ", 1)
        else:
            sql += " LIMIT 1000"

    try:
        rows = connector.execute_query(sql)
        columns = list(rows[0].keys()) if rows else []

        # Auto-detect axes if not set by LLM
        if not chart_config.get("x_axis") and columns:
            chart_config["x_axis"] = columns[0]
        if not chart_config.get("y_axis") and len(columns) > 1:
            chart_config["y_axis"] = columns[1]

        return {
            **chart_config,
            "sql": sql,
            "data": rows,
            "columns": columns,
            "row_count": len(rows),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query execution failed: {str(e)}")