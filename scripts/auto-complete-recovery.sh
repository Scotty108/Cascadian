#!/bin/bash
# Auto-complete recovery phases 7-8 after FIFO rebuild

set -e

LOG="/tmp/recovery-auto-complete.log"
CRON_SECRET="${CRON_SECRET}"

echo "=== AUTO RECOVERY COMPLETION ===" | tee -a "$LOG"
echo "Started: $(date)" | tee -a "$LOG"
echo "" | tee -a "$LOG"

# Phase 6: Wait for FIFO rebuild to complete
echo "Phase 6: Waiting for FIFO rebuild to complete..." | tee -a "$LOG"
while pgrep -f "build-trade-fifo-v4" > /dev/null; do
  sleep 60
done
echo "✅ FIFO rebuild completed: $(date)" | tee -a "$LOG"
echo "" | tee -a "$LOG"

# Phase 7: Refresh leaderboards
echo "Phase 7: Refreshing leaderboards..." | tee -a "$LOG"
START_PHASE7=$(date +%s)

echo "  → Refreshing WIO scores..." | tee -a "$LOG"
curl -s -H "Authorization: Bearer ${CRON_SECRET}" \
  "https://cascadian.vercel.app/api/cron/refresh-wio-scores" >> "$LOG" 2>&1
echo "  ✅ WIO scores complete" | tee -a "$LOG"

echo "  → Refreshing copy trading leaderboard..." | tee -a "$LOG"
curl -s -H "Authorization: Bearer ${CRON_SECRET}" \
  "https://cascadian.vercel.app/api/cron/refresh-copy-trading-leaderboard" >> "$LOG" 2>&1
echo "  ✅ Copy trading complete" | tee -a "$LOG"

echo "  → Refreshing smart money..." | tee -a "$LOG"
curl -s -H "Authorization: Bearer ${CRON_SECRET}" \
  "https://cascadian.vercel.app/api/cron/refresh-smart-money" >> "$LOG" 2>&1
echo "  ✅ Smart money complete" | tee -a "$LOG"

END_PHASE7=$(date +%s)
PHASE7_DURATION=$(( (END_PHASE7 - START_PHASE7) / 60 ))
echo "✅ Phase 7 complete in ${PHASE7_DURATION} minutes: $(date)" | tee -a "$LOG"
echo "" | tee -a "$LOG"

# Phase 8: Final validation
echo "Phase 8: Final validation..." | tee -a "$LOG"

echo "  → Running validation queries..." | tee -a "$LOG"
npx tsx << 'EOF' >> "$LOG" 2>&1
import { clickhouse } from './lib/clickhouse/client';

async function validate() {
  // Check FIFO table has data for Jan 17-27
  const fifoCheck = await clickhouse.query({
    query: `
      SELECT
        toDate(resolved_at) as date,
        count() as positions,
        uniq(wallet) as wallets
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at >= '2026-01-17' AND resolved_at <= '2026-01-27'
      GROUP BY date
      ORDER BY date
    `,
    format: 'JSONEachRow'
  });
  const fifoData = await fifoCheck.json();
  console.log('FIFO table data (Jan 17-27):');
  console.log(JSON.stringify(fifoData, null, 2));

  // Check canonical fills still clean
  const fillsCheck = await clickhouse.query({
    query: `
      SELECT
        countIf(condition_id = '') * 100.0 / count() as empty_pct
      FROM pm_canonical_fills_v4
      WHERE event_time >= '2026-01-17' AND event_time <= '2026-01-27'
        AND source = 'clob'
    `,
    format: 'JSONEachRow'
  });
  const fillsData = await fillsCheck.json();
  console.log('Canonical fills quality:');
  console.log(JSON.stringify(fillsData, null, 2));

  console.log('\n✅ Validation complete');
}

validate().catch(console.error);
EOF

echo "✅ Phase 8 complete: $(date)" | tee -a "$LOG"
echo "" | tee -a "$LOG"

# Summary
echo "=== RECOVERY COMPLETE ===" | tee -a "$LOG"
echo "Finished: $(date)" | tee -a "$LOG"
echo "Full recovery log: $LOG" | tee -a "$LOG"
