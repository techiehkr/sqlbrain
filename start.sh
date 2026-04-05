#!/bin/bash
# SQLBrain Startup Script

set -e

echo ""
echo "  ███████╗ ██████╗ ██╗     ██████╗ ██████╗  █████╗ ██╗███╗   ██╗"
echo "  ██╔════╝██╔═══██╗██║     ██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║"
echo "  ███████╗██║   ██║██║     ██████╔╝██████╔╝███████║██║██╔██╗ ██║"
echo "  ╚════██║██║▄▄ ██║██║     ██╔══██╗██╔══██╗██╔══██║██║██║╚██╗██║"
echo "  ███████║╚██████╔╝███████╗██████╔╝██║  ██║██║  ██║██║██║ ╚████║"
echo "  ╚══════╝ ╚══▀▀═╝ ╚══════╝╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝"
echo ""
echo "  Local AI Database Assistant"
echo ""

# ── Check Ollama ──────────────────────────────────────────────────────────────
if command -v ollama &> /dev/null; then
    echo "✅ Ollama found"
    if curl -s http://localhost:11434/api/tags &> /dev/null; then
        echo "✅ Ollama is running"
    else
        echo "🚀 Starting Ollama..."
        ollama serve &
        sleep 3
    fi

    # Check RAM and suggest appropriate model
    TOTAL_RAM_GB=$(free -g 2>/dev/null | awk '/^Mem:/{print $2}' || echo "0")

    # Primary SQL model
    if ollama list | grep -q "sqlcoder"; then
        echo "✅ sqlcoder model ready (SQL generation)"
    else
        echo "⬇️  Pulling sqlcoder (~4GB) — best model for SQL generation..."
        ollama pull sqlcoder
    fi

    # General question model — check RAM first
    if [ "$TOTAL_RAM_GB" -ge 12 ] 2>/dev/null; then
        if ollama list | grep -q "llama3.1"; then
            echo "✅ llama3.1 model ready (general questions)"
        else
            echo "⬇️  Pulling llama3.1 (~5GB) for general questions..."
            ollama pull llama3.1
        fi
    else
        if ollama list | grep -q "mistral"; then
            echo "✅ mistral model ready (general questions)"
        else
            echo "⬇️  Pulling mistral (~4GB) — recommended for your RAM..."
            ollama pull mistral
        fi
    fi

else
    echo "⚠️  Ollama not found. Install from https://ollama.ai"
    echo "   Then run:"
    echo "     ollama pull sqlcoder"
    echo "     ollama pull llama3.1"
    echo ""
fi

echo ""

# ── Backend ───────────────────────────────────────────────────────────────────
echo "🐍 Starting backend (FastAPI)..."
cd backend
if [ ! -d "venv" ]; then
    echo "   Creating virtual environment..."
    python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt -q
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

sleep 2
echo "✅ Backend running at http://localhost:8000"

# ── Frontend ──────────────────────────────────────────────────────────────────
echo ""
echo "⚡ Starting frontend (Next.js)..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "   Installing dependencies..."
    npm install
fi
npm run dev &
FRONTEND_PID=$!
cd ..

sleep 3
echo "✅ Frontend running at http://localhost:3000"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🧠 SQLBrain is ready!"
echo "  Open: http://localhost:3000"
echo ""
echo "  Models in use:"
echo "    SQL generation  → sqlcoder"
echo "    General questions → llama3.1 / mistral"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop all services"

trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait