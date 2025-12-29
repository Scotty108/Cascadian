/**
 * Verify token mapping fix for failing wallets
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const FAILING_WALLETS = [
  '0x42592084120b0d5287059919d2a96b3b7acb936f', // -19.8% gap (token mapping)
  '0x2f09642650c0c75da9c5f3645f7ba122f9f6b4dc', // -30.8% gap (unredeemed positions)
];

async function main() {
  console.log('='.repeat(80));
  console.log('VERIFY TOKEN MAPPING FIX');
  console.log('='.repeat(80));

  for (const wallet of FAILING_WALLETS) {
    console.log(`\n--- Wallet: ${wallet.substring(0, 10)}... ---`);

    // Check CLOB mapping coverage
    const q1 = `
      SELECT
        count() as total_clob,
        countIf(condition_id IS NULL OR condition_id = '') as unmapped,
        countIf(condition_id IS NOT NULL AND condition_id != '') as mapped
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
    `;

    const r1 = await client.query({ query: q1, format: 'JSONEachRow' });
    const rows1 = (await r1.json()) as { total_clob: number; unmapped: number; mapped: number }[];

    console.log('CLOB mapping status:');
    console.log(JSON.stringify(rows1[0], null, 2));

    // Calculate V19s PnL
    const q2 = `
      WITH ledger_agg AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) = lower('${wallet}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY condition_id, outcome_index
      )
      SELECT
        sum(la.cash_flow + la.final_tokens * coalesce(r.resolved_price, 0)) AS v19s_pnl,
        count() AS positions
      FROM ledger_agg la
      LEFT JOIN (
        SELECT condition_id, outcome_index, any(resolved_price) AS resolved_price
        FROM vw_pm_resolution_prices
        GROUP BY condition_id, outcome_index
      ) r ON la.condition_id = r.condition_id AND la.outcome_index = r.outcome_index
    `;

    const r2 = await client.query({ query: q2, format: 'JSONEachRow' });
    const rows2 = (await r2.json()) as { v19s_pnl: number; positions: number }[];

    console.log('V19s PnL (recalculated):');
    console.log(JSON.stringify(rows2[0], null, 2));
  }

  // Overall coverage check for last 14 days
  console.log('\n--- OVERALL COVERAGE (Last 14 Days) ---');
  const q3 = `
    WITH recent_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 14 DAY
    )
    SELECT
      count() as total_recent_tokens,
      countIf(m.token_id_dec IS NOT NULL) as mapped,
      countIf(m.token_id_dec IS NULL) as unmapped,
      round(100.0 * countIf(m.token_id_dec IS NOT NULL) / count(*), 2) as coverage_pct
    FROM recent_tokens r
    LEFT JOIN pm_token_to_condition_map_v5 m ON r.token_id = m.token_id_dec
  `;

  const r3 = await client.query({ query: q3, format: 'JSONEachRow' });
  const rows3 = (await r3.json()) as any[];
  console.log(JSON.stringify(rows3[0], null, 2));

  await client.close();
  console.log('\n✅ Verification complete!');
}

main().catch(console.error);
