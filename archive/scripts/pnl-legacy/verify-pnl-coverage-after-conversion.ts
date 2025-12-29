#!/usr/bin/env npx tsx
/**
 * Verify P&L Coverage After Text→Payout Conversion
 * Check actual impact on wallet P&L calculations
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
  console.log('\n📊 VERIFYING P&L COVERAGE AFTER CONVERSION\n');

  // Check overall position coverage
  console.log('1️⃣ Position-level coverage:\n');

  const positionCoverage = await ch.query({
    query: `
      WITH all_positions AS (
        SELECT
          t.wallet_address,
          t.cid_hex as condition_id,
          t.outcome_index,
          COUNT(*) as trade_count
        FROM cascadian_clean.fact_trades_clean t
        GROUP BY t.wallet_address, t.cid_hex, t.outcome_index
      ),
      resolved_positions AS (
        SELECT
          p.wallet_address,
          p.condition_id,
          p.outcome_index
        FROM all_positions p
        INNER JOIN (
          SELECT condition_id_norm, payout_denominator
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT condition_id, payout_denominator
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        ) r ON lower(replaceAll(p.condition_id, '0x', '')) = lower(r.condition_id_norm)
        WHERE r.payout_denominator > 0
      )
      SELECT
        COUNT(DISTINCT a.wallet_address || a.condition_id || toString(a.outcome_index)) as total_positions,
        COUNT(DISTINCT r.wallet_address || r.condition_id || toString(r.outcome_index)) as resolved_positions,
        ROUND(resolved_positions / total_positions * 100, 2) as coverage_pct
      FROM all_positions a
      LEFT JOIN resolved_positions r
        ON a.wallet_address = r.wallet_address
        AND a.condition_id = r.condition_id
        AND a.outcome_index = r.outcome_index
    `,
    format: 'JSONEachRow'
  });

  const posCov = await positionCoverage.json<any>();
  console.log(`  Total positions: ${parseInt(posCov[0].total_positions).toLocaleString()}`);
  console.log(`  Resolved positions: ${parseInt(posCov[0].resolved_positions).toLocaleString()}`);
  console.log(`  Coverage: ${posCov[0].coverage_pct}%\n`);

  // Check wallet 0x4ce7 specifically
  console.log('2️⃣ Wallet 0x4ce7 coverage:\n');

  const wallet0x4ce7 = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT
          lower(replaceAll(t.cid_hex, '0x', '')) as condition_id
        FROM cascadian_clean.fact_trades_clean t
        WHERE lower(t.wallet_address) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
      )
      SELECT
        COUNT(*) as total_markets,
        COUNT(CASE WHEN r.payout_denominator > 0 THEN 1 END) as resolved_markets
      FROM wallet_markets w
      LEFT JOIN (
        SELECT condition_id_norm, payout_denominator
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator
        FROM default.resolutions_external_ingest
      ) r ON w.condition_id = lower(r.condition_id_norm)
    `,
    format: 'JSONEachRow'
  });

  const wallet = await wallet0x4ce7.json<any>();
  console.log(`  Total markets: ${wallet[0].total_markets}`);
  console.log(`  Resolved markets: ${wallet[0].resolved_markets}`);
  console.log(`  Coverage: ${Math.round(parseInt(wallet[0].resolved_markets)/parseInt(wallet[0].total_markets)*100)}%\n`);

  // Check top 10 wallets
  console.log('3️⃣ Top 10 wallets by trade volume:\n');

  const topWallets = await ch.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          t.wallet_address,
          COUNT(DISTINCT t.cid_hex) as total_markets,
          COUNT(*) as total_trades
        FROM cascadian_clean.fact_trades_clean t
        GROUP BY t.wallet_address
        ORDER BY total_trades DESC
        LIMIT 10
      ),
      wallet_resolved AS (
        SELECT
          t.wallet_address,
          COUNT(DISTINCT t.cid_hex) as resolved_markets
        FROM cascadian_clean.fact_trades_clean t
        INNER JOIN (
          SELECT condition_id_norm, payout_denominator
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT condition_id, payout_denominator
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        ) r ON lower(replaceAll(t.cid_hex, '0x', '')) = lower(r.condition_id_norm)
        WHERE r.payout_denominator > 0
        GROUP BY t.wallet_address
      )
      SELECT
        w.wallet_address,
        w.total_markets,
        w.total_trades,
        COALESCE(wr.resolved_markets, 0) as resolved_markets,
        ROUND(resolved_markets / w.total_markets * 100, 1) as coverage_pct
      FROM wallet_stats w
      LEFT JOIN wallet_resolved wr ON w.wallet_address = wr.wallet_address
      ORDER BY w.total_trades DESC
    `,
    format: 'JSONEachRow'
  });

  const topWalletsData = await topWallets.json<any>();

  console.log('  Wallet                                      | Markets | Trades    | Resolved | Coverage');
  console.log('  -------------------------------------------|---------|-----------|----------|----------');
  topWalletsData.forEach((w: any) => {
    console.log(`  ${w.wallet_address.substring(0, 42).padEnd(42)} | ${w.total_markets.toString().padStart(7)} | ${parseInt(w.total_trades).toLocaleString().padStart(9)} | ${w.resolved_markets.toString().padStart(8)} | ${w.coverage_pct}%`);
  });

  console.log('\n' + '═'.repeat(80));
  console.log('📊 NEXT STEPS\n');

  const coveragePct = parseFloat(posCov[0].coverage_pct);

  if (coveragePct >= 75) {
    console.log('✅ Coverage is good (>75%)!');
    console.log('   - P&L calculations ready for production');
    console.log('   - Can launch leaderboards');
  } else if (coveragePct >= 60) {
    console.log('⚠️  Coverage is moderate (60-75%)');
    console.log('   - Still missing ~' + Math.round(100 - coveragePct) + '% of positions');
    console.log('   - Need to investigate remaining gaps:');
    console.log('     1. Fix 27K outcome mismatches (YES/NO vs Up/Down)');
    console.log('     2. Check if remaining markets are genuinely unresolved');
    console.log('     3. Try alternative resolution sources');
  } else {
    console.log('❌ Coverage is low (<60%)');
    console.log('   - Major data gaps remain');
    console.log('   - Review backfill strategy');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
