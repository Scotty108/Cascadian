#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TEST_WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';

(async () => {
  console.log('\n🕐 Checking wallet trade timing distribution...\n');

  // When did this wallet trade?
  const timing = await ch.query({
    query: `
      SELECT
        toStartOfMonth(block_time) as month,
        COUNT(DISTINCT cid) as markets_traded,
        COUNT(*) as total_trades,
        MIN(block_time) as earliest_trade,
        MAX(block_time) as latest_trade
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `,
    format: 'JSONEachRow',
  });

  const months = await timing.json();
  console.log('Trade activity by month:\n');
  for (const m of months) {
    console.log(`  ${m.month}: ${parseInt(m.markets_traded).toLocaleString()} markets, ${parseInt(m.total_trades).toLocaleString()} trades`);
  }

  // What's the date range of resolved markets?
  const resolvedTiming = await ch.query({
    query: `
      SELECT
        MIN(resolved_at) as earliest_resolution,
        MAX(resolved_at) as latest_resolution,
        COUNT(DISTINCT condition_id_norm) as total_resolved
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
        AND resolved_at IS NOT NULL
    `,
    format: 'JSONEachRow',
  });

  const resTimingData = await resolvedTiming.json();
  console.log('\n📅 Resolution data timing:\n');
  console.log(`  Earliest: ${resTimingData[0].earliest_resolution}`);
  console.log(`  Latest: ${resTimingData[0].latest_resolution}`);
  console.log(`  Total resolved: ${parseInt(resTimingData[0].total_resolved).toLocaleString()}`);

  // Check if wallet is trading on markets that EXIST in our system but aren't resolved yet
  const inSystem = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      )
      SELECT
        COUNT(DISTINCT wm.condition_id) as total_wallet_markets,
        COUNT(DISTINCT ams.condition_id) as in_api_markets_staging,
        COUNT(DISTINCT mrf.condition_id_norm) as has_any_resolution_entry
      FROM wallet_markets wm
      LEFT JOIN default.api_markets_staging ams 
        ON wm.condition_id = lower(replaceAll(ams.condition_id, '0x', ''))
      LEFT JOIN default.market_resolutions_final mrf
        ON wm.condition_id = mrf.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const systemData = await inSystem.json();
  console.log('\n🔍 Market system presence:\n');
  console.log(`  Wallet's markets: ${parseInt(systemData[0].total_wallet_markets).toLocaleString()}`);
  console.log(`  In api_markets_staging: ${parseInt(systemData[0].in_api_markets_staging).toLocaleString()}`);
  console.log(`  Has ANY resolution entry: ${parseInt(systemData[0].has_any_resolution_entry).toLocaleString()}`);

  await ch.close();
})();
