import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function investigatePayouts() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('INVESTIGATING PAYOUT CALCULATION ISSUE');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Check market_resolutions_final structure
  console.log('1. MARKET_RESOLUTIONS_FINAL SAMPLE DATA\n');

  const sampleResolutionsQuery = `
    SELECT
      substring(condition_id_norm, 1, 16) || '...' AS cid_short,
      payout_numerators,
      payout_denominator,
      outcome_count,
      winning_outcome,
      winning_index
    FROM market_resolutions_final
    LIMIT 10
  `;

  const resResult = await clickhouse.query({ query: sampleResolutionsQuery, format: 'JSONEachRow' });
  const resData = await resResult.json();

  resData.forEach((r, i) => {
    console.log(`${i + 1}. ${r.cid_short}`);
    console.log(`   Payout numerators: [${r.payout_numerators.join(', ')}]`);
    console.log(`   Payout denominator: ${r.payout_denominator}`);
    console.log(`   Outcome count: ${r.outcome_count}`);
    console.log(`   Winning: ${r.winning_outcome} (index ${r.winning_index})\n`);
  });

  // 2. Test payout calculation on a specific market
  console.log('2. TEST PAYOUT CALCULATION ON ONE MARKET\n');

  const testMarket = resData[0];
  const testCid = await clickhouse.query({
    query: `SELECT condition_id_norm FROM market_resolutions_final LIMIT 1`,
    format: 'JSONEachRow'
  });
  const testCidData = await testMarket.json();
  const cidForTest = testCidData[0].condition_id_norm;

  console.log(`Testing CID: ${cidForTest.substring(0, 16)}...\n`);

  // Find a wallet that traded this market
  const walletQuery = `
    SELECT
      wallet_canonical,
      outcome_index_v3,
      sumIf(toFloat64(shares), trade_direction = 'BUY') - sumIf(toFloat64(shares), trade_direction = 'SELL') AS net_shares
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE condition_id_norm_v3 = '${cidForTest}'
      AND condition_id_norm_v3 != ''
    GROUP BY wallet_canonical, outcome_index_v3
    HAVING net_shares != 0
    LIMIT 1
  `;

  const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' });
  const walletData = await walletResult.json();

  if (walletData.length > 0) {
    const w = walletData[0];
    console.log(`Wallet: ${w.wallet_canonical.substring(0, 16)}...`);
    console.log(`Outcome: ${w.outcome_index_v3}`);
    console.log(`Net shares: ${Number(w.net_shares).toFixed(2)}\n`);

    // Now test the payout calculation
    const payoutTestQuery = `
      WITH resolution AS (
        SELECT
          payout_numerators,
          payout_denominator,
          winning_outcome,
          winning_index
        FROM market_resolutions_final
        WHERE condition_id_norm = '${cidForTest}'
      )
      SELECT
        ${w.outcome_index_v3} AS outcome_idx,
        ${w.net_shares} AS net_shares,
        r.payout_numerators AS payout_nums,
        r.payout_denominator AS payout_denom,
        r.winning_index,
        -- Test array indexing (ClickHouse is 1-indexed)
        r.payout_numerators[${w.outcome_index_v3} + 1] AS payout_num_for_outcome,
        -- Test payout calculation
        COALESCE(
          toFloat64(r.payout_numerators[${w.outcome_index_v3} + 1]) / toFloat64(r.payout_denominator),
          0
        ) AS payout_per_share,
        ${w.net_shares} * payout_per_share AS settlement_value
      FROM resolution r
    `;

    const payoutTestResult = await clickhouse.query({ query: payoutTestQuery, format: 'JSONEachRow' });
    const payoutTestData = await payoutTestResult.json();

    if (payoutTestData.length > 0) {
      const p = payoutTestData[0];
      console.log(`Payout calculation:`);
      console.log(`  Payout numerators: [${p.payout_nums.join(', ')}]`);
      console.log(`  Payout denominator: ${p.payout_denom}`);
      console.log(`  Winning index: ${p.winning_index}`);
      console.log(`  Payout num for outcome ${p.outcome_idx}: ${p.payout_num_for_outcome}`);
      console.log(`  Payout per share: ${Number(p.payout_per_share).toFixed(4)}`);
      console.log(`  Settlement value: $${Number(p.settlement_value).toFixed(2)}\n`);

      if (Number(p.settlement_value) === 0) {
        console.log(`  ⚠️  ISSUE: Settlement value is $0!`);
        console.log(`  Possible causes:`);
        console.log(`    - Payout numerator is 0 for this outcome`);
        console.log(`    - Array indexing issue`);
        console.log(`    - Net shares is 0\n`);
      }
    } else {
      console.log(`  ❌ No resolution data found\n`);
    }
  } else {
    console.log(`  No wallet found trading this market\n`);
  }

  // 3. Check if payout_numerators are mostly zeros
  console.log('3. PAYOUT NUMERATORS DISTRIBUTION\n');

  const distQuery = `
    SELECT
      arraySum(payout_numerators) AS total_payout,
      countIf(total_payout = 0) AS zero_payouts,
      countIf(total_payout > 0) AS nonzero_payouts,
      count() AS total_markets
    FROM market_resolutions_final
  `;

  const distResult = await clickhouse.query({ query: distQuery, format: 'JSONEachRow' });
  const distData = await distResult.json()[0];

  console.log(`  Total markets with resolutions: ${Number(distData.total_markets).toLocaleString()}`);
  console.log(`  Markets with zero payouts: ${Number(distData.zero_payouts).toLocaleString()} (${(100 * distData.zero_payouts / distData.total_markets).toFixed(1)}%)`);
  console.log(`  Markets with non-zero payouts: ${Number(distData.nonzero_payouts).toLocaleString()} (${(100 * distData.nonzero_payouts / distData.total_markets).toFixed(1)}%)\n`);

  // 4. Sample non-zero payout markets
  console.log('4. MARKETS WITH NON-ZERO PAYOUTS (sample)\n');

  const nonzeroQuery = `
    SELECT
      substring(condition_id_norm, 1, 16) || '...' AS cid_short,
      payout_numerators,
      payout_denominator,
      arraySum(payout_numerators) AS total_payout,
      winning_index
    FROM market_resolutions_final
    WHERE arraySum(payout_numerators) > 0
    LIMIT 5
  `;

  const nonzeroResult = await clickhouse.query({ query: nonzeroQuery, format: 'JSONEachRow' });
  const nonzeroData = await nonzeroResult.json();

  nonzeroData.forEach((m, i) => {
    console.log(`${i + 1}. ${m.cid_short}`);
    console.log(`   Numerators: [${m.payout_numerators.join(', ')}] / ${m.payout_denominator}`);
    console.log(`   Total payout: ${m.total_payout}`);
    console.log(`   Winning index: ${m.winning_index}\n`);
  });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('INVESTIGATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
}

investigatePayouts()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
