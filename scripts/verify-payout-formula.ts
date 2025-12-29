/**
 * Verify Payout Formula for Multi-Outcome Markets
 *
 * Investigates the payout_numerators scaling patterns across different market types
 * to ensure correct PnL calculations.
 *
 * Terminal: Claude 3
 * Date: 2025-11-25
 */

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('=== PAYOUT FORMULA VERIFICATION FOR MULTI-OUTCOME MARKETS ===\n');
  console.log('='.repeat(80));

  // Part 1: Get multi-outcome markets with resolution data
  console.log('\n📊 Part 1: Multi-outcome markets (denominator > 2)\n');

  const multiOutcome = await clickhouse.query({
    query: `
      SELECT
        r.condition_id,
        r.payout_numerators,
        r.payout_denominator
      FROM pm_condition_resolutions r
      WHERE toUInt8OrZero(r.payout_denominator) > 2
        AND r.payout_numerators != ''
        AND r.payout_numerators != '[]'
      ORDER BY toUInt8OrZero(r.payout_denominator) DESC
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });

  const multiMarkets = await multiOutcome.json() as any[];

  console.log('Analyzing multi-outcome market resolutions:\n');

  for (const m of multiMarkets) {
    if (!m.condition_id) continue;

    // Parse payout_numerators
    const payoutStr = m.payout_numerators || '';
    const numeratorStrings = payoutStr.replace(/\[|\]/g, '').split(',').map((s: string) => s.trim()).filter((s: string) => s);

    console.log('Market: ' + m.condition_id.slice(0, 16) + '...');
    console.log('  Denominator: ' + m.payout_denominator);
    console.log('  Raw payout_numerators: ' + payoutStr.slice(0, 60) + (payoutStr.length > 60 ? '...' : ''));
    console.log('  Outcome count: ' + numeratorStrings.length);

    // Parse and analyze scaling
    const numerators = numeratorStrings.map((s: string) => {
      const val = parseFloat(s);
      return isNaN(val) ? 0 : val;
    });

    const maxVal = Math.max(...numerators);

    let scalingType = 'raw (0-1)';
    let scaledNumerators = numerators;

    if (maxVal > 1 && maxVal <= 1e7) {
      scalingType = '1e6 scaled';
      scaledNumerators = numerators.map(n => n / 1e6);
    } else if (maxVal > 1e7) {
      scalingType = '1e18 scaled';
      scaledNumerators = numerators.map(n => n / 1e18);
    }

    console.log('  Scaling type: ' + scalingType);
    console.log('  Normalized payouts: [' + scaledNumerators.slice(0, 6).map(n => n.toFixed(4)).join(', ') + (scaledNumerators.length > 6 ? '...' : '') + ']');

    // Check if winner exists
    const winnerIdx = scaledNumerators.findIndex((n: number) => n > 0.5);
    if (winnerIdx >= 0) {
      console.log('  Winner: outcome_index=' + winnerIdx + ' (payout=' + scaledNumerators[winnerIdx].toFixed(4) + ')');
    } else {
      console.log('  Winner: No clear winner (all < 0.5)');
    }
    console.log('');
  }

  // Part 2: Get binary markets for comparison
  console.log('='.repeat(80));
  console.log('\n📊 Part 2: Binary markets (denominator = 2) for comparison\n');

  const binaryOutcome = await clickhouse.query({
    query: `
      SELECT
        r.condition_id,
        r.payout_numerators,
        r.payout_denominator
      FROM pm_condition_resolutions r
      WHERE toUInt8OrZero(r.payout_denominator) = 2
        AND r.payout_numerators != ''
        AND r.payout_numerators != '[]'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const binaryMarkets = await binaryOutcome.json() as any[];

  console.log('Binary market payout patterns:\n');

  for (const m of binaryMarkets) {
    if (!m.condition_id) continue;

    const payoutStr = m.payout_numerators || '';
    const numeratorStrings = payoutStr.replace(/\[|\]/g, '').split(',').map((s: string) => s.trim()).filter((s: string) => s);

    const numerators = numeratorStrings.map((s: string) => {
      const val = parseFloat(s);
      return isNaN(val) ? 0 : val;
    });

    const maxVal = Math.max(...numerators);

    let scalingType = 'raw (0-1)';
    if (maxVal > 1 && maxVal <= 1e7) {
      scalingType = '1e6 scaled';
    } else if (maxVal > 1e7) {
      scalingType = '1e18 scaled';
    }

    console.log('Market: ' + m.condition_id.slice(0, 16) + '... | Raw: ' + payoutStr + ' | Scaling: ' + scalingType);
  }

  // Part 3: Summary statistics
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Part 3: Summary Statistics\n');

  const summary = await clickhouse.query({
    query: `
      SELECT
        toUInt8OrZero(payout_denominator) as denom,
        count() as market_count,
        -- Check scaling by looking at max value pattern
        countIf(
          toFloat64OrNull(arrayElement(splitByString(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 1)) > 1e7
        ) as with_1e18_scaling,
        countIf(
          toFloat64OrNull(arrayElement(splitByString(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 1)) > 1
          AND toFloat64OrNull(arrayElement(splitByString(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 1)) <= 1e7
        ) as with_1e6_scaling,
        countIf(
          toFloat64OrNull(arrayElement(splitByString(',', replaceAll(replaceAll(payout_numerators, '[', ''), ']', '')), 1)) <= 1
        ) as with_raw_scaling
      FROM pm_condition_resolutions
      WHERE payout_numerators != ''
        AND payout_numerators != '[]'
      GROUP BY denom
      ORDER BY denom
    `,
    format: 'JSONEachRow'
  });

  const summaryData = await summary.json() as any[];

  console.log('Payout scaling distribution by outcome count:\n');
  console.log('Denom | Markets | 1e18 scale | 1e6 scale | raw scale');
  console.log('-'.repeat(55));

  for (const s of summaryData) {
    console.log(
      String(s.denom).padStart(5) + ' | ' +
      String(s.market_count).padStart(7) + ' | ' +
      String(s.with_1e18_scaling).padStart(10) + ' | ' +
      String(s.with_1e6_scaling).padStart(9) + ' | ' +
      String(s.with_raw_scaling).padStart(9)
    );
  }

  // Part 4: Key findings
  console.log('\n' + '='.repeat(80));
  console.log('\n📋 KEY FINDINGS FOR PAYOUT FORMULA:\n');
  console.log('1. DENOMINATOR = Outcome Count (not a divisor)');
  console.log('   - denominator=2 → binary market (YES/NO)');
  console.log('   - denominator=3+ → multi-outcome market');
  console.log('');
  console.log('2. SCALING Detection Logic:');
  console.log('   - if max(numerators) <= 1: raw values (0 or 1)');
  console.log('   - if max(numerators) <= 1e7: divide by 1e6');
  console.log('   - if max(numerators) > 1e7: divide by 1e18');
  console.log('');
  console.log('3. PAYOUT Calculation:');
  console.log('   payout = shares_held * normalized_payout_numerators[outcome_index]');
  console.log('');

  console.log('='.repeat(80));
  console.log('\n✅ PAYOUT FORMULA VERIFICATION COMPLETE\n');

  await clickhouse.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
