#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  const result = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          condition_id_norm_v3,
          outcome_index_v3
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY condition_id_norm_v3, outcome_index_v3
      )
      SELECT
        count() AS total_positions,
        count(DISTINCT condition_id_norm_v3) AS unique_markets
      FROM positions
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  const r = data[0];

  console.log('Market vs Position Count:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Positions (market+outcome): ${parseInt(r.total_positions)}`);
  console.log(`  Unique Markets (condition_id):    ${parseInt(r.unique_markets)}`);
  console.log();

  const uniqueMarkets = parseInt(r.unique_markets);
  const polymarketUI = 94;

  if (Math.abs(uniqueMarkets - polymarketUI) < 5) {
    console.log(`✅ MATCH: ${uniqueMarkets} unique markets ≈ ${polymarketUI} Polymarket predictions`);
    console.log(`   → Polymarket counts unique markets, we count (market, outcome) pairs`);
  } else {
    console.log(`⚠️  Mismatch: ${uniqueMarkets} unique markets vs ${polymarketUI} Polymarket UI`);
    console.log(`   → Difference: ${uniqueMarkets - polymarketUI} markets`);
  }
}

main().catch(console.error);
