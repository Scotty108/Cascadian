#!/usr/bin/env npx tsx
/**
 * FIX: Cast FixedString(64) to String in vw_resolutions_truth
 *
 * ROOT CAUSE FOUND:
 * - market_resolutions_final.condition_id_norm is FixedString(64)
 * - vw_trades_canonical.condition_id_norm is String
 * - ClickHouse doesn't auto-trim FixedString padding in joins
 *
 * SOLUTION: Cast condition_id_norm to String in the UNION
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const AUDIT_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('FIXING vw_resolutions_truth - CASTING FixedString TO String');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Rebuilding vw_resolutions_truth with toString() cast...\n');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_truth AS
      SELECT
        condition_id_32b,
        winning_index,
        payout_numerators,
        payout_denominator,
        resolved_at,
        source
      FROM (
        -- Source 1: Blockchain data (resolutions_by_cid)
        SELECT
          lower(replaceAll(cid_hex, '0x', '')) as condition_id_32b,
          winning_index,
          payout_numerators,
          payout_denominator,
          resolved_at,
          'blockchain' as source
        FROM cascadian_clean.resolutions_by_cid
        WHERE payout_denominator > 0
          AND length(payout_numerators) > 0
          AND arraySum(payout_numerators) = payout_denominator
          AND winning_index >= 0

        UNION ALL

        -- Source 2: market_resolutions_final (CAST FixedString to String!)
        SELECT
          toString(condition_id_norm) as condition_id_32b,
          winning_index,
          payout_numerators,
          payout_denominator,
          resolved_at,
          'market_resolutions_final' as source
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
          AND length(payout_numerators) > 0
          AND arraySum(payout_numerators) = payout_denominator
          AND winning_index >= 0
          AND resolved_at IS NOT NULL
      )
    `
  });

  console.log('✓ Truth view rebuilt with toString() cast\n');

  // Verify wallet coverage NOW
  console.log('═'.repeat(80));
  console.log('CHECKING WALLET 0x4ce7 COVERAGE (AFTER toString() FIX)');
  console.log('═'.repeat(80));
  console.log('');

  const walletCoverage = await ch.query({
    query: `
      WITH wallet_positions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_32b
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
          AND condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        count(*) as total_positions,
        countIf(r.condition_id_32b IS NOT NULL) as found_in_truth,
        countIf(r.payout_denominator > 0) as with_valid_payouts
      FROM wallet_positions w
      LEFT JOIN cascadian_clean.vw_resolutions_truth r
        ON w.condition_id_32b = r.condition_id_32b
    `,
    format: 'JSONEachRow',
  });
  const walletCoverageData = await walletCoverage.json<any[]>();

  console.log(`Wallet positions: ${walletCoverageData[0].total_positions}`);
  console.log(`Found in truth view: ${walletCoverageData[0].found_in_truth}/${walletCoverageData[0].total_positions}`);
  console.log(`With valid payouts: ${walletCoverageData[0].with_valid_payouts}/${walletCoverageData[0].total_positions}`);
  console.log('');

  const payoutCoverage = parseInt(walletCoverageData[0].with_valid_payouts);
  const totalPositions = parseInt(walletCoverageData[0].total_positions);
  const coveragePct = (payoutCoverage / totalPositions * 100).toFixed(1);

  if (payoutCoverage > 0) {
    console.log(`✅ FIXED! Coverage improved to ${payoutCoverage}/${totalPositions} positions (${coveragePct}%)`);
  } else {
    console.log(`⚠️  Still no coverage - need to investigate further`);
  }
  console.log('');

  // Re-query Settled P&L
  console.log('═'.repeat(80));
  console.log('SETTLED P&L (AFTER toString() FIX)');
  console.log('═'.repeat(80));
  console.log('');

  const settledPnL = await ch.query({
    query: `
      SELECT
        trading_pnl,
        redemption_pnl,
        total_pnl,
        positions_settled
      FROM cascadian_clean.vw_wallet_pnl_settled
      WHERE wallet = lower('${AUDIT_WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const settledData = await settledPnL.json<any[]>();

  if (settledData.length > 0) {
    console.log(`Trading P&L: $${parseFloat(settledData[0].trading_pnl).toFixed(2)}`);
    console.log(`Redemption P&L: $${parseFloat(settledData[0].redemption_pnl).toFixed(2)}`);
    console.log(`Total P&L: $${parseFloat(settledData[0].total_pnl).toFixed(2)}`);
    console.log(`Positions Settled: ${settledData[0].positions_settled}`);
    console.log('');

    const redemptionPnL = parseFloat(settledData[0].redemption_pnl);
    const polymarketTarget = 332563;

    if (redemptionPnL > 1000) {
      console.log(`🎯 SUCCESS! Redemption P&L: $${redemptionPnL.toLocaleString()}`);
      console.log(`   Polymarket target: $${polymarketTarget.toLocaleString()}`);
      console.log(`   Gap remaining: $${(polymarketTarget - redemptionPnL).toLocaleString()}`);
      console.log(`   Coverage: ${(redemptionPnL / polymarketTarget * 100).toFixed(1)}%`);
    } else if (redemptionPnL > 0) {
      console.log(`✅ Redemption P&L found: $${redemptionPnL.toFixed(2)}`);
      console.log(`   Still below Polymarket ($${polymarketTarget.toLocaleString()})`);
      console.log(`   May need additional resolution sources`);
    } else {
      console.log(`⚠️  Redemption P&L still $0`);
    }
  } else {
    console.log('No data for wallet');
  }
  console.log('');

  // Show which positions now have payouts
  if (payoutCoverage > 0) {
    console.log('═'.repeat(80));
    console.log(`POSITIONS WITH PAYOUTS (${payoutCoverage} found)`);
    console.log('═'.repeat(80));
    console.log('');

    const positionsWithPayouts = await ch.query({
      query: `
        WITH wallet_positions AS (
          SELECT
            lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_32b,
            toInt32(outcome_index) AS outcome,
            sumIf(toFloat64(shares), trade_direction = 'BUY') - sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_net,
            sumIf(if(trade_direction = 'BUY', -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares)), 1) AS cash_net
          FROM default.vw_trades_canonical
          WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
            AND condition_id_norm != ''
            AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          GROUP BY condition_id_32b, outcome
          HAVING abs(shares_net) >= 0.01
        )
        SELECT
          p.condition_id_32b,
          p.outcome,
          p.shares_net,
          p.cash_net,
          r.payout_numerators,
          r.payout_denominator,
          r.winning_index,
          p.shares_net * (arrayElement(r.payout_numerators, p.outcome + 1) / r.payout_denominator) + p.cash_net as pnl
        FROM wallet_positions p
        INNER JOIN cascadian_clean.vw_resolutions_truth r
          ON p.condition_id_32b = r.condition_id_32b
        WHERE r.payout_denominator > 0
        ORDER BY abs(pnl) DESC
      `,
      format: 'JSONEachRow',
    });
    const positionsData = await positionsWithPayouts.json<any[]>();

    positionsData.slice(0, 10).forEach((row, i) => {
      const pnl = parseFloat(row.pnl);
      console.log(`${i + 1}. Condition: ${row.condition_id_32b.substring(0, 20)}...`);
      console.log(`   Outcome: ${row.outcome}, Shares: ${parseFloat(row.shares_net).toFixed(2)}`);
      console.log(`   Payout: [${row.payout_numerators}]/${row.payout_denominator}, Winner: ${row.winning_index}`);
      console.log(`   P&L: $${pnl.toFixed(2)}`);
      console.log('');
    });

    if (positionsData.length > 10) {
      console.log(`... and ${positionsData.length - 10} more positions\n`);
    }
  }

  console.log('═'.repeat(80));
  console.log('FINAL VERDICT');
  console.log('═'.repeat(80));
  console.log('');

  if (payoutCoverage >= totalPositions * 0.8) {
    console.log(`🎉 EXCELLENT COVERAGE: ${payoutCoverage}/${totalPositions} positions (${coveragePct}%)`);
    console.log('');
    console.log('The $333K gap should be largely closed now.');
    console.log('Any remaining gap is likely from:');
    console.log('1. Positions not yet resolved');
    console.log('2. Resolution data in other tables (gamma_resolved, etc.)');
  } else if (payoutCoverage > 0) {
    console.log(`✅ PARTIAL SUCCESS: ${payoutCoverage}/${totalPositions} positions (${coveragePct}%)`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Check gamma_resolved and other resolution tables');
    console.log('2. Identify specific missing condition_ids');
    console.log('3. Fetch from external APIs if needed');
  } else {
    console.log(`❌ NO COVERAGE YET`);
    console.log('');
    console.log('Need to investigate why IDs still don\'t match after casting.');
  }
  console.log('');

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
