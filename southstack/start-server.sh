#!/bin/bash
# Quick start script for SouthStack
# Starts a local HTTP server to serve the files

echo "🚀 Starting SouthStack HTTP Server..."
echo ""
echo "Server will be available at: http://localhost:8000/southstack/"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Try Python 3 first, then Python 2, then suggest alternatives
if command -v python3 &> /dev/null; then
    cd "$(dirname "$0")"
    python3 -m http.server 8000
elif command -v python &> /dev/null; then
    cd "$(dirname "$0")"
    python -m SimpleHTTPServer 8000
else
    echo "❌ Python not found. Please install Python or use one of these alternatives:"
    echo ""
    echo "Node.js: npx http-server -p 8000"
    echo "PHP: php -S localhost:8000"
    echo "VS Code: Install 'Live Server' extension"
    exit 1
fi
