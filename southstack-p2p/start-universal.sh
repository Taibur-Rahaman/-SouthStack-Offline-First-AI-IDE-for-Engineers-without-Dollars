#!/bin/bash
# SouthStack Universal Server - Easy Start Script
# Works on ANY router/network - macOS, Linux, Windows (WSL/Git Bash)

echo "🚀 Starting SouthStack Universal Server..."
echo ""

cd "$(dirname "$0")"

# Check Python version
if command -v python3 &> /dev/null; then
    PYTHON_CMD=python3
elif command -v python &> /dev/null; then
    PYTHON_CMD=python
else
    echo "❌ Python not found. Please install Python 3.6+"
    exit 1
fi

echo "✅ Using Python: $PYTHON_CMD"
echo ""

# Run universal server
$PYTHON_CMD serve_universal.py
