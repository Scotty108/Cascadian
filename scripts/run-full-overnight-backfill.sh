#!/bin/bash
# FULL OVERNIGHT BACKFILL - BLOCKCHAIN + API
# Launches 5 blockchain workers + 1 API worker in parallel
# Expected completion: 6-8 hours for blockchain, API finishes much sooner

echo "═══════════════════════════════════════════════════════════════"
echo "FULL OVERNIGHT BACKFILL - BLOCKCHAIN + API"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "This will launch:"
echo "  • 5 parallel blockchain workers (6-8 hours)"
echo "  • 1 API backfill worker (15-30 minutes)"
echo ""
read -p "Press ENTER to start, or Ctrl+C to cancel..."
echo ""

# Launch blockchain workers
./run-parallel-blockchain-backfill.sh

# Wait a moment for workers to initialize
sleep 5

# Launch API backfill in parallel
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Starting Polymarket API Backfill (parallel)"
echo "═══════════════════════════════════════════════════════════════"
echo ""

npx tsx backfill-polymarket-api.ts > polymarket-api-backfill.log 2>&1 &
API_PID=$!
echo "✓ API Backfill started (PID $API_PID)"
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "ALL WORKERS LAUNCHED!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Blockchain Workers: 5 (6-8 hours)"
echo "API Worker: 1 (15-30 minutes)"
echo ""
echo "Monitor progress:"
echo "  ./monitor-backfill-progress.sh"
echo ""
echo "Or check individual logs:"
echo "  tail -f blockchain-worker-1.log"
echo "  tail -f blockchain-worker-2.log"
echo "  tail -f blockchain-worker-3.log"
echo "  tail -f blockchain-worker-4.log"
echo "  tail -f blockchain-worker-5.log"
echo "  tail -f polymarket-api-backfill.log"
echo ""
echo "Expected results by morning:"
echo "  • Blockchain: 80%+ coverage"
echo "  • API: +10-15% coverage"
echo "  • Total: 90-95% resolution coverage"
echo ""
echo "Next steps after completion:"
echo "  npx tsx check-missing-wallet-data.ts"
echo "  npx tsx test-pnl-calculations-vs-polymarket.ts"
echo ""
