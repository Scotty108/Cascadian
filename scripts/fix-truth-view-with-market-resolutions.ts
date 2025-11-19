#!/usr/bin/env npx tsx
/**
 * FIX: Wire market_resolutions_final into vw_resolutions_truth
 *
 * CRITICAL CORRECTION:
 * - vw_resolutions_truth currently only uses resolutions_by_cid (176 rows)
 * - default.market_resolutions_final has 218,228 valid payout vectors
 * - 56,575 of our 227,838 mapped condition_ids have payouts (24.83%)
 * - Wallet 0x4ce7 should find its payouts once we union this table
 *
 * This should close the $333K gap immediately.
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
  console.log('FIXING vw_resolutions_truth - ADDING market_resolutions_final');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Verify market_resolutions_final has the data
  console.log('Step 1: Verifying market_resolutions_final coverage...\n');

  const stats = await ch.query({
    query: `
      SELECT
        count(*) as total_rows,
        countIf(payout_denominator > 0) as with_denominator,
        countIf(length(payout_numerators) > 0) as with_numerators,
        countIf(
          payout_denominator > 0
          AND length(payout_numerators) > 0
          AND arraySum(payout_numerators) = payout_denominator
        ) as balanced
      FROM default.market_resolutions_final
    `,
    format: 'JSONEachRow',
  });
  const statsData = await stats.json<any[]>();

  console.log('market_resolutions_final stats:');
  console.log(`  Total rows: ${statsData[0].total_rows.toLocaleString()}`);
  console.log(`  With denominator > 0: ${statsData[0].with_denominator.toLocaleString()}`);
  console.log(`  With numerators: ${statsData[0].with_numerators.toLocaleString()}`);
  console.log(`  Balanced (sum = denom): ${statsData[0].balanced.toLocaleString()}`);
  console.log('');

  // Step 2: Check overlap with our mapped markets
  console.log('Step 2: Checking overlap with token_condition_market_map...\n');

  const overlap = await ch.query({
    query: `
      SELECT count(DISTINCT m.condition_id_32b) as markets_with_payouts
      FROM cascadian_clean.token_condition_market_map m
      INNER JOIN default.market_resolutions_final r
        ON m.condition_id_32b = r.condition_id_norm
      WHERE r.payout_denominator > 0
        AND length(r.payout_numerators) > 0
        AND arraySum(r.payout_numerators) = r.payout_denominator
    `,
    format: 'JSONEachRow',
  });
  const overlapData = await overlap.json<any[]>();

  const totalMapped = 227838; // From step1
  const withPayouts = parseInt(overlapData[0].markets_with_payouts);
  const coverage = (withPayouts / totalMapped * 100).toFixed(2);

  console.log(`Markets with payouts: ${withPayouts.toLocaleString()} / ${totalMapped.toLocaleString()} (${coverage}%)`);
  console.log('');

  // Step 3: Rebuild vw_resolutions_truth to include market_resolutions_final
  console.log('Step 3: Rebuilding vw_resolutions_truth with UNION...\n');

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

        -- Source 2: market_resolutions_final (THE MISSING 218K ROWS!)
        SELECT
          condition_id_norm as condition_id_32b,
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

  console.log('✓ vw_resolutions_truth rebuilt with UNION\n');

  // Step 4: Verify new coverage
  console.log('Step 4: Verifying new coverage in vw_resolutions_truth...\n');

  const newCoverage = await ch.query({
    query: `SELECT count(*) as total_resolutions FROM cascadian_clean.vw_resolutions_truth`,
    format: 'JSONEachRow',
  });
  const newCoverageData = await newCoverage.json<any[]>();

  console.log(`Total resolutions in truth view: ${newCoverageData[0].total_resolutions.toLocaleString()}`);
  console.log(`Before: 176 rows`);
  console.log(`After: ${newCoverageData[0].total_resolutions.toLocaleString()} rows`);
  console.log(`Increase: ${(parseInt(newCoverageData[0].total_resolutions) - 176).toLocaleString()} rows (+${((parseInt(newCoverageData[0].total_resolutions) - 176) / 176 * 100).toFixed(0)}%)\n`);

  // Step 5: Check wallet coverage NOW
  console.log('═'.repeat(80));
  console.log('CHECKING WALLET 0x4ce7 COVERAGE (AFTER FIX)');
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

  const beforeCoverage = 0;
  const afterCoverage = parseInt(walletCoverageData[0].with_valid_payouts);

  if (afterCoverage > beforeCoverage) {
    console.log(`✅ COVERAGE IMPROVED: ${beforeCoverage} → ${afterCoverage} positions with payouts`);
  } else {
    console.log(`⚠️  No improvement yet - may need to check condition_id normalization`);
  }
  console.log('');

  // Step 6: Re-query Settled P&L
  console.log('═'.repeat(80));
  console.log('SETTLED P&L (AFTER FIX)');
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
    if (redemptionPnL > 0) {
      console.log(`✅ REDEMPTION P&L FOUND: $${redemptionPnL.toFixed(2)}`);
      console.log(`Gap to Polymarket ($332,563): $${(332563 - redemptionPnL).toFixed(2)}`);
    } else {
      console.log(`⚠️  Redemption P&L still $0 - need to investigate further`);
    }
  } else {
    console.log('No data for wallet');
  }
  console.log('');

  // Step 7: Show sample of payouts that are now available
  console.log('═'.repeat(80));
  console.log('SAMPLE PAYOUTS NOW AVAILABLE');
  console.log('═'.repeat(80));
  console.log('');

  const sample = await ch.query({
    query: `
      SELECT
        condition_id_32b,
        winning_index,
        payout_numerators,
        payout_denominator,
        source
      FROM cascadian_clean.vw_resolutions_truth
      WHERE source = 'market_resolutions_final'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const sampleData = await sample.json<any[]>();

  sampleData.forEach((row, i) => {
    console.log(`${i + 1}. Condition: ${row.condition_id_32b.substring(0, 20)}...`);
    console.log(`   Payout: [${row.payout_numerators}]/${row.payout_denominator}`);
    console.log(`   Winner: Outcome ${row.winning_index}`);
    console.log(`   Source: ${row.source}`);
    console.log('');
  });

  console.log('═'.repeat(80));
  console.log('VERDICT');
  console.log('═'.repeat(80));
  console.log('');

  if (afterCoverage > 0) {
    console.log(`✅ SUCCESS: Found payouts for ${afterCoverage}/${walletCoverageData[0].total_positions} wallet positions`);
    console.log('');
    console.log('The $333K gap should now be closing as Settled P&L recalculates.');
    console.log('');
    console.log('Next steps:');
    console.log('1. Verify the Settled P&L total approaches $332K');
    console.log('2. If any positions still missing, identify those specific condition_ids');
    console.log('3. Only fetch externally for the remaining gaps');
  } else {
    console.log(`⚠️  ISSUE: Still 0 payouts for wallet positions`);
    console.log('');
    console.log('Possible causes:');
    console.log('1. condition_id normalization mismatch between tables');
    console.log('2. The 30 markets genuinely not in market_resolutions_final');
    console.log('3. Need to check condition_id format in both tables');
    console.log('');
    console.log('Next: Run diagnostic to compare condition_id formats');
  }
  console.log('');

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
