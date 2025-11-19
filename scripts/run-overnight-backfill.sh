#!/bin/bash
# Overnight Backfill - Sequential Execution
# Phase 1: Blockchain → Phase 2: API
# Expected: 90-95% coverage by morning

echo "═══════════════════════════════════════════════════════════════"
echo "OVERNIGHT BACKFILL - TWO-PHASE SEQUENTIAL EXECUTION"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Phase 1: Blockchain backfill (80% coverage, ~38 min)"
echo "Phase 2: Polymarket API backfill (+10-15% coverage, ~10-15 min)"
echo ""
echo "Total expected: 90-95% coverage"
echo "Total runtime: ~50-60 minutes"
echo ""
echo "Starting Phase 1..."
echo ""

# Phase 1: Blockchain Backfill
npx tsx blockchain-resolution-backfill.ts

BLOCKCHAIN_EXIT=$?
if [ $BLOCKCHAIN_EXIT -ne 0 ]; then
  echo ""
  echo "❌ Phase 1 (Blockchain) failed with exit code $BLOCKCHAIN_EXIT"
  echo "Check blockchain-backfill.log for details"
  exit 1
fi

echo ""
echo "✅ Phase 1 Complete - Blockchain backfill finished"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Starting Phase 2: Polymarket API Backfill"
echo "═══════════════════════════════════════════════════════════════"
echo ""
sleep 2

# Phase 2: API Backfill
npx tsx backfill-polymarket-api.ts

API_EXIT=$?
if [ $API_EXIT -ne 0 ]; then
  echo ""
  echo "⚠️  Phase 2 (API) failed with exit code $API_EXIT"
  echo "However, Phase 1 completed successfully with 80% coverage"
  echo "Check logs for details"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "🎉 OVERNIGHT BACKFILL COMPLETE!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Both phases completed successfully:"
echo "  ✅ Phase 1: Blockchain backfill (80% coverage)"
echo "  ✅ Phase 2: API backfill (+10-15% coverage)"
echo ""
echo "Expected final coverage: 90-95%"
echo ""
echo "Next steps:"
echo "  1. Check coverage: npx tsx check-missing-wallet-data.ts"
echo "  2. Test P&L: npx tsx test-pnl-calculations-vs-polymarket.ts"
echo "  3. Ship P&L feature! 🚀"
echo ""
