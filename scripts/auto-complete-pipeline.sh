#!/bin/bash
# Auto-Complete Pipeline: Monitors parallel workers and triggers full enrichment + metrics

echo "═══════════════════════════════════════════════════════════"
echo "  AUTO-COMPLETE PIPELINE MONITOR"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Monitoring 10 parallel Goldsky workers..."
echo "When all complete, will automatically:"
echo "  1. Enrich all new trades with market_id"
echo "  2. Compute overall metrics for all ~28k wallets"
echo "  3. Compute per-category metrics"
echo "  4. Generate final report"
echo ""

# Function to check if all workers are done
check_workers_done() {
  RUNNING=$(ps aux | grep goldsky-load-recent-trades | grep -v grep | wc -l)
  if [ $RUNNING -eq 0 ]; then
    return 0  # Done
  else
    return 1  # Still running
  fi
}

# Monitor loop
START_TIME=$(date +%s)
while true; do
  if check_workers_done; then
    echo ""
    echo "✅ All workers completed!"
    break
  fi

  # Show progress every 60 seconds
  ELAPSED=$(($(date +%s) - START_TIME))
  MINS=$((ELAPSED / 60))

  # Count total trades loaded so far
  TOTAL_TRADES=0
  for log in runtime/parallel-loads/worker_*.log; do
    if [ -f "$log" ]; then
      TRADES=$(grep -o "inserted: [0-9]*" "$log" | tail -1 | awk '{print $2}')
      TOTAL_TRADES=$((TOTAL_TRADES + TRADES))
    fi
  done

  echo "⏳ [$MINS min] Workers still running. Trades loaded: $TOTAL_TRADES"
  sleep 60
done

TOTAL_TIME=$(($(date +%s) - START_TIME))
echo "   Total load time: $((TOTAL_TIME / 60)) minutes"
echo ""

# Step 1: Nuclear backfill market_id for new trades
echo "═══════════════════════════════════════════════════════════"
echo "STEP 1: Enriching new trades with market_id"
echo "═══════════════════════════════════════════════════════════"
npx tsx scripts/nuclear-backfill-v2.ts 2>&1 | tee runtime/auto-enrichment.log
echo ""

# Step 2: Compute overall metrics
echo "═══════════════════════════════════════════════════════════"
echo "STEP 2: Computing overall metrics for all wallets"
echo "═══════════════════════════════════════════════════════════"
npx tsx scripts/compute-wallet-metrics.ts 2>&1 | tee runtime/auto-metrics-overall.log
echo ""

# Step 3: Compute per-category metrics
echo "═══════════════════════════════════════════════════════════"
echo "STEP 3: Computing per-category metrics"
echo "═══════════════════════════════════════════════════════════"
npx tsx scripts/compute-wallet-metrics-by-category.ts 2>&1 | tee runtime/auto-metrics-category.log
echo ""

# Step 4: Final report
echo "═══════════════════════════════════════════════════════════"
echo "✅ COMPLETE PIPELINE FINISHED!"
echo "═══════════════════════════════════════════════════════════"

# Query final stats
echo ""
echo "📊 FINAL DATABASE STATE:"
npx tsx << 'SCRIPT'
import { clickhouse } from './lib/clickhouse/client'

async function finalStats() {
  const trades = await clickhouse.query({
    query: 'SELECT COUNT(*) as count, COUNT(DISTINCT wallet_address) as wallets FROM trades_raw WHERE market_id != ""',
    format: 'JSONEachRow'
  })
  const tradesData = await trades.json()

  const metrics = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as count FROM wallet_metrics_complete',
    format: 'JSONEachRow'
  })
  const metricsData = await metrics.json()

  const catMetrics = await clickhouse.query({
    query: 'SELECT COUNT(DISTINCT wallet_address) as wallets, COUNT(DISTINCT category) as categories FROM wallet_metrics_by_category',
    format: 'JSONEachRow'
  })
  const catData = await catMetrics.json()

  console.log(`   Enriched trades: ${tradesData[0].count}`)
  console.log(`   Enriched wallets: ${tradesData[0].wallets}`)
  console.log(`   Wallets with overall metrics: ${metricsData[0].count}`)
  console.log(`   Wallets with category metrics: ${catData[0].wallets}`)
  console.log(`   Categories covered: ${catData[0].categories}`)
  console.log('')
  console.log('🎯 LEADERBOARD READY!')
  console.log('   /api/omega/leaderboard - Overall rankings')
  console.log('   /api/omega/category/:category - Category rankings')
  console.log('')
}

finalStats().catch(console.error)
SCRIPT

echo "═══════════════════════════════════════════════════════════"
