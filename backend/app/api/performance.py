from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.database import get_connection
from app.services.performance_analyzer import PerformanceAnalyzer
from app.services.query_history import get_history, get_frequent_queries

router = APIRouter()


class AnalyzeRequest(BaseModel):
    session_id: str
    sql: str


@router.post("/analyze")
async def analyze_query(req: AnalyzeRequest):
    connector = get_connection(req.session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found")

    analyzer = PerformanceAnalyzer(connector)
    result = analyzer.analyze(req.sql)
    return result


@router.post("/complexity")
async def get_complexity(req: AnalyzeRequest):
    connector = get_connection(req.session_id)
    if not connector:
        raise HTTPException(status_code=404, detail="Session not found")

    analyzer = PerformanceAnalyzer(connector)
    return analyzer._compute_complexity(req.sql)


@router.get("/history/{session_id}")
async def query_history(session_id: str, limit: int = 50):
    return get_history(session_id, limit)


@router.get("/frequent/{session_id}")
async def frequent_queries(session_id: str, top_n: int = 10):
    return get_frequent_queries(session_id, top_n)
