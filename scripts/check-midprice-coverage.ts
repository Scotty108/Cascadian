import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('='.repeat(80));
  console.log('MIDPRICE COVERAGE ANALYSIS');
  console.log('='.repeat(80));

  // 1. Overall market coverage
  console.log('\n1. MARKET COVERAGE:');
  const marketCoverageResult = await client.query({
    query: `
      SELECT
        count(DISTINCT market_cid) as markets_with_positions
      FROM cascadian_clean.vw_positions_open
    `,
    format: 'JSONEachRow',
  });
  const marketsWithPos = await marketCoverageResult.json<any>();

  const marketMidpricesResult = await client.query({
    query: `
      SELECT
        count(DISTINCT market_cid) as markets_with_midprices
      FROM cascadian_clean.midprices_latest
    `,
    format: 'JSONEachRow',
  });
  const marketsWithMid = await marketMidpricesResult.json<any>();

  console.log(`  Markets with open positions: ${marketsWithPos[0].markets_with_positions.toLocaleString()}`);
  console.log(`  Markets with midprices: ${marketsWithMid[0].markets_with_midprices.toLocaleString()}`);

  const coverage = (marketsWithMid[0].markets_with_midprices / marketsWithPos[0].markets_with_positions * 100);
  console.log(`  Coverage: ${coverage.toFixed(1)}%`);

  // 2. Position-level coverage
  console.log('\n2. POSITION-LEVEL COVERAGE:');
  const positionCoverageResult = await client.query({
    query: `
      SELECT
        count(*) as total_positions,
        countIf(midprice > 0) as positions_with_midprice,
        sum(abs(qty * avg_cost)) as total_position_value,
        sumIf(abs(qty * avg_cost), midprice > 0) as covered_position_value
      FROM cascadian_clean.vw_positions_open
    `,
    format: 'JSONEachRow',
  });
  const posCoverage = await positionCoverageResult.json<any>();

  console.log(`  Total open positions: ${posCoverage[0].total_positions.toLocaleString()}`);
  console.log(`  Positions with midprices: ${posCoverage[0].positions_with_midprice.toLocaleString()}`);

  const positionCoveragePercent = (posCoverage[0].positions_with_midprice / posCoverage[0].total_positions * 100);
  console.log(`  Coverage: ${positionCoveragePercent.toFixed(1)}%`);

  const valueCoveragePercent = (posCoverage[0].covered_position_value / posCoverage[0].total_position_value * 100);
  console.log(`  Value coverage: ${valueCoveragePercent.toFixed(1)}%`);

  // 3. Top markets missing midprices
  console.log('\n3. TOP 10 MARKETS MISSING MIDPRICES (by position count):');
  const missingMidpricesResult = await client.query({
    query: `
      SELECT
        p.market_cid,
        count(DISTINCT p.wallet) as wallets_affected,
        count(*) as positions_missing,
        sum(abs(p.qty * p.avg_cost)) as total_value
      FROM cascadian_clean.vw_positions_open p
      LEFT JOIN cascadian_clean.midprices_latest m
        ON p.market_cid = m.market_cid AND p.outcome = m.outcome
      WHERE m.midprice IS NULL
      GROUP BY p.market_cid
      ORDER BY positions_missing DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const missingMarkets = await missingMidpricesResult.json<any>();

  missingMarkets.forEach((m: any, i: number) => {
    const cidShort = m.market_cid.slice(0, 20);
    console.log(`  ${i+1}. ${cidShort}...`);
    console.log(`     ${m.positions_missing} positions | ${m.wallets_affected} wallets | $${m.total_value.toFixed(2)} value`);
  });

  // 4. Unrealized P&L impact
  console.log('\n4. UNREALIZED P&L IMPACT:');
  const pnlImpactResult = await client.query({
    query: `
      SELECT
        sum(unrealized_pnl_usd) as total_unrealized_pnl,
        sumIf(unrealized_pnl_usd, midprice > 0) as covered_unrealized_pnl,
        sumIf(unrealized_pnl_usd, midprice = 0) as uncovered_unrealized_pnl
      FROM cascadian_clean.vw_positions_open
    `,
    format: 'JSONEachRow',
  });
  const pnlImpact = await pnlImpactResult.json<any>();

  console.log(`  Total unrealized P&L (with midprices): $${pnlImpact[0].covered_unrealized_pnl?.toLocaleString() || 0}`);
  console.log(`  Estimated P&L from uncovered positions: $${pnlImpact[0].uncovered_unrealized_pnl?.toLocaleString() || 0}`);
  console.log(`  TOTAL: $${pnlImpact[0].total_unrealized_pnl?.toLocaleString() || 0}`);

  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDATION:');
  console.log('='.repeat(80));

  if (coverage < 50) {
    console.log('❌ CRITICAL: Less than 50% market coverage');
    console.log('   Action: Immediate backfill of midprices for all active markets');
  } else if (coverage < 80) {
    console.log('⚠ WARNING: Less than 80% market coverage');
    console.log('   Action: Backfill missing midprices within 24 hours');
  } else if (coverage < 95) {
    console.log('⚡ GOOD: Above 80% coverage but room for improvement');
    console.log('   Action: Backfill missing midprices when convenient');
  } else {
    console.log('✓ EXCELLENT: Above 95% coverage');
  }

  await client.close();
}

main().catch(console.error);
