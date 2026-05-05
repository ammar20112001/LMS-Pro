#!/bin/bash

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

echo "🚀 LMS-Pro — Starting frontend and backend..."
echo ""

# Trap to kill both processes on exit
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT

# Start backend
echo "📦 Starting backend (FastAPI)..."
cd "$BACKEND_DIR"
uvicorn app.main:app --reload &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"
sleep 2

# Start frontend
echo "⚛️  Starting frontend (React + Vite)..."
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!
echo "   Frontend PID: $FRONTEND_PID"

echo ""
echo "✅ Services running:"
echo "   Backend:  http://localhost:8000 (API at /api/...)"
echo "   Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop all services..."
echo ""

# Wait for both processes
wait
