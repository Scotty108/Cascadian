#!/usr/bin/env npx tsx
/**
 * Debug FIFO v4 data for wallet 0x9841fc8f954cdffb5c3eb703caf86cec7d335189
 * Compare with API data to find discrepancies
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x9841fc8f954cdffb5c3eb703caf86cec7d335189';

async function debugWalletFifo() {
  console.log(`=== Debugging FIFO v4 for ${WALLET} ===\n`);

  // Query FIFO v4 data
  const fifoResult = await clickhouse.query({
    query: `
      WITH
      -- CRITICAL: Deduplicate FIFO table first (278M → 78M rows)
      deduped_fifo AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          any(tx_hash) as tx_hash,
          any(entry_time) as entry_time,
          any(resolved_at) as resolved_at,
          any(tokens) as tokens,
          any(cost_usd) as cost_usd,
          any(pnl_usd) as pnl_usd,
          any(roi) as roi,
          any(is_short) as is_short,
          any(is_maker) as is_maker
        FROM pm_trade_fifo_roi_v3
        WHERE wallet = '${WALLET}'
        GROUP BY wallet, condition_id, outcome_index
      )
      SELECT
        tx_hash,
        condition_id,
        outcome_index,
        entry_time,
        resolved_at,
        tokens,
        cost_usd,
        pnl_usd,
        roi,
        is_short,
        is_maker
      FROM deduped_fifo
      ORDER BY resolved_at DESC
    `,
    format: 'JSONEachRow'
  });

  const fifoTrades = (await fifoResult.json()) as any[];

  console.log(`\n📊 FIFO v4 Table Stats:`);
  console.log(`   Total trades: ${fifoTrades.length}`);
  console.log(`   Longs: ${fifoTrades.filter(t => t.is_short === 0).length}`);
  console.log(`   Shorts: ${fifoTrades.filter(t => t.is_short === 1).length}`);

  const totalPnl = fifoTrades.reduce((sum, t) => sum + parseFloat(t.pnl_usd), 0);
  const winners = fifoTrades.filter(t => parseFloat(t.pnl_usd) > 0).length;

  console.log(`   Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`   Winners: ${winners} (${((winners / fifoTrades.length) * 100).toFixed(1)}%)`);
  console.log(`   Losers: ${fifoTrades.length - winners}`);

  console.log(`\n\n📋 Trade Breakdown (most recent 20):\n`);
  fifoTrades.slice(0, 20).forEach((t, i) => {
    const type = t.is_short ? 'SHORT' : 'LONG';
    const pnl = parseFloat(t.pnl_usd);
    const roi = parseFloat(t.roi) * 100;
    const outcome = pnl > 0 ? '✅' : '❌';

    console.log(`${i + 1}. ${outcome} ${type} | PnL: $${pnl.toFixed(0)} (${roi.toFixed(0)}% ROI)`);
    console.log(`   Cost: $${t.cost_usd} | Resolved: ${t.resolved_at}`);
    console.log(`   Condition: ${t.condition_id.slice(0, 16)}...`);
    console.log();
  });

  // Now compare with canonical fills to see what we're missing
  console.log('\n\n=== Checking for Missing Trades ===\n');

  const canonicalResult = await clickhouse.query({
    query: `
      SELECT DISTINCT
        condition_id,
        count(DISTINCT fill_id) as fills
      FROM pm_canonical_fills_v4
      WHERE wallet = '${WALLET}'
      GROUP BY condition_id
      ORDER BY fills DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const canonicalConditions = (await canonicalResult.json()) as any[];
  console.log(`Conditions with fills in canonical table: ${canonicalConditions.length}`);

  // Check which conditions have resolutions
  const resolvedResult = await clickhouse.query({
    query: `
      SELECT condition_id
      FROM pm_condition_resolutions
      WHERE condition_id IN (${canonicalConditions.map(c => `'${c.condition_id}'`).join(',')})
        AND payout_numerators != ''
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });

  const resolvedConditions = (await resolvedResult.json()) as any[];
  console.log(`Conditions that are resolved: ${resolvedConditions.length}`);

  // Check how many are in FIFO table
  const fifoConditions = new Set(fifoTrades.map(t => t.condition_id));
  console.log(`Conditions in FIFO table: ${fifoConditions.size}`);
  console.log(`Missing from FIFO: ${resolvedConditions.length - fifoConditions.size}`);

  // Show missing conditions
  const missingConditions = resolvedConditions
    .filter(c => !fifoConditions.has(c.condition_id))
    .slice(0, 10);

  if (missingConditions.length > 0) {
    console.log(`\n⚠️ Sample Missing Conditions:`);
    missingConditions.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.condition_id.slice(0, 32)}...`);
    });
  }
}

debugWalletFifo().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
