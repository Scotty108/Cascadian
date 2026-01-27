/**
 * Backfill Jan 17-27 (corruption period) by DAY for speed and reliability
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Only backfill the corruption period (Jan 17-27) + 1 day buffer on each side
const DAYS = [
  '2026-01-16', // Day before corruption
  '2026-01-17', '2026-01-18', '2026-01-19', '2026-01-20',
  '2026-01-21', '2026-01-22', '2026-01-23', '2026-01-24',
  '2026-01-25', '2026-01-26', '2026-01-27',
  '2026-01-28'  // Day after (partial)
];

async function backfillDay(date: string) {
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  const endDate = nextDay.toISOString().slice(0, 10);

  process.stdout.write(`[${date}] `);
  const dayStart = Date.now();

  // CLOB - just this one source is what we need to fix
  await clickhouse.command({
    query: `
      INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
      SELECT
        concat('clob_', event_id) as fill_id,
        trade_time as event_time,
        block_number,
        transaction_hash as tx_hash,
        trader_wallet as wallet,
        m.condition_id,
        m.outcome_index,
        CASE WHEN side = 'buy' THEN token_amount / 1e6 ELSE -token_amount / 1e6 END as tokens_delta,
        CASE WHEN side = 'buy' THEN -usdc_amount / 1e6 ELSE usdc_amount / 1e6 END as usdc_delta,
        'clob' as source,
        0 as is_self_fill,
        role = 'maker' as is_maker
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE t.trade_time >= '${date}' AND t.trade_time < '${endDate}'
        AND m.condition_id != ''
    `,
    clickhouse_settings: {
      max_execution_time: 600, // 10 minutes
      max_memory_usage: 15000000000 // 15GB
    }
  });

  const elapsed = ((Date.now() - dayStart) / 1000).toFixed(1);
  console.log(`✓ ${elapsed}s`);
}

async function main() {
  const startTime = Date.now();
  console.log('=== BACKFILL JAN 17-27 (DAILY) ===');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Processing ${DAYS.length} days...\n`);

  for (const day of DAYS) {
    try {
      await backfillDay(day);
    } catch (e: any) {
      console.error(`❌ Failed on ${day}: ${e.message}`);
      console.log('Continuing to next day...');
    }
  }

  const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n✓ Complete in ${totalTime} minutes`);
}

main().catch(e => { console.error(e); process.exit(1); });
