#!/bin/bash
# Setup script for Claude Self-Reflect MCP with Docker

set -e

echo "🚀 Setting up Claude Self-Reflect MCP Gateway..."
echo ""

# Check if Docker is running
if ! docker ps &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi

echo "✅ Docker is running"

# Stop any existing containers
echo "Cleaning up existing containers..."
docker stop claude-reflection-mcp 2>/dev/null || true
docker rm claude-reflection-mcp 2>/dev/null || true

# Start the new MCP gateway stack
echo "Starting MCP gateway stack..."
docker compose -f docker-compose.mcp.yml up -d

echo ""
echo "⏳ Waiting for services to start..."
sleep 5

# Verify Qdrant is running
if curl -s http://localhost:6333/ > /dev/null; then
    echo "✅ Qdrant vector DB is running on port 6333"
else
    echo "❌ Qdrant is not responding"
    exit 1
fi

# Test MCP connection
echo "Testing MCP connection..."
sleep 2

# Restart Claude Code to reconnect MCPs
echo ""
echo "✅ Claude Self-Reflect MCP setup complete!"
echo ""
echo "Next steps:"
echo "1. Restart Claude Code (press Ctrl+C and run again)"
echo "2. Run: claude mcp list"
echo "3. Verify: claude-self-reflect should show ✅ Connected"
echo ""
echo "You can now use vector search in Claude Code!"
