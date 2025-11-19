#!/usr/bin/env tsx
/**
 * P&L Diagnostics and Sanity Checks
 *
 * Validates pm_wallet_market_pnl_resolved view against expected invariants.
 * Tests zero-sum property (sum of P&L ≈ -fees) for each market.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { appendFileSync } from 'fs';

async function main() {
  console.log('📊 P&L Diagnostics and Sanity Checks');
  console.log('='.repeat(60));
  console.log('');

  // === D1: Basic Coverage Stats ===
  console.log('D1: Coverage Statistics');
  console.log('-'.repeat(60));
  console.log('');

  const coverageQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(DISTINCT wallet_address) as distinct_wallets,
        COUNT(DISTINCT condition_id) as distinct_markets,
        SUM(total_trades) as total_trades,
        COUNT(DISTINCT (condition_id, outcome_index)) as distinct_market_outcomes
      FROM pm_wallet_market_pnl_resolved
    `,
    format: 'JSONEachRow'
  });

  const coverage = await coverageQuery.json();
  console.log('Coverage:');
  console.table(coverage);
  console.log('');

  // === D2: P&L Distribution ===
  console.log('D2: P&L Distribution');
  console.log('-'.repeat(60));
  console.log('');

  const distributionQuery = await clickhouse.query({
    query: `
      SELECT
        MIN(pnl_net) as min_pnl,
        quantile(0.25)(pnl_net) as p25_pnl,
        quantile(0.50)(pnl_net) as median_pnl,
        quantile(0.75)(pnl_net) as p75_pnl,
        quantile(0.90)(pnl_net) as p90_pnl,
        quantile(0.99)(pnl_net) as p99_pnl,
        MAX(pnl_net) as max_pnl,
        AVG(pnl_net) as avg_pnl,
        SUM(pnl_net) as total_pnl_net,
        SUM(fees_paid) as total_fees
      FROM pm_wallet_market_pnl_resolved
    `,
    format: 'JSONEachRow'
  });

  const distribution = await distributionQuery.json();
  console.log('P&L Distribution:');
  console.table(distribution);
  console.log('');

  // === D3: Top Winners and Losers ===
  console.log('D3: Top 20 Winners');
  console.log('-'.repeat(60));
  console.log('');

  const winnersQuery = await clickhouse.query({
    query: `
      SELECT
        substring(wallet_address, 1, 10) || '...' as wallet,
        COUNT(DISTINCT condition_id) as markets_traded,
        SUM(total_trades) as total_trades,
        ROUND(SUM(fees_paid), 2) as total_fees,
        ROUND(SUM(pnl_net), 2) as total_pnl_net
      FROM pm_wallet_market_pnl_resolved
      GROUP BY wallet_address
      ORDER BY SUM(pnl_net) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const winners = await winnersQuery.json();
  console.log('Top 20 Wallets by Net P&L:');
  console.table(winners);
  console.log('');

  console.log('D4: Bottom 20 Losers');
  console.log('-'.repeat(60));
  console.log('');

  const losersQuery = await clickhouse.query({
    query: `
      SELECT
        substring(wallet_address, 1, 10) || '...' as wallet,
        COUNT(DISTINCT condition_id) as markets_traded,
        SUM(total_trades) as total_trades,
        ROUND(SUM(fees_paid), 2) as total_fees,
        ROUND(SUM(pnl_net), 2) as total_pnl_net
      FROM pm_wallet_market_pnl_resolved
      GROUP BY wallet_address
      ORDER BY SUM(pnl_net) ASC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const losers = await losersQuery.json();
  console.log('Bottom 20 Wallets by Net P&L:');
  console.table(losers);
  console.log('');

  // === D5: Zero-Sum Check (Conservation of Money) ===
  console.log('D5: Zero-Sum Conservation Check');
  console.log('-'.repeat(60));
  console.log('');
  console.log('Theory: For each market, SUM(pnl_net) + SUM(fees) ≈ 0');
  console.log('(All P&L is transferred between traders, fees are pure cost)');
  console.log('');

  const conservationQuery = await clickhouse.query({
    query: `
      WITH market_totals AS (
        SELECT
          condition_id,
          SUM(pnl_net) as market_pnl_net,
          SUM(fees_paid) as market_fees,
          SUM(pnl_net) + SUM(fees_paid) as deviation,
          ABS(SUM(pnl_net) + SUM(fees_paid)) as abs_deviation,
          COUNT(DISTINCT wallet_address) as num_wallets
        FROM pm_wallet_market_pnl_resolved
        GROUP BY condition_id
      )
      SELECT
        COUNT(*) as total_markets,
        COUNT(CASE WHEN abs_deviation < 0.01 THEN 1 END) as perfect_conservation,
        COUNT(CASE WHEN abs_deviation < 1.00 THEN 1 END) as good_conservation,
        COUNT(CASE WHEN abs_deviation >= 1.00 AND abs_deviation < 100 THEN 1 END) as moderate_deviation,
        COUNT(CASE WHEN abs_deviation >= 100 THEN 1 END) as high_deviation,
        ROUND(AVG(abs_deviation), 4) as avg_abs_deviation,
        ROUND(MAX(abs_deviation), 2) as max_deviation
      FROM market_totals
    `,
    format: 'JSONEachRow'
  });

  const conservation = await conservationQuery.json();
  console.log('Conservation Check:');
  console.table(conservation);
  console.log('');

  // === D6: Markets Failing Conservation ===
  console.log('D6: Markets with Largest Deviations');
  console.log('-'.repeat(60));
  console.log('');

  const failedMarketsQuery = await clickhouse.query({
    query: `
      WITH market_totals AS (
        SELECT
          condition_id,
          SUM(pnl_net) as market_pnl_net,
          SUM(fees_paid) as market_fees,
          SUM(pnl_net) + SUM(fees_paid) as deviation,
          ABS(SUM(pnl_net) + SUM(fees_paid)) as abs_deviation,
          COUNT(DISTINCT wallet_address) as num_wallets,
          argMin(question, wallet_address) as question
        FROM pm_wallet_market_pnl_resolved
        GROUP BY condition_id
      )
      SELECT
        substring(condition_id, 1, 16) || '...' as condition_short,
        ROUND(market_pnl_net, 2) as total_pnl,
        ROUND(market_fees, 2) as total_fees,
        ROUND(deviation, 2) as deviation,
        num_wallets,
        substring(question, 1, 50) || '...' as question_short
      FROM market_totals
      WHERE abs_deviation >= 1.0
      ORDER BY abs_deviation DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const failedMarkets = await failedMarketsQuery.json();
  console.log('Top 20 Markets by Conservation Deviation:');
  console.table(failedMarkets);
  console.log('');

  // === D7: Wallet-Level Win Rate ===
  console.log('D7: Wallet-Level Win Rate Analysis');
  console.log('-'.repeat(60));
  console.log('');

  const winRateQuery = await clickhouse.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          wallet_address,
          COUNT(DISTINCT condition_id) as total_markets,
          COUNT(DISTINCT CASE WHEN pnl_net > 0 THEN condition_id END) as winning_markets,
          ROUND(COUNT(DISTINCT CASE WHEN pnl_net > 0 THEN condition_id END) * 100.0 /
                COUNT(DISTINCT condition_id), 2) as win_rate_pct,
          SUM(pnl_net) as total_pnl
        FROM pm_wallet_market_pnl_resolved
        GROUP BY wallet_address
        HAVING total_markets >= 10  -- Only wallets with 10+ markets
      )
      SELECT
        COUNT(*) as wallets_with_10plus_markets,
        ROUND(AVG(win_rate_pct), 2) as avg_win_rate,
        ROUND(quantile(0.50)(win_rate_pct), 2) as median_win_rate,
        COUNT(CASE WHEN win_rate_pct > 50 THEN 1 END) as profitable_wallets,
        COUNT(CASE WHEN win_rate_pct < 50 THEN 1 END) as unprofitable_wallets
      FROM wallet_stats
    `,
    format: 'JSONEachRow'
  });

  const winRate = await winRateQuery.json();
  console.log('Win Rate Statistics (wallets with 10+ markets):');
  console.table(winRate);
  console.log('');

  // === SUMMARY ===
  console.log('='.repeat(60));
  console.log('📋 DIAGNOSTIC SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  console.log('Coverage:');
  console.log(`  Total Positions: ${parseInt(coverage[0].total_positions).toLocaleString()}`);
  console.log(`  Distinct Wallets: ${parseInt(coverage[0].distinct_wallets).toLocaleString()}`);
  console.log(`  Distinct Markets: ${parseInt(coverage[0].distinct_markets).toLocaleString()}`);
  console.log(`  Total Trades: ${parseInt(coverage[0].total_trades).toLocaleString()}`);
  console.log('');

  console.log('P&L Summary:');
  console.log(`  Total Net P&L: $${parseFloat(distribution[0].total_pnl_net).toLocaleString()}`);
  console.log(`  Total Fees: $${parseFloat(distribution[0].total_fees).toLocaleString()}`);
  console.log(`  Average P&L per Position: $${parseFloat(distribution[0].avg_pnl).toLocaleString()}`);
  console.log('');

  console.log('Conservation Check:');
  console.log(`  Markets Checked: ${parseInt(conservation[0].total_markets).toLocaleString()}`);
  console.log(`  Perfect (<$0.01): ${parseInt(conservation[0].perfect_conservation).toLocaleString()} (${(parseInt(conservation[0].perfect_conservation) / parseInt(conservation[0].total_markets) * 100).toFixed(2)}%)`);
  console.log(`  Good (<$1.00): ${parseInt(conservation[0].good_conservation).toLocaleString()} (${(parseInt(conservation[0].good_conservation) / parseInt(conservation[0].total_markets) * 100).toFixed(2)}%)`);
  console.log(`  High Deviation (≥$100): ${parseInt(conservation[0].high_deviation).toLocaleString()} (${(parseInt(conservation[0].high_deviation) / parseInt(conservation[0].total_markets) * 100).toFixed(2)}%)`);
  console.log(`  Average Deviation: $${parseFloat(conservation[0].avg_abs_deviation).toFixed(4)}`);
  console.log(`  Max Deviation: $${parseFloat(conservation[0].max_deviation).toLocaleString()}`);
  console.log('');

  const anomalies = [];

  // Check if conservation rate is acceptable (>95% within $1)
  const goodConservationPct = parseInt(conservation[0].good_conservation) / parseInt(conservation[0].total_markets) * 100;
  if (goodConservationPct < 95) {
    anomalies.push(`⚠️  Only ${goodConservationPct.toFixed(2)}% of markets conserve money within $1 (expected >95%)`);
  }

  // Check if total P&L + fees is close to zero
  const totalDeviation = parseFloat(distribution[0].total_pnl_net) + parseFloat(distribution[0].total_fees);
  const totalDeviationPct = Math.abs(totalDeviation) / parseFloat(distribution[0].total_fees) * 100;
  if (totalDeviationPct > 1) {
    anomalies.push(`⚠️  Global deviation: $${totalDeviation.toLocaleString()} (${totalDeviationPct.toFixed(2)}% of fees)`);
  }

  if (anomalies.length > 0) {
    console.log('Anomalies Detected:');
    anomalies.forEach(a => console.log(`  ${a}`));
    console.log('');
  } else {
    console.log('✅ All invariants validated');
    console.log('');
  }

  // Append to coverage report
  const report = `

## P&L Diagnostics (pm_wallet_market_pnl_resolved)

**Created:** ${new Date().toISOString().split('T')[0]}

### Coverage
- **Total Positions:** ${parseInt(coverage[0].total_positions).toLocaleString()}
- **Distinct Wallets:** ${parseInt(coverage[0].distinct_wallets).toLocaleString()}
- **Distinct Markets:** ${parseInt(coverage[0].distinct_markets).toLocaleString()}
- **Total Trades:** ${parseInt(coverage[0].total_trades).toLocaleString()}

### P&L Summary
- **Total Net P&L:** $${parseFloat(distribution[0].total_pnl_net).toLocaleString()}
- **Total Fees Paid:** $${parseFloat(distribution[0].total_fees).toLocaleString()}
- **Average P&L per Position:** $${parseFloat(distribution[0].avg_pnl).toLocaleString()}

### Distribution
- **Min P&L:** $${parseFloat(distribution[0].min_pnl).toLocaleString()}
- **Median P&L:** $${parseFloat(distribution[0].median_pnl).toLocaleString()}
- **Max P&L:** $${parseFloat(distribution[0].max_pnl).toLocaleString()}
- **P90:** $${parseFloat(distribution[0].p90_pnl).toLocaleString()}
- **P99:** $${parseFloat(distribution[0].p99_pnl).toLocaleString()}

### Conservation Check (Zero-Sum Invariant)
- **Markets Checked:** ${parseInt(conservation[0].total_markets).toLocaleString()}
- **Perfect Conservation (<$0.01):** ${parseInt(conservation[0].perfect_conservation).toLocaleString()} (${(parseInt(conservation[0].perfect_conservation) / parseInt(conservation[0].total_markets) * 100).toFixed(2)}%)
- **Good Conservation (<$1.00):** ${parseInt(conservation[0].good_conservation).toLocaleString()} (${(parseInt(conservation[0].good_conservation) / parseInt(conservation[0].total_markets) * 100).toFixed(2)}%)
- **High Deviation (≥$100):** ${parseInt(conservation[0].high_deviation).toLocaleString()} (${(parseInt(conservation[0].high_deviation) / parseInt(conservation[0].total_markets) * 100).toFixed(2)}%)
- **Average Absolute Deviation:** $${parseFloat(conservation[0].avg_abs_deviation).toFixed(4)}
- **Max Deviation:** $${parseFloat(conservation[0].max_deviation).toLocaleString()}

### Interpretation
- **Zero-Sum Property:** For each market, the sum of all wallets' P&L plus fees should equal ~$0
- **Deviation Sources:** Rounding errors, incomplete data, or calculation bugs
- **Threshold:** Markets with deviation >$1 flagged for investigation

### Win Rate Analysis (Wallets with 10+ Markets)
- **Total Qualified Wallets:** ${parseInt(winRate[0].wallets_with_10plus_markets).toLocaleString()}
- **Average Win Rate:** ${parseFloat(winRate[0].avg_win_rate).toFixed(2)}%
- **Median Win Rate:** ${parseFloat(winRate[0].median_win_rate).toFixed(2)}%
- **Profitable Wallets (>50% win rate):** ${parseInt(winRate[0].profitable_wallets).toLocaleString()}
- **Unprofitable Wallets (<50% win rate):** ${parseInt(winRate[0].unprofitable_wallets).toLocaleString()}

### Anomalies
${anomalies.length > 0 ? anomalies.map(a => `- ${a}`).join('\n') : '- None detected'}

### Markets Failing Conservation (Top 20)
${failedMarkets.length > 0 ? `
| Condition ID | Total P&L | Total Fees | Deviation | Wallets | Question |
|--------------|-----------|------------|-----------|---------|----------|
${failedMarkets.slice(0, 10).map(m => `| ${m.condition_short} | $${parseFloat(m.total_pnl).toLocaleString()} | $${parseFloat(m.total_fees).toLocaleString()} | $${parseFloat(m.deviation).toLocaleString()} | ${m.num_wallets} | ${m.question_short} |`).join('\n')}

*(Showing first 10 of ${failedMarkets.length} markets with deviation ≥$1)*
` : '- None (all markets within $1 tolerance)'}

**Status:** ✅ Complete
`;

  try {
    appendFileSync('DATA_COVERAGE_REPORT_C1.md', report);
    console.log('✅ Report appended to DATA_COVERAGE_REPORT_C1.md');
  } catch (error) {
    console.log('⚠️  Could not append to coverage report:', error);
  }
  console.log('');
}

main().catch((error) => {
  console.error('❌ Diagnostics failed:', error);
  process.exit(1);
});
