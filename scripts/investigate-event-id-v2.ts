/**
 * Investigate event_id structure v2
 *
 * Finding: event_id appears to be: {base_trade_id}_{order_id}-{m|t}
 * The -m/-t suffix indicates maker/taker role
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('=== INVESTIGATING event_id STRUCTURE (v2) ===\n');

  // 1. Verify the -m/-t suffix pattern
  console.log('1. Checking event_id suffix pattern...');
  const suffixCheck = await clickhouse.query({
    query: `
      SELECT
        right(event_id, 2) as suffix,
        role,
        count() as cnt
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 7 DAY
      GROUP BY suffix, role
      ORDER BY cnt DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('Suffix vs Role:');
  const suffixRows = await suffixCheck.json() as any[];
  suffixRows.forEach((r: any) => console.log(`  suffix='${r.suffix}' role='${r.role}': ${Number(r.cnt).toLocaleString()}`));

  // 2. Extract base trade ID (everything before the last underscore)
  console.log('\n2. Grouping by base trade ID (strip -m/-t suffix)...');
  const baseIdCheck = await clickhouse.query({
    query: `
      SELECT
        rows_per_base_id,
        count() as num_base_ids
      FROM (
        SELECT
          -- Extract base trade ID by removing last 2 chars (-m or -t)
          substring(event_id, 1, length(event_id) - 2) as base_id,
          count() as rows_per_base_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 7 DAY
        GROUP BY base_id
      )
      GROUP BY rows_per_base_id
      ORDER BY rows_per_base_id
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('Rows per base trade ID:');
  const baseIdRows = await baseIdCheck.json() as any[];
  baseIdRows.forEach((r: any) => console.log(`  ${r.rows_per_base_id} rows: ${Number(r.num_base_ids).toLocaleString()} base IDs`));

  // 3. For base IDs with 2 rows, verify they're maker+taker pairs
  console.log('\n3. For base IDs with 2 rows - are they maker+taker pairs?...');
  const pairCheck = await clickhouse.query({
    query: `
      SELECT
        has(roles, 'maker') as has_maker,
        has(roles, 'taker') as has_taker,
        count() as cnt
      FROM (
        SELECT
          substring(event_id, 1, length(event_id) - 2) as base_id,
          groupArray(role) as roles
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 7 DAY
        GROUP BY base_id
        HAVING count() = 2
      )
      GROUP BY has_maker, has_taker
    `,
    format: 'JSONEachRow'
  });
  console.log('Maker+Taker pair analysis:');
  const pairRows = await pairCheck.json() as any[];
  pairRows.forEach((r: any) => console.log(`  has_maker=${r.has_maker}, has_taker=${r.has_taker}: ${Number(r.cnt).toLocaleString()}`));

  // 4. Sample a base ID with 2 rows to see the structure
  console.log('\n4. Sample base ID with maker+taker pair...');
  const samplePair = await clickhouse.query({
    query: `
      WITH sample_base AS (
        SELECT substring(event_id, 1, length(event_id) - 2) as base_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 1 DAY
        GROUP BY base_id
        HAVING count() = 2
        LIMIT 1
      )
      SELECT
        event_id,
        substring(event_id, 1, length(event_id) - 2) as base_id,
        trader_wallet,
        role,
        side,
        usdc_amount / 1e6 as usdc,
        token_id
      FROM pm_trader_events_v2
      WHERE substring(event_id, 1, length(event_id) - 2) IN (SELECT base_id FROM sample_base)
        AND is_deleted = 0
      ORDER BY role
    `,
    format: 'JSONEachRow'
  });
  console.log('Sample maker+taker pair:');
  const sampleRows = await samplePair.json() as any[];
  sampleRows.forEach((r: any) => {
    console.log(`\n  event_id: ${r.event_id}`);
    console.log(`  base_id:  ${r.base_id}`);
    console.log(`  wallet:   ${r.trader_wallet}`);
    console.log(`  role:     ${r.role}`);
    console.log(`  side:     ${r.side}`);
    console.log(`  usdc:     $${r.usdc}`);
  });

  // 5. Check for self-trades: same wallet on both sides of same base_id
  console.log('\n\n5. Checking for self-trades (same wallet, same base_id, different roles)...');
  const selfTrades = await clickhouse.query({
    query: `
      SELECT count() as self_trade_count
      FROM (
        SELECT
          substring(event_id, 1, length(event_id) - 2) as base_id,
          trader_wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 30 DAY
        GROUP BY base_id, trader_wallet
        HAVING countDistinct(role) > 1
      )
    `,
    format: 'JSONEachRow'
  });
  const selfTradeRows = await selfTrades.json() as any[];
  console.log('Self-trades found:', selfTradeRows[0]);

  // 6. Summary of correct dedupe approach
  console.log('\n\n=== CORRECT DEDUPE APPROACH ===');
  console.log(`
FINDINGS:
- event_id format: {hash1}_{hash2}-{m|t}
- The -m/-t suffix indicates maker vs taker role
- event_id is ALREADY unique per (trade, wallet, role)

CORRECT DEDUPE FOR WALLET-LEVEL STATS:
- GROUP BY event_id removes ingestion duplicates (same row inserted twice)
- This is correct and preserves all legitimate fills

DO NOT STRIP THE -m/-t SUFFIX:
- If you strip it, you'd be grouping maker+taker together (different wallets!)
- That would be wrong for wallet-level stats

WHEN TO USE BASE_ID (suffix stripped):
- Market-level volume (count each trade once, not twice)
- Matching maker to taker for spread analysis
- NOT for wallet-level PnL/t-stat calculations
  `);
}

main().catch(console.error);
