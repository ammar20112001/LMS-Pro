#!/bin/bash

echo "🛑 Stopping LMS-Pro services..."
echo ""

KILLED=0

# Kill backend (port 8000)
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    PID=$(lsof -Pi :8000 -sTCP:LISTEN -t)
    kill $PID 2>/dev/null && echo "✅ Stopped backend (PID $PID)" || echo "⚠️  Failed to kill backend"
    KILLED=$((KILLED + 1))
else
    echo "ℹ️  Backend not running"
fi

# Kill frontend (port 5173)
if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1; then
    PID=$(lsof -Pi :5173 -sTCP:LISTEN -t)
    kill $PID 2>/dev/null && echo "✅ Stopped frontend (PID $PID)" || echo "⚠️  Failed to kill frontend"
    KILLED=$((KILLED + 1))
else
    echo "ℹ️  Frontend not running"
fi

echo ""
if [ $KILLED -gt 0 ]; then
    echo "✅ Closed $KILLED service(s)"
else
    echo "ℹ️  No services were running"
fi
