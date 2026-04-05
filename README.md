# 🧠 SQLBrain — Local AI Database Assistant

> Write, optimize, and understand SQL queries with AI — 100% local, zero data sent outside.

![SQLBrain](https://img.shields.io/badge/SQLBrain-v1.0-00D4FF?style=for-the-badge)
![Local AI](https://img.shields.io/badge/Local%20AI-Ollama-7C3AED?style=for-the-badge)
![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-10B981?style=for-the-badge)

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🗣️ **Natural Language → SQL** | Ask questions in plain English, get production-ready SQL |
| 🔍 **Schema Explorer** | Visual explorer for tables, columns, FKs, and indexes |
| ⚡ **Performance Analyzer** | Static analysis with anti-pattern detection |
| 📈 **Chart Generator** | AI-generated charts from natural language |
| 🔧 **Query Optimizer** | AI rewrites slow queries with explanations |
| 💡 **Index Recommendations** | AI-suggested CREATE INDEX statements |
| 📚 **Query History** | Full history with replay and copy |
| 📖 **Explain Mode** | Human-readable step-by-step query explanations |

## 🏗️ Architecture

```
Frontend (Next.js :3000)
    ↓
Backend (FastAPI :8000)
    ↓
Ollama (Local LLM :11434)
    ↓
Your Database (never leaves your machine)
```

## 🗄️ Supported Databases

- ✅ **Microsoft SQL Server**
- ✅ **PostgreSQL**
- ✅ **MySQL / MariaDB**
- ✅ **SQLite**

## 🚀 Quick Start

### Prerequisites

1. **Python 3.11+**
2. **Node.js 20+**
3. **[Ollama](https://ollama.ai)** — local LLM runtime

### Option 1: One-command start (Linux/Mac)

```bash
chmod +x start.sh
./start.sh
```

### Option 2: Manual

**1. Install and start Ollama:**
```bash
# Install from https://ollama.ai, then:
ollama serve
ollama pull sqlcoder      # Best for SQL generation
ollama pull llama3.1      # Best for general questions
```

**2. Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**3. Frontend:**
```bash
cd frontend
npm install
npm run dev
```

**4. Open:** http://localhost:3000

### Option 3: Docker

```bash
docker-compose up --build
```

> **Important:** Ollama must run on your host machine separately — Docker containers reach it via `host.docker.internal:11434`.
>
> **Windows users:** Make sure SQL Server allows connections from `host.docker.internal`, not just `localhost`.

## 🤖 Recommended LLM Models

| Model | Best For | Size | RAM Required |
|-------|----------|------|-------------|
| `sqlcoder` | SQL generation (recommended) | ~4GB | 8GB+ |
| `llama3.1` | General questions & explanations | ~5GB | 8GB+ |
| `gemma2` | Balanced SQL + general | ~5GB | 8GB+ |
| `deepseek-coder` | Lightweight SQL | ~776MB | 4GB+ |
| `mistral` | Low RAM machines | ~4GB | 6GB+ |

```bash
ollama pull sqlcoder       # Recommended for SQL
ollama pull llama3.1       # Recommended for general questions
```

> **Note:** If you have less than 16GB RAM, use `deepseek-coder` for SQL and `mistral` for general questions.

## 📁 Project Structure

```
sqlbrain/
├── backend/
│   ├── app/
│   │   ├── main.py                    # FastAPI entry point
│   │   ├── api/
│   │   │   ├── database.py            # Connection management
│   │   │   ├── query.py               # NL→SQL, execute, explain, optimize
│   │   │   ├── schema.py              # Schema graph API
│   │   │   ├── performance.py         # Performance analysis
│   │   │   └── charts.py              # Chart generation
│   │   ├── core/
│   │   │   └── database.py            # DB connector (MSSQL/PG/MySQL/SQLite)
│   │   └── services/
│   │       ├── schema_scanner.py      # Schema metadata collector
│   │       ├── llm_service.py         # Ollama integration
│   │       ├── performance_analyzer.py # Static + dynamic analysis
│   │       └── query_history.py       # Query history store
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx               # Main app
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── ConnectModal.tsx        # DB connection dialog
│   │   │   ├── Sidebar.tsx             # Navigation
│   │   │   ├── Header.tsx              # Top bar + model selector
│   │   │   ├── QueryTab.tsx            # SQL editor + results
│   │   │   ├── SchemaTab.tsx           # Schema explorer
│   │   │   ├── PerformanceTab.tsx      # Performance analysis
│   │   │   ├── ChartsTab.tsx           # Chart generator
│   │   │   ├── HistoryTab.tsx          # Query history
│   │   │   └── ui/
│   │   │       └── ComplexityBadge.tsx
│   │   ├── store/index.ts              # Zustand global state
│   │   └── lib/api.ts                  # API client
│   ├── next.config.js
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── start.sh
└── README.md
```

## 🔒 Privacy

SQLBrain is designed for **complete local operation**:

- ✅ LLM runs locally via Ollama (no OpenAI/cloud API)
- ✅ Database never leaves your machine
- ✅ No analytics, no telemetry
- ✅ Works fully offline after initial model download

## ⚡ Performance Anti-Patterns Detected

SQLBrain automatically detects:

| Pattern | Severity |
|---------|----------|
| `SELECT *` | Medium |
| `YEAR()` / `MONTH()` on columns in WHERE | High |
| Leading wildcard `LIKE '%...'` | High |
| `UPDATE`/`DELETE` without WHERE | Critical |
| `NOT IN (SELECT ...)` | Medium |
| OR in WHERE clause | Low |
| Multiple nested SELECTs | Info |

## 🐳 Docker Notes

- The backend uses **ODBC Driver 18** for SQL Server
- Ollama runs on your **host machine**, not inside Docker
- When connecting to SQL Server from Docker, use `host.docker.internal` as the host instead of `localhost`
- The `OLLAMA_BASE_URL` environment variable is used to configure Ollama's address inside the container

## 🗺️ Roadmap

### V1 (current)
- [x] Database connection (MSSQL, PG, MySQL, SQLite)
- [x] Schema scanner
- [x] Natural language → SQL
- [x] Query execution + results

### V2
- [x] Query explanation
- [x] Schema visualization
- [x] Performance analysis

### V3
- [x] Index recommendations
- [x] Query optimizer
- [x] Chart generator

### V4 (planned)
- [ ] **Database Time Machine** — replay slow/frequent queries
- [ ] Query simulation (dry-run)
- [ ] Saved query collections
- [ ] Team collaboration mode
- [ ] Query diff viewer

## 🤝 Contributing

PRs welcome! Key areas:

- Add more database drivers
- Improve LLM prompts
- Add more chart types
- Improve schema visualization with React Flow
- Add query simulation / explain plan visualization

## 📄 License

MIT