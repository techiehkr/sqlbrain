from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid

from app.core.database import ConnectionConfig, DatabaseConnector, store_connection, get_connection, remove_connection
from app.services.schema_scanner import SchemaScanner

router = APIRouter()

# In-memory schema cache
_schema_cache: dict = {}


class ConnectRequest(BaseModel):
    db_type: str
    host: str = ""
    port: int = 0
    username: str = ""
    password: str = ""
    database: str = ""
    filepath: str = ""


class ConnectResponse(BaseModel):
    session_id: str
    status: str
    message: str


@router.post("/connect", response_model=ConnectResponse)
async def connect_database(req: ConnectRequest):
    config = ConnectionConfig(
        db_type=req.db_type,
        host=req.host,
        port=req.port,
        username=req.username,
        password=req.password,
        database=req.database,
        filepath=req.filepath,
    )
    connector = DatabaseConnector(config)
    try:
        connector.connect()
        # Quick test
        connector.execute_query("SELECT 1" if req.db_type != "mssql" else "SELECT 1")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")

    session_id = str(uuid.uuid4())
    store_connection(session_id, connector)
    return ConnectResponse(session_id=session_id, status="connected", message="Database connected successfully")


@router.delete("/disconnect/{session_id}")
async def disconnect_database(session_id: str):
    remove_connection(session_id)
    if session_id in _schema_cache:
        del _schema_cache[session_id]
    return {"status": "disconnected"}


@router.get("/schema/{session_id}")
async def get_schema(session_id: str, refresh: bool = False):
    if not refresh and session_id in _schema_cache:
        return _schema_cache[session_id]

    connector = get_connection(session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found. Please reconnect.")

    try:
        scanner = SchemaScanner(connector)
        schema = scanner.scan()
        _schema_cache[session_id] = schema
        return schema
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schema scan failed: {str(e)}")


@router.get("/status/{session_id}")
async def connection_status(session_id: str):
    connector = get_connection(session_id)
    if not connector:
        return {"connected": False}
    try:
        connector.execute_query("SELECT 1")
        return {"connected": True, "db_type": connector.config.db_type, "database": connector.config.database}
    except Exception:
        return {"connected": False}
