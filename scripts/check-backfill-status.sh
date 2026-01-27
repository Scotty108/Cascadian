#!/bin/bash
# Quick status check for backfill

echo "=== BACKFILL STATUS ==="
echo "Current time: $(date)"
echo ""

# Check if process is running
if pgrep -f "backfill-canonical-fills-v4" > /dev/null; then
  echo "✅ Backfill process is running"
else
  echo "❌ Backfill process is NOT running"
fi

echo ""
echo "Latest output (last 10 lines):"
echo "---"
tail -10 /private/tmp/claude/-Users-scotty-Projects-Cascadian-app/tasks/b2b6f4e.output
echo "---"
