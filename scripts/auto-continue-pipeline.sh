#!/bin/bash
# Auto-Continue Pipeline
# Waits for Step E to complete, then runs gates + Phase 2 automatically

echo "🤖 Auto-Continue Pipeline Started"
echo "   Monitoring Step E process..."

# Wait for Step E to complete
while ps aux | grep "full-enrichment-pass.ts --step=E" | grep -v grep > /dev/null; do
  sleep 10
done

echo ""
echo "✅ Step E Complete!"
echo "   Starting gates validation..."
echo ""

# Run gates
npx tsx scripts/print-gates.ts | tee runtime/gates-output.log

# Check if gates passed
if grep -q "PASS.*PASS.*PASS.*PASS" runtime/gates-output.log; then
  echo ""
  echo "✅ All gates PASSED!"
  echo "   Starting Phase 2: Wallet Metrics..."
  echo ""

  # Phase 2: Wallet metrics
  npx tsx scripts/compute-wallet-metrics.ts | tee runtime/phase2-wallet-metrics.log

  echo ""
  echo "✅ Wallet metrics complete!"
  echo "   Starting Phase 2: Category Metrics..."
  echo ""

  # Phase 2: Category metrics
  npx tsx scripts/compute-wallet-metrics-by-category.ts | tee runtime/phase2-category-metrics.log

  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "🎉 PHASE 1 + PHASE 2 COMPLETE!"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "📊 Next: Choose wallet threshold and load filtered wallets"
  echo ""
else
  echo ""
  echo "❌ Gates FAILED - stopping pipeline"
  echo "   Check runtime/gates-output.log for details"
  echo ""
fi
