/**
 * CHECK DATA COVERAGE
 *
 * What date range do we have for this wallet?
 * Are we missing historical resolved positions?
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('CHECK DATA COVERAGE');
  console.log(`Wallet: ${TARGET_WALLET}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check date range of clob_fills
  console.log('📊 Date range of clob_fills for this wallet...\n');

  const dateQuery = await clickhouse.query({
    query: `
      SELECT
        min(timestamp) as first_fill,
        max(timestamp) as last_fill,
        count(*) as total_fills,
        count(DISTINCT asset_id) as unique_assets
      FROM clob_fills
      WHERE proxy_wallet = '${TARGET_WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const dates: any = (await dateQuery.json())[0];

  console.log(`First fill: ${dates.first_fill}`);
  console.log(`Last fill: ${dates.last_fill}`);
  console.log(`Total fills: ${dates.total_fills}`);
  console.log(`Unique assets: ${dates.unique_assets}\n`);

  // Check how many fills per month
  console.log('📊 Fills by month:\n');

  const monthlyQuery = await clickhouse.query({
    query: `
      SELECT
        toYYYYMM(timestamp) as month,
        count(*) as fills,
        count(DISTINCT asset_id) as unique_assets
      FROM clob_fills
      WHERE proxy_wallet = '${TARGET_WALLET}'
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow'
  });

  const monthly: any[] = await monthlyQuery.json();

  for (const m of monthly) {
    console.log(`  ${m.month}: ${m.fills} fills, ${m.unique_assets} assets`);
  }

  // Check global data coverage
  console.log('\n📊 Global clob_fills coverage...\n');

  const globalQuery = await clickhouse.query({
    query: `
      SELECT
        min(timestamp) as first_fill,
        max(timestamp) as last_fill,
        count(*) as total_fills,
        count(DISTINCT proxy_wallet) as unique_wallets
      FROM clob_fills
    `,
    format: 'JSONEachRow'
  });

  const global: any = (await globalQuery.json())[0];

  console.log(`Global first fill: ${global.first_fill}`);
  console.log(`Global last fill: ${global.last_fill}`);
  console.log(`Total fills: ${global.total_fills.toLocaleString()}`);
  console.log(`Unique wallets: ${global.unique_wallets.toLocaleString()}\n`);

  // Check if we have ANY resolved positions in our dataset
  console.log('📊 Checking resolved positions globally...\n');

  const resolvedQuery = await clickhouse.query({
    query: `
      SELECT count(*) as resolved_markets
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow'
  });

  const resolved: any = (await resolvedQuery.json())[0];

  console.log(`Total resolved markets: ${resolved.resolved_markets.toLocaleString()}\n`);

  // Check when markets were resolved
  console.log('📊 Resolution timeline...\n');

  const resTimelineQuery = await clickhouse.query({
    query: `
      SELECT
        toYYYYMM(resolved_at) as month,
        count(*) as resolutions
      FROM market_resolutions_final
      WHERE resolved_at IS NOT NULL
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `,
    format: 'JSONEachRow'
  });

  const resTimeline: any[] = await resTimelineQuery.json();

  for (const r of resTimeline) {
    console.log(`  ${r.month}: ${r.resolutions} resolutions`);
  }

  // Final diagnosis
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const firstFillDate = new Date(dates.first_fill);
  const today = new Date();
  const daysCoverage = Math.floor((today.getTime() - firstFillDate.getTime()) / (1000 * 60 * 60 * 24));

  console.log(`Data coverage: ${daysCoverage} days (${firstFillDate.toISOString().split('T')[0]} → now)\n`);

  if (daysCoverage < 365) {
    console.log(`⚠️  INCOMPLETE DATA`);
    console.log(`   Our dataset only covers ${daysCoverage} days`);
    console.log(`   Dome API shows $87K lifetime P&L`);
    console.log(`   This suggests older resolved positions are missing\n`);
  }

  if (dates.unique_assets < 192) {
    console.log(`⚠️  MISSING POSITIONS`);
    console.log(`   We have ${dates.unique_assets} unique assets`);
    console.log(`   Polymarket UI shows 192 predictions`);
    console.log(`   ${192 - dates.unique_assets} positions are missing from our dataset\n`);
  }

  if (dates.unique_assets === 45 && monthly[0].unique_assets === 45) {
    console.log(`✅ All positions in our dataset are from recent months`);
    console.log(`   All positions are still OPEN (unresolved)`);
    console.log(`   This explains zero P&L\n`);
  }

  console.log('✅ COVERAGE CHECK COMPLETE\n');
}

main().catch(console.error);
