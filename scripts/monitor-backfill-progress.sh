#!/bin/bash
# BACKFILL PROGRESS MONITOR
# Displays real-time status of all 5 blockchain workers + API backfill

clear
echo "═══════════════════════════════════════════════════════════════"
echo "BACKFILL PROGRESS MONITOR"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Check if workers are running
echo "Worker Status:"
echo "──────────────────────────────────────────────────────────────"

for i in {1..5}; do
  if pgrep -f "WORKER_ID=$i" > /dev/null; then
    echo "✓ Worker $i: RUNNING"
  else
    echo "✗ Worker $i: STOPPED"
  fi
done

# Check API backfill
if pgrep -f "backfill-polymarket-api.ts" > /dev/null; then
  echo "✓ API Backfill: RUNNING"
else
  echo "✗ API Backfill: STOPPED"
fi

echo ""
echo "Latest Progress (last 3 lines from each worker):"
echo "══════════════════════════════════════════════════════════════"

for i in {1..5}; do
  if [ -f "blockchain-worker-$i.log" ]; then
    echo ""
    echo "Worker $i (last update):"
    tail -3 blockchain-worker-$i.log | grep -E "Progress:|Batch|ETA" | tail -1 || echo "  (initializing...)"
  fi
done

if [ -f "polymarket-api-backfill.log" ]; then
  echo ""
  echo "API Backfill (last update):"
  tail -3 polymarket-api-backfill.log | grep -E "Progress:|Rate|ETA" | tail -1 || echo "  (initializing...)"
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "Detailed logs:"
echo "  tail -f blockchain-worker-1.log"
echo "  tail -f blockchain-worker-2.log"
echo "  tail -f blockchain-worker-3.log"
echo "  tail -f blockchain-worker-4.log"
echo "  tail -f blockchain-worker-5.log"
echo "  tail -f polymarket-api-backfill.log"
echo ""
echo "Re-run this script: ./monitor-backfill-progress.sh"
echo ""
