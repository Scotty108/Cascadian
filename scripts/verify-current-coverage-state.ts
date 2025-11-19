#!/usr/bin/env npx tsx
/**
 * Verify Current Coverage State
 * Check actual coverage after all fixes
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n📊 CURRENT COVERAGE STATE\n');
  console.log('═'.repeat(80));

  // 1. Market-level coverage
  console.log('\n1️⃣ Market-level coverage:\n');

  const marketCoverage = await ch.query({
    query: `
      WITH
        traded_markets AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
        ),
        all_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      SELECT
        COUNT(DISTINCT t.cid_norm) as total_markets,
        COUNT(DISTINCT CASE WHEN r.cid_norm IS NOT NULL THEN t.cid_norm END) as resolved_markets,
        COUNT(DISTINCT CASE WHEN r.cid_norm IS NULL THEN t.cid_norm END) as unresolved_markets,
        ROUND(resolved_markets / total_markets * 100, 2) as coverage_pct
      FROM traded_markets t
      LEFT JOIN all_resolutions r ON t.cid_norm = r.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const marketData = await marketCoverage.json<any>();
  console.log(`  Total traded markets: ${parseInt(marketData[0].total_markets).toLocaleString()}`);
  console.log(`  Resolved: ${parseInt(marketData[0].resolved_markets).toLocaleString()}`);
  console.log(`  Unresolved: ${parseInt(marketData[0].unresolved_markets).toLocaleString()}`);
  console.log(`  Coverage: ${marketData[0].coverage_pct}%\n`);

  // 2. Position-level coverage
  console.log('2️⃣ Position-level coverage:\n');

  const positionCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved_positions,
        COUNT(CASE WHEN payout_denominator = 0 OR payout_denominator IS NULL THEN 1 END) as unresolved_positions,
        ROUND(resolved_positions / total_positions * 100, 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });

  const posData = await positionCoverage.json<any>();
  console.log(`  Total positions: ${parseInt(posData[0].total_positions).toLocaleString()}`);
  console.log(`  Resolved: ${parseInt(posData[0].resolved_positions).toLocaleString()}`);
  console.log(`  Unresolved: ${parseInt(posData[0].unresolved_positions).toLocaleString()}`);
  console.log(`  Coverage: ${posData[0].coverage_pct}%\n`);

  // 3. Resolution source breakdown
  console.log('3️⃣ Resolution source breakdown:\n');

  const sourceBreakdown = await ch.query({
    query: `
      SELECT
        'market_resolutions_final' as source,
        COUNT(DISTINCT lower(replaceAll(condition_id_norm, '0x', ''))) as unique_markets
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      UNION ALL
      SELECT
        'resolutions_external_ingest' as source,
        COUNT(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as unique_markets
      FROM default.resolutions_external_ingest
      WHERE payout_denominator > 0
    `,
    format: 'JSONEachRow'
  });

  const sourceData = await sourceBreakdown.json<any>();
  sourceData.forEach((row: any) => {
    console.log(`  ${row.source.padEnd(30)} ${parseInt(row.unique_markets).toLocaleString()} markets`);
  });

  // 4. Sample unresolved markets
  console.log('\n4️⃣ Sample of unresolved markets (first 10):\n');

  const unresolvedSample = await ch.query({
    query: `
      WITH
        traded_markets AS (
          SELECT
            lower(replaceAll(t.cid, '0x', '')) as cid_norm,
            COUNT(*) as trade_count,
            COUNT(DISTINCT t.wallet_address) as unique_wallets
          FROM default.fact_trades_clean t
          GROUP BY cid_norm
        ),
        all_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      SELECT
        t.cid_norm,
        t.trade_count,
        t.unique_wallets
      FROM traded_markets t
      LEFT JOIN all_resolutions r ON t.cid_norm = r.cid_norm
      WHERE r.cid_norm IS NULL
      ORDER BY t.trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const unresolvedData = await unresolvedSample.json<any>();

  console.log('  Top unresolved markets by trade volume:\n');
  console.log('  Condition ID                              | Trades    | Wallets');
  console.log('  ------------------------------------------|-----------|--------');
  unresolvedData.forEach((row: any) => {
    console.log(`  ${row.cid_norm.substring(0, 42).padEnd(42)}| ${parseInt(row.trade_count).toLocaleString().padStart(9)} | ${parseInt(row.unique_wallets).toLocaleString().padStart(7)}`);
  });

  // 5. Check wallet 0x4ce7 specifically
  console.log('\n5️⃣ Wallet 0x4ce7 status:\n');

  const wallet0x4ce7 = await ch.query({
    query: `
      SELECT
        wallet,
        total_markets,
        resolved_markets,
        unresolved_markets,
        ROUND(resolved_markets / total_markets * 100, 1) as coverage_pct,
        ROUND(total_pnl_usd, 2) as pnl
      FROM default.vw_wallet_pnl_summary
      WHERE lower(wallet) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
    `,
    format: 'JSONEachRow'
  });

  const walletData = await wallet0x4ce7.json<any>();

  if (walletData.length > 0) {
    const w = walletData[0];
    console.log(`  Wallet: ${w.wallet}`);
    console.log(`  Total markets: ${w.total_markets}`);
    console.log(`  Resolved: ${w.resolved_markets}`);
    console.log(`  Unresolved: ${w.unresolved_markets}`);
    console.log(`  Coverage: ${w.coverage_pct}%`);
    console.log(`  P&L: $${parseFloat(w.pnl || 0).toLocaleString()}\n`);
  } else {
    console.log('  ⚠️  Wallet not found\n');
  }

  console.log('═'.repeat(80));
  console.log('📊 SUMMARY\n');

  const marketPct = parseFloat(marketData[0].coverage_pct);
  const positionPct = parseFloat(posData[0].coverage_pct);

  console.log(`Market coverage: ${marketPct}%`);
  console.log(`Position coverage: ${positionPct}%\n`);

  if (positionPct >= 60) {
    console.log('✅ Coverage is good (≥60%)');
    console.log('   Ready to test P&L calculations');
    console.log('   Compare to Polymarket UI\n');
  } else if (positionPct >= 40) {
    console.log('⚠️  Coverage is moderate (40-60%)');
    console.log('   Can test P&L but some gaps remain\n');
  } else {
    console.log('❌ Coverage is low (<40%)');
    console.log('   Need more resolution data\n');
  }

  console.log('Next steps:');
  if (positionPct < 60) {
    console.log('  1. Investigate why unresolved markets lack resolutions');
    console.log('  2. Check if they\'re genuinely unresolved (still open)');
    console.log('  3. Or if resolution data is missing from our sources\n');
  } else {
    console.log('  1. ✅ Test P&L calculations (ready!)');
    console.log('  2. Compare top wallets to Polymarket UI');
    console.log('  3. Historical backfill for complete wallet history\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
