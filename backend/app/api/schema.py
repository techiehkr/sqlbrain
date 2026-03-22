from fastapi import APIRouter, HTTPException
from app.core.database import get_connection
from app.services.schema_scanner import SchemaScanner
from app.api.database import _schema_cache

router = APIRouter()


@router.get("/graph/{session_id}")
async def schema_graph(session_id: str):
    """Return schema as a graph (nodes + edges) for visualization."""
    schema = _schema_cache.get(session_id)
    if not schema:
        connector = get_connection(session_id)
        if not connector:
            raise HTTPException(status_code=404, detail="Session not found")
        scanner = SchemaScanner(connector)
        schema = scanner.scan()
        _schema_cache[session_id] = schema

    nodes = []
    edges = []

    for i, table in enumerate(schema.get("tables", [])):
        nodes.append({
            "id": table["name"],
            "type": "table",
            "data": {
                "label": table["name"],
                "columns": table["columns"],
                "row_count": table.get("row_count", 0),
                "indexes": table.get("indexes", []),
            },
            "position": {"x": (i % 4) * 320, "y": (i // 4) * 280},
        })

        for fk in table.get("foreign_keys", []):
            edges.append({
                "id": f"{table['name']}-{fk['column']}-{fk['references_table']}",
                "source": table["name"],
                "target": fk["references_table"],
                "label": f"{fk['column']} → {fk['references_column']}",
                "type": "fk",
            })

    return {"nodes": nodes, "edges": edges}


@router.get("/tables/{session_id}")
async def list_tables(session_id: str):
    schema = _schema_cache.get(session_id)
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not loaded. Call /api/database/schema first.")
    return [{"name": t["name"], "row_count": t.get("row_count", 0), "column_count": len(t["columns"])} for t in schema.get("tables", [])]


@router.get("/table/{session_id}/{table_name}")
async def get_table_details(session_id: str, table_name: str):
    schema = _schema_cache.get(session_id)
    if not schema:
        raise HTTPException(status_code=404, detail="Schema not loaded")

    for table in schema.get("tables", []):
        if table["name"].lower() == table_name.lower():
            return table
    raise HTTPException(status_code=404, detail=f"Table '{table_name}' not found")
