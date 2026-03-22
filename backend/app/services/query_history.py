from datetime import datetime
from typing import Optional
import json
import os

HISTORY_FILE = "/tmp/sqlbrain_history.json"


def _load_history() -> list[dict]:
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE) as f:
                return json.load(f)
        except Exception:
            return []
    return []


def _save_history(history: list[dict]):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history[-200:], f)  # Keep last 200


def add_query(session_id: str, query_type: str, input_text: str, sql: str, metadata: dict = None):
    history = _load_history()
    history.append({
        "id": len(history) + 1,
        "session_id": session_id,
        "type": query_type,  # nl_to_sql, manual, optimized
        "input": input_text,
        "sql": sql,
        "timestamp": datetime.utcnow().isoformat(),
        "metadata": metadata or {},
    })
    _save_history(history)


def get_history(session_id: Optional[str] = None, limit: int = 50) -> list[dict]:
    history = _load_history()
    if session_id:
        history = [h for h in history if h.get("session_id") == session_id]
    return list(reversed(history))[:limit]


def get_frequent_queries(session_id: Optional[str] = None, top_n: int = 10) -> list[dict]:
    history = _load_history()
    if session_id:
        history = [h for h in history if h.get("session_id") == session_id]

    from collections import Counter
    counter = Counter(h["sql"].strip() for h in history)
    return [{"sql": sql, "count": count} for sql, count in counter.most_common(top_n)]
