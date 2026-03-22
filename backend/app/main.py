from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import database, query, schema, performance, charts, ollama

app = FastAPI(
    title="SQLBrain API",
    description="Local AI Database Assistant",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(database.router,    prefix="/api/database",    tags=["database"])
app.include_router(query.router,       prefix="/api/query",       tags=["query"])
app.include_router(schema.router,      prefix="/api/schema",      tags=["schema"])
app.include_router(performance.router, prefix="/api/performance", tags=["performance"])
app.include_router(charts.router,      prefix="/api/charts",      tags=["charts"])
app.include_router(ollama.router,      prefix="/api/ollama",      tags=["ollama"])


@app.get("/")
async def root():
    return {"message": "SQLBrain API is running", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}