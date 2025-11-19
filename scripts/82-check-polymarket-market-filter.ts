#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Checking Polymarket market filtering...\n`);

  // Check if we have gamma_markets table with Polymarket markets
  const marketsCheck = await clickhouse.query({
    query: `
      SELECT count() AS total_markets
      FROM gamma_markets
    `,
    format: 'JSONEachRow'
  });

  const markets = await marketsCheck.json<Array<any>>();
  console.log(`Total markets in gamma_markets: ${parseInt(markets[0].total_markets).toLocaleString()}\n`);

  // Get wallet positions WITH market join
  const withMarketJoin = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3,
          count() AS fills,
          sumIf(toFloat64(shares), trade_direction = 'BUY') -
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS net_shares
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY cid, outcome_index_v3
      )
      SELECT
        count() AS total_positions,
        countIf(m.condition_id IS NOT NULL) AS positions_with_market,
        countIf(m.condition_id IS NULL) AS positions_without_market
      FROM positions p
      LEFT JOIN gamma_markets m
        ON lower(replaceAll(p.cid, '0x', '')) = lower(replaceAll(m.condition_id, '0x', ''))
    `,
    format: 'JSONEachRow'
  });

  const result = await withMarketJoin.json<Array<any>>();
  const r = result[0];

  console.log('Position Breakdown:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Positions:            ${parseInt(r.total_positions)}`);
  console.log(`  With Polymarket Market:     ${parseInt(r.positions_with_market)}`);
  console.log(`  Without Market (orphans):   ${parseInt(r.positions_without_market)}`);
  console.log();

  const withMarket = parseInt(r.positions_with_market);
  const polymarketUI = 94;

  if (Math.abs(withMarket - polymarketUI) < 5) {
    console.log(`✅ MATCH: ${withMarket} positions with market ≈ ${polymarketUI} Polymarket predictions`);
    console.log(`   → Filter by gamma_markets join to match Polymarket UI`);
  } else {
    console.log(`⚠️  Still mismatch: ${withMarket} with market vs ${polymarketUI} Polymarket UI`);
    console.log(`   → May need additional filtering criteria`);
  }

  console.log();

  // Sample some orphan positions
  console.log('Sample Orphan Positions (no Polymarket market):');
  console.log('═══════════════════════════════════════════════════════════════');

  const orphans = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3,
          sumIf(toFloat64(shares), trade_direction = 'BUY') -
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS net_shares
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY cid, outcome_index_v3
      )
      SELECT
        p.cid,
        p.outcome_index_v3,
        p.net_shares
      FROM positions p
      LEFT JOIN gamma_markets m
        ON lower(replaceAll(p.cid, '0x', '')) = lower(replaceAll(m.condition_id, '0x', ''))
      WHERE m.condition_id IS NULL
      ORDER BY abs(p.net_shares) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const orphanList = await orphans.json<Array<any>>();

  orphanList.forEach((o, i) => {
    console.log(`${i + 1}. CID: ${o.cid.substring(0, 16)}... | Outcome: ${o.outcome_index_v3} | Shares: ${parseFloat(o.net_shares).toFixed(2)}`);
  });

  console.log();
  console.log('💡 Recommendation:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  To match Polymarket UI counts, filter positions WHERE:');
  console.log('    - condition_id exists in gamma_markets table');
  console.log('    - This excludes non-Polymarket CTF markets');
}

main().catch(console.error);
