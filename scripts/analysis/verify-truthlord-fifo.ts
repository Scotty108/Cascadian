#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xa3a6fa49a39a4bf84cf510b7c8a2ab8be8508c44';

async function verifyTruthlordFifo() {
  console.log(`=== Verifying FIFO v3 data for ${WALLET} ===\n`);

  // Check total trades in FIFO v3
  const fifoResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(pnl_usd > 0) as wins,
        countIf(pnl_usd <= 0) as losses,
        round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,
        sum(pnl_usd) as total_pnl,
        round(sum(roi) * 100.0 / count(), 1) as avg_roi_pct,
        round(median(roi) * 100, 1) as median_roi_pct,
        min(resolved_at) as first_trade,
        max(resolved_at) as last_trade
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${WALLET}'
        AND abs(cost_usd) >= 10
    `,
    format: 'JSONEachRow'
  });

  const stats = (await fifoResult.json()) as any[];
  console.log('FIFO v3 Stats:');
  console.log(JSON.stringify(stats[0], null, 2));
  console.log();

  // Show recent trades
  const tradesResult = await clickhouse.query({
    query: `
      SELECT
        tx_hash,
        condition_id,
        outcome_index,
        entry_time,
        resolved_at,
        tokens,
        cost_usd,
        pnl_usd,
        round(roi * 100, 1) as roi_pct,
        is_short
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '${WALLET}'
        AND abs(cost_usd) >= 10
      ORDER BY resolved_at DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const trades = (await tradesResult.json()) as any[];
  console.log(`Recent 20 trades (of ${stats[0].total_trades} total):`);
  trades.forEach((t, i) => {
    console.log(`\n${i + 1}. ${t.tx_hash.slice(0, 16)}...`);
    console.log(`   Condition: ${t.condition_id.slice(0, 16)}...`);
    console.log(`   Entry: ${t.entry_time} → Resolved: ${t.resolved_at}`);
    console.log(`   Cost: $${t.cost_usd} | PnL: $${t.pnl_usd} | ROI: ${t.roi_pct}%`);
    console.log(`   Short: ${t.is_short === 1 ? 'YES' : 'NO'}`);
  });
}

verifyTruthlordFifo().catch(console.error);
