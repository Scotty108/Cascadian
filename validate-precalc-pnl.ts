import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function validatePreCalculatedPnL() {
  console.log('=== VALIDATING PRE-CALCULATED P&L FIELDS ===\n');

  console.log('Step 1: Check if trades_raw.realized_pnl_usd is populated\n');

  const coverage = await client.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        COUNT(CASE WHEN realized_pnl_usd IS NOT NULL AND realized_pnl_usd != 0 THEN 1 END) as has_realized_pnl,
        COUNT(CASE WHEN pnl IS NOT NULL THEN 1 END) as has_pnl,
        COUNT(CASE WHEN is_resolved = 1 THEN 1 END) as resolved_trades,
        COUNT(CASE WHEN is_resolved = 0 THEN 1 END) as unresolved_trades
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  });
  const coverageData = await coverage.json();
  console.log('Field coverage in trades_raw:');
  console.log(`  Total trades: ${coverageData[0].total_trades}`);
  console.log(`  Has realized_pnl_usd: ${coverageData[0].has_realized_pnl} (${(Number(coverageData[0].has_realized_pnl) / Number(coverageData[0].total_trades) * 100).toFixed(2)}%)`);
  console.log(`  Has pnl: ${coverageData[0].has_pnl} (${(Number(coverageData[0].has_pnl) / Number(coverageData[0].total_trades) * 100).toFixed(2)}%)`);
  console.log(`  Resolved trades: ${coverageData[0].resolved_trades} (${(Number(coverageData[0].resolved_trades) / Number(coverageData[0].total_trades) * 100).toFixed(2)}%)`);
  console.log(`  Unresolved trades: ${coverageData[0].unresolved_trades} (${(Number(coverageData[0].unresolved_trades) / Number(coverageData[0].total_trades) * 100).toFixed(2)}%)\n`);

  console.log('Step 2: Compare pre-calculated vs manual calculation for resolved trades\n');

  const comparison = await client.query({
    query: `
      SELECT
        t.trade_id,
        t.wallet_address,
        t.condition_id,
        t.shares,
        t.usd_value,
        t.realized_pnl_usd as precalc_pnl,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index,
        -- Manual calculation: IDN + PNL skills
        t.shares * (arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - t.usd_value as manual_pnl,
        abs(t.realized_pnl_usd - (t.shares * (arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - t.usd_value)) as pnl_diff
      FROM trades_raw t
      INNER JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
      WHERE t.is_resolved = 1
        AND t.realized_pnl_usd IS NOT NULL
      ORDER BY pnl_diff DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const comparisonData = await comparison.json();

  console.log('Top 20 trades with largest P&L calculation discrepancies:');
  console.log('(If precalc matches manual, diff should be ~0)\n');

  comparisonData.forEach((row: any, idx: number) => {
    console.log(`${idx + 1}. Trade ${row.trade_id.substring(0, 8)}...`);
    console.log(`   Shares: ${row.shares}, Cost: ${row.usd_value}`);
    console.log(`   Payout: [${row.payout_numerators}] / ${row.payout_denominator}, Winner: ${row.winning_index}`);
    console.log(`   Pre-calc P&L: ${row.precalc_pnl}`);
    console.log(`   Manual P&L: ${row.manual_pnl}`);
    console.log(`   Difference: ${row.pnl_diff}\n`);
  });

  console.log('\nStep 3: Summary statistics on P&L discrepancies\n');

  const discrepancyStats = await client.query({
    query: `
      SELECT
        COUNT(*) as sample_size,
        AVG(abs(pnl_diff)) as avg_diff,
        MAX(abs(pnl_diff)) as max_diff,
        MIN(abs(pnl_diff)) as min_diff,
        quantile(0.5)(abs(pnl_diff)) as median_diff,
        quantile(0.95)(abs(pnl_diff)) as p95_diff,
        COUNT(CASE WHEN abs(pnl_diff) < 0.01 THEN 1 END) as exact_matches,
        COUNT(CASE WHEN abs(pnl_diff) >= 0.01 THEN 1 END) as mismatches
      FROM (
        SELECT
          abs(t.realized_pnl_usd - (t.shares * (arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - t.usd_value)) as pnl_diff
        FROM trades_raw t
        INNER JOIN market_resolutions_final r
          ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
        WHERE t.is_resolved = 1
          AND t.realized_pnl_usd IS NOT NULL
      )
    `,
    format: 'JSONEachRow'
  });
  const statsData = await discrepancyStats.json();

  console.log('P&L calculation accuracy:');
  console.log(`  Sample size: ${statsData[0].sample_size} resolved trades`);
  console.log(`  Average difference: ${statsData[0].avg_diff}`);
  console.log(`  Median difference: ${statsData[0].median_diff}`);
  console.log(`  Max difference: ${statsData[0].max_diff}`);
  console.log(`  P95 difference: ${statsData[0].p95_diff}`);
  console.log(`  Exact matches (<$0.01 diff): ${statsData[0].exact_matches} (${(Number(statsData[0].exact_matches) / Number(statsData[0].sample_size) * 100).toFixed(2)}%)`);
  console.log(`  Mismatches (≥$0.01 diff): ${statsData[0].mismatches} (${(Number(statsData[0].mismatches) / Number(statsData[0].sample_size) * 100).toFixed(2)}%)\n`);

  console.log('Step 4: Check for unrealized P&L data availability\n');

  const unrealizedCheck = await client.query({
    query: `
      SELECT
        COUNT(*) as unresolved_trades,
        COUNT(CASE WHEN realized_pnl_usd IS NOT NULL AND realized_pnl_usd != 0 THEN 1 END) as has_unrealized_pnl,
        AVG(CASE WHEN realized_pnl_usd IS NOT NULL THEN realized_pnl_usd END) as avg_unrealized_pnl
      FROM trades_raw
      WHERE is_resolved = 0
    `,
    format: 'JSONEachRow'
  });
  const unrealizedData = await unrealizedCheck.json();

  console.log('Unrealized P&L data:');
  console.log(`  Unresolved trades: ${unrealizedData[0].unresolved_trades}`);
  console.log(`  Has unrealized P&L values: ${unrealizedData[0].has_unrealized_pnl}`);
  console.log(`  Average unrealized P&L: ${unrealizedData[0].avg_unrealized_pnl || 0}\n`);

  console.log('\n=== VALIDATION COMPLETE ===\n');
  console.log('Recommendation:');
  if (Number(statsData[0].exact_matches) / Number(statsData[0].sample_size) > 0.95) {
    console.log('✅ Pre-calculated realized_pnl_usd is ACCURATE (>95% exact matches)');
    console.log('   - Can use trades_raw.realized_pnl_usd directly for resolved trades');
    console.log('   - Focus effort on unrealized P&L calculation for unresolved trades');
  } else {
    console.log('❌ Pre-calculated realized_pnl_usd has ERRORS');
    console.log('   - Need to rebuild P&L from payout vectors');
    console.log('   - Follow PAYOUT_VECTOR_PNL_UPDATE.md methodology');
  }

  await client.close();
}

validatePreCalculatedPnL().catch(console.error);
