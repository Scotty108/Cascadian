#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const UI_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

  console.log('=== Checking Metadata Coverage for Wallet Map Markets ===\n');
  
  const cidsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT cid_hex
      FROM cascadian_clean.system_wallet_map
      WHERE user_wallet = '${UI_WALLET}'
        AND system_wallet = '${SYSTEM_WALLET}'
      LIMIT 77
    `,
    format: 'JSONEachRow'
  });
  const cids = await cidsResult.json<Array<{cid_hex: string}>>();
  const cidsNorm = cids.map(c => c.cid_hex.toLowerCase().replace('0x', ''));
  
  console.log(`Total unique CIDs from wallet map: ${cids.length}\n`);

  // Check gamma_markets
  const gammaResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id) as found
      FROM default.gamma_markets
      WHERE condition_id IN (${cids.map(c => `'${c.cid_hex}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const gamma = await gammaResult.json<Array<any>>();
  console.log(`gamma_markets:             ${gamma[0].found}/77`);

  // Check api_markets_staging
  const apiResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id) as found
      FROM default.api_markets_staging
      WHERE condition_id IN (${cids.map(c => `'${c.cid_hex}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const api = await apiResult.json<Array<any>>();
  console.log(`api_markets_staging:       ${api[0].found}/77`);

  // Check dim_markets (normalized)
  const dimResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as found
      FROM default.dim_markets
      WHERE condition_id_norm IN (${cidsNorm.map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const dim = await dimResult.json<Array<any>>();
  console.log(`dim_markets:               ${dim[0].found}/77`);

  // Check market_resolutions_final
  const resResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as found
      FROM default.market_resolutions_final
      WHERE condition_id_norm IN (${cidsNorm.map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const res = await resResult.json<Array<any>>();
  console.log(`market_resolutions_final:  ${res[0].found}/77\n`);

  console.log('=== CRITICAL FINDING ===\n');
  if (gamma[0].found === 0 && api[0].found === 0 && dim[0].found === 0) {
    console.log('❌ ZERO markets from system_wallet_map exist in ANY metadata table!');
    console.log('   This suggests the wallet mapping is pointing to invalid/test markets.\n');
    
    // Check if these markets exist in trades_raw at all
    const tradesResult = await clickhouse.query({
      query: `
        SELECT count(DISTINCT condition_id) as found
        FROM default.trades_raw
        WHERE condition_id IN (${cids.map(c => `'${c.cid_hex}'`).join(',')})
      `,
      format: 'JSONEachRow'
    });
    const trades = await tradesResult.json<Array<any>>();
    console.log(`Markets found in trades_raw: ${trades[0].found}/77`);
    
    if (trades[0].found > 0) {
      console.log('✓ Markets DO exist in trades_raw (so they are real markets)');
      console.log('✗ But they are NOT in any metadata tables (gamma/api/dim)');
      console.log('\nThis means: Metadata collection is incomplete for these older markets\n');
    }
  }

  // Check what dates these trades are from
  console.log('=== Trade Date Range Analysis ===\n');
  const dateResult = await clickhouse.query({
    query: `
      SELECT
        min(created_at) as earliest_trade,
        max(created_at) as latest_trade,
        count() as total_trades
      FROM default.trades_raw
      WHERE wallet = '${SYSTEM_WALLET}'
        AND condition_id IN (${cids.map(c => `'${c.cid_hex}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const dates = await dateResult.json<Array<any>>();
  console.log(`Earliest trade: ${dates[0].earliest_trade}`);
  console.log(`Latest trade:   ${dates[0].latest_trade}`);
  console.log(`Total trades:   ${dates[0].total_trades}\n`);
}

main().catch(console.error);
