import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

const WALLET = '0x6770bf688b8121331b1c5cfd7723ebd4152545fb';
const POLYMARKET_PNL = 1914;

async function validateHypothesis() {
  console.log('='.repeat(80));
  console.log('HYPOTHESIS VALIDATION: Unrealized = Losses Bug');
  console.log('='.repeat(80));
  console.log();

  // Test 1: Only count resolved markets
  console.log('TEST 1: P&L from RESOLVED markets only');
  console.log('-'.repeat(80));

  const resolvedQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as resolved_count,
        SUM(realized_pnl_usd) as resolved_pnl
      FROM realized_pnl_by_market_final
      WHERE wallet = '${WALLET}'
        AND resolved_at IS NOT NULL
        AND resolved_at != ''
    `,
    format: 'JSONEachRow',
  });

  const resolved = await resolvedQuery.json();
  console.log('Resolved markets data:', JSON.stringify(resolved[0], null, 2));
  console.log();

  if (resolved[0]) {
    const resolvedPnL = parseFloat(resolved[0].resolved_pnl || 0);
    const resolvedCount = parseInt(resolved[0].resolved_count);
    const error = Math.abs(resolvedPnL - POLYMARKET_PNL);
    const errorPct = (error / Math.abs(POLYMARKET_PNL)) * 100;

    console.log('COMPARISON:');
    console.log(`  Polymarket UI: $${POLYMARKET_PNL.toFixed(2)}`);
    console.log(`  Resolved Only: $${resolvedPnL.toFixed(2)}`);
    console.log(`  Error: $${error.toFixed(2)} (${errorPct.toFixed(1)}%)`);
    console.log();

    if (errorPct < 20) {
      console.log('SUCCESS - HYPOTHESIS CONFIRMED!');
      console.log('   Filtering to resolved markets brings us close to Polymarket.');
    } else {
      console.log('WARNING - Hypothesis partially supported but significant gap remains.');
    }
  }
  console.log();

  // Test 2: Count unresolved markets
  console.log('TEST 2: P&L from UNRESOLVED markets');
  console.log('-'.repeat(80));

  const unresolvedQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as unresolved_count,
        SUM(realized_pnl_usd) as unresolved_pnl,
        AVG(realized_pnl_usd) as avg_unresolved_pnl
      FROM realized_pnl_by_market_final
      WHERE wallet = '${WALLET}'
        AND (resolved_at IS NULL OR resolved_at = '')
    `,
    format: 'JSONEachRow',
  });

  const unresolved = await unresolvedQuery.json();
  console.log('Unresolved markets data:', JSON.stringify(unresolved[0], null, 2));
  console.log();

  if (unresolved[0]) {
    const unresolvedPnL = parseFloat(unresolved[0].unresolved_pnl || 0);
    const unresolvedCount = parseInt(unresolved[0].unresolved_count);
    const avgUnresolvedPnL = parseFloat(unresolved[0].avg_unresolved_pnl || 0);

    console.log('ANALYSIS:');
    console.log(`  Unresolved markets: ${unresolvedCount}`);
    console.log(`  Total "P&L" (fake): $${unresolvedPnL.toFixed(2)}`);
    console.log(`  Average per market: $${avgUnresolvedPnL.toFixed(2)}`);
    console.log();

    if (unresolvedPnL < 0 && Math.abs(unresolvedPnL) > Math.abs(POLYMARKET_PNL) * 5) {
      console.log('CONFIRMED: Unresolved positions treated as massive losses!');
      console.log(`   ${unresolvedCount} unresolved positions = $${unresolvedPnL.toFixed(2)} fake losses`);
    }
  }
  console.log();

  // Test 3: Total breakdown
  console.log('TEST 3: Complete breakdown');
  console.log('-'.repeat(80));

  const totalQuery = await clickhouse.query({
    query: `
      SELECT
        SUM(realized_pnl_usd) as total_pnl,
        SUM(CASE WHEN resolved_at IS NOT NULL AND resolved_at != '' THEN realized_pnl_usd ELSE 0 END) as pnl_resolved,
        SUM(CASE WHEN resolved_at IS NULL OR resolved_at = '' THEN realized_pnl_usd ELSE 0 END) as pnl_unresolved,
        COUNT(*) as total_markets,
        SUM(CASE WHEN resolved_at IS NOT NULL AND resolved_at != '' THEN 1 ELSE 0 END) as count_resolved,
        SUM(CASE WHEN resolved_at IS NULL OR resolved_at = '' THEN 1 ELSE 0 END) as count_unresolved
      FROM realized_pnl_by_market_final
      WHERE wallet = '${WALLET}'
    `,
    format: 'JSONEachRow',
  });

  const totals = await totalQuery.json();
  console.log('Complete breakdown:', JSON.stringify(totals[0], null, 2));
  console.log();

  console.log('='.repeat(80));
  console.log('FINAL VERDICT');
  console.log('='.repeat(80));
  console.log();

  if (totals[0]) {
    const pnlResolved = parseFloat(totals[0].pnl_resolved);
    const pnlUnresolved = parseFloat(totals[0].pnl_unresolved);
    const total = parseFloat(totals[0].total_pnl);

    console.log('BREAKDOWN:');
    console.log(`  Resolved markets P&L:   $${pnlResolved.toFixed(2)}`);
    console.log(`  Unresolved markets P&L: $${pnlUnresolved.toFixed(2)}`);
    console.log(`  Total (current):        $${total.toFixed(2)}`);
    console.log();
    console.log(`  Polymarket UI:          $${POLYMARKET_PNL.toFixed(2)}`);
    console.log();

    const errorWithResolved = Math.abs(pnlResolved - POLYMARKET_PNL);
    const errorPctWithResolved = (errorWithResolved / Math.abs(POLYMARKET_PNL)) * 100;

    if (errorPctWithResolved < 20) {
      console.log('SUCCESS SUCCESS SUCCESS - ROOT CAUSE CONFIRMED');
      console.log();
      console.log('The bug is: UNREALIZED POSITIONS TREATED AS LOSSES');
      console.log();
      console.log('FIX:');
      console.log('  1. Filter to resolved_at IS NOT NULL in P&L calculation');
      console.log('  2. Build separate unrealized P&L table with current prices');
      console.log('  3. Update UI to show realized vs unrealized clearly');
      console.log();
      console.log(`ERROR WITH FIX: ${errorPctWithResolved.toFixed(1)}% (acceptable)`);
    } else {
      console.log('WARNING - Hypothesis supported but gap remains:');
      console.log(`   Error: ${errorPctWithResolved.toFixed(1)}%`);
      console.log('   May need additional investigation');
    }
  }

  console.log('='.repeat(80));
}

validateHypothesis().catch(console.error);
