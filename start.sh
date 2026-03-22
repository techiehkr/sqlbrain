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

# Check Ollama
if command -v ollama &> /dev/null; then
    echo "✅ Ollama found"
    if curl -s http://localhost:11434/api/tags &> /dev/null; then
        echo "✅ Ollama is running"
    else
        echo "🚀 Starting Ollama..."
        ollama serve &
        sleep 3
    fi

    # Check if llama3.1 is available (primary model)
    if ollama list | grep -q "llama3.1"; then
        echo "✅ llama3.1 model ready"
    else
        echo "⬇️  Pulling llama3.1 (first time only, ~4.7GB)..."
        ollama pull llama3.1
    fi
else
    echo "⚠️  Ollama not found. Install from https://ollama.ai"
    echo "   Then run: ollama pull llama3.1"
fi

echo ""

# Backend
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

# Frontend
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
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🧠 SQLBrain is ready!"
echo "  Open: http://localhost:3000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop all services"

trap "echo 'Stopping...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait