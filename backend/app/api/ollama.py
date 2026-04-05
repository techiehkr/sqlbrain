from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx
import json
import os

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

router = APIRouter()


class PullRequest(BaseModel):
    model: str


class DeleteRequest(BaseModel):
    model: str


@router.get("/status")
async def ollama_status():
    """Proxy Ollama availability + installed models through the backend."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                models = [
                    {
                        "name": m["name"],
                        "size": m.get("size", 0),
                        "modified_at": m.get("modified_at", ""),
                    }
                    for m in data.get("models", [])
                ]
                return {"available": True, "models": models}
    except Exception:
        pass
    return {"available": False, "models": []}


@router.get("/models")
async def ollama_models():
    """Return list of installed models with size info."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            data = resp.json()
            return {
                "models": [
                    {
                        "name": m["name"],
                        "size": m.get("size", 0),
                        "modified_at": m.get("modified_at", ""),
                    }
                    for m in data.get("models", [])
                ]
            }
    except Exception:
        return {"models": []}


@router.post("/pull")
async def pull_model(req: PullRequest):
    """
    Stream model download progress from Ollama.
    Returns SSE stream of JSON progress lines.
    """
    async def stream():
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE_URL}/api/pull",
                    json={"name": req.model, "stream": True},
                ) as resp:
                    async for line in resp.aiter_lines():
                        if line:
                            yield f"data: {line}\n\n"
            yield "data: {\"status\":\"done\"}\n\n"
        except Exception as e:
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.delete("/delete")
async def delete_model(req: DeleteRequest):
    """Delete a locally installed model."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(
                f"{OLLAMA_BASE_URL}/api/delete",
                json={"name": req.model},
            )
            if resp.status_code == 200:
                return {"status": "deleted", "model": req.model}
            raise HTTPException(status_code=resp.status_code, detail="Delete failed")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))