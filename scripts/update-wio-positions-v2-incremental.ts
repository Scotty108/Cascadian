#!/usr/bin/env npx tsx
/**
 * Incremental Update for wio_positions_v2
 *
 * Processes missing positions from Jan 13-16, 2026
 * Uses same logic as rebuild-wio-positions-v2.ts but only for recent data
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const START_TIME = '2026-01-13 07:22:00'; // After v1 stopped

// Generate wallet prefixes to batch by (avoids partition limit)
const WALLET_PREFIXES: string[] = [];
for (const a of '0123456789abcdef') {
  for (const b of '0123456789abcdef') {
    WALLET_PREFIXES.push(`0x${a}${b}`);
  }
}

async function updateIncremental() {
  console.log('🔧 Incremental Update: wio_positions_v2');
  console.log(`   Processing fills from ${START_TIME} onwards`);
  console.log(`   Using ${WALLET_PREFIXES.length} wallet prefix batches`);
  console.log('');

  const startTime = Date.now();

  let totalInserted = 0;

  console.log('📊 Processing wallet batches...');

  for (let i = 0; i < WALLET_PREFIXES.length; i++) {
    const prefix = WALLET_PREFIXES[i];
    const pct = Math.round((i / WALLET_PREFIXES.length) * 100);

    if (i % 16 === 0) {
      process.stdout.write(`\r   Progress: ${i}/${WALLET_PREFIXES.length} (${pct}%) | Inserted: ${totalInserted.toLocaleString()}   `);
    }

    const insertQuery = `
      INSERT INTO wio_positions_v2 (
        position_id, wallet_id, condition_id, outcome_index, market_id, side, category,
        primary_bundle_id, event_id, ts_open, ts_close, ts_resolve, end_ts,
        net_tokens, net_cash, qty_shares_opened, qty_shares_closed, qty_shares_remaining,
        cost_usd, proceeds_usd, fees_usd, p_entry_side,
        p_anchor_4h_side, p_anchor_24h_side, p_anchor_72h_side,
        is_resolved, payout_rate, outcome_side, pnl_usd, roi, hold_minutes,
        clv_4h, clv_24h, clv_72h, brier_score,
        fills_count, first_fill_id, last_fill_id, created_at, updated_at
      )
      SELECT
        cityHash64(concat(wallet, condition_id, toString(outcome_index))),
        wallet, condition_id, outcome_index, condition_id,
        CASE WHEN outcome_index = 0 THEN 'NO' ELSE 'YES' END, '', '', '', ts_open,
        CASE WHEN qty_sold >= qty_bought THEN ts_last_fill ELSE NULL END,
        r.resolved_at, coalesce(r.resolved_at, ts_last_fill),
        qty_bought - qty_sold, -cost_usd + proceeds_usd,
        qty_bought, qty_sold, qty_bought - qty_sold,
        cost_usd, proceeds_usd, 0,
        CASE WHEN qty_bought > 0 THEN cost_usd / qty_bought ELSE 0 END,
        NULL, NULL, NULL,
        CASE WHEN r.resolved_at IS NOT NULL THEN 1 ELSE 0 END,
        CASE WHEN r.payout_numerators = '[1,1]' THEN 0.5
             WHEN r.payout_numerators = '[0,1]' AND outcome_index = 1 THEN 1.0
             WHEN r.payout_numerators = '[1,0]' AND outcome_index = 0 THEN 1.0 ELSE 0.0 END,
        CASE WHEN r.payout_numerators = '[1,1]' THEN NULL
             WHEN r.payout_numerators = '[0,1]' AND outcome_index = 1 THEN 1
             WHEN r.payout_numerators = '[1,0]' AND outcome_index = 0 THEN 1
             WHEN r.payout_numerators = '[0,1]' AND outcome_index = 0 THEN 0
             WHEN r.payout_numerators = '[1,0]' AND outcome_index = 1 THEN 0 ELSE NULL END,
        proceeds_usd + (qty_bought - qty_sold) * CASE
          WHEN r.payout_numerators = '[1,1]' THEN 0.5
          WHEN r.payout_numerators = '[0,1]' AND outcome_index = 1 THEN 1.0
          WHEN r.payout_numerators = '[1,0]' AND outcome_index = 0 THEN 1.0 ELSE 0.0 END - cost_usd,
        CASE WHEN cost_usd > 0 THEN (proceeds_usd + (qty_bought - qty_sold) * CASE
          WHEN r.payout_numerators = '[1,1]' THEN 0.5
          WHEN r.payout_numerators = '[0,1]' AND outcome_index = 1 THEN 1.0
          WHEN r.payout_numerators = '[1,0]' AND outcome_index = 0 THEN 1.0 ELSE 0.0 END - cost_usd) / cost_usd ELSE 0 END,
        dateDiff('minute', ts_open, coalesce(r.resolved_at, ts_last_fill)),
        NULL, NULL, NULL,
        CASE WHEN r.resolved_at IS NOT NULL AND qty_bought > 0 THEN
          pow((cost_usd / qty_bought) - CASE
            WHEN r.payout_numerators = '[0,1]' AND outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators = '[1,0]' AND outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators = '[1,1]' THEN 0.5 ELSE 0.0 END, 2) ELSE NULL END,
        toInt32(fills_count), first_fill_id, last_fill_id, now(), now()
      FROM (
        SELECT wallet, condition_id, outcome_index,
          sumIf(tokens_delta, tokens_delta > 0) as qty_bought,
          sumIf(abs(tokens_delta), tokens_delta < 0) as qty_sold,
          sumIf(abs(usdc_delta), usdc_delta < 0) as cost_usd,
          sumIf(usdc_delta, usdc_delta > 0) as proceeds_usd,
          min(event_time) as ts_open, max(event_time) as ts_last_fill,
          count() as fills_count, min(fill_id) as first_fill_id, max(fill_id) as last_fill_id
        FROM pm_canonical_fills_v4
        WHERE event_time >= '${START_TIME}' AND condition_id != '' AND source != 'negrisk'
          AND startsWith(wallet, '${prefix}')
        GROUP BY wallet, condition_id, outcome_index
        HAVING qty_bought > 0 OR qty_sold > 0
      ) f
      LEFT JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id AND r.is_deleted = 0
    `;

    try {
      await clickhouse.command({ query: insertQuery });
      const countResult = await clickhouse.query({
        query: `SELECT count() as cnt FROM wio_positions_v2 WHERE startsWith(wallet_id, '${prefix}') AND ts_open >= '${START_TIME}'`,
        format: 'JSONEachRow'
      });
      const rows = await countResult.json() as any[];
      totalInserted += rows[0]?.cnt || 0;
    } catch (err: any) {
      console.error(`\n   ⚠️  Error on prefix ${prefix}: ${err.message.slice(0, 100)}`);
    }
  }

  console.log(`\n✅ Inserted ${totalInserted.toLocaleString()} positions`);

  // Verify overall counts
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_positions,
        max(ts_open) as latest_position,
        countIf(ts_open >= now() - INTERVAL 24 HOUR) as last_24h
      FROM wio_positions_v2
    `,
    format: 'JSONEachRow'
  });
  const stats = (await statsResult.json() as any[])[0];

  console.log('\n📊 Table Stats:');
  console.log(`   Total positions: ${Number(stats.total_positions).toLocaleString()}`);
  console.log(`   Latest position: ${stats.latest_position}`);
  console.log(`   Last 24h: ${Number(stats.last_24h).toLocaleString()}`);

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n⏱️  Completed in ${elapsed}s`);
}

updateIncremental().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
