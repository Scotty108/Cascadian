/**
 * Forensic Analysis: Wallet 0x6770bf688b8121331b1c5cfd7723ebd4152545fb
 *
 * Objective: Find exact source of 3.6x P&L inflation
 * Expected: $1,914 (Polymarket UI)
 * Actual: $6,870 (Our database)
 * Discrepancy: 3.6x
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const WALLET = '0x6770bf688b8121331b1c5cfd7723ebd4152545fb';

async function forensicAnalysis() {
  console.log('='.repeat(80));
  console.log('FORENSIC ANALYSIS: Wallet 3.6x P&L Inflation Investigation');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log(`Expected P&L: $1,914 (Polymarket UI)`);
  console.log(`Our P&L: $6,870`);
  console.log(`Inflation Factor: 3.6x`);
  console.log('='.repeat(80));
  console.log();

  // Step 1: Get current P&L from our system
  console.log('STEP 1: Current System P&L Calculation');
  console.log('-'.repeat(80));

  const currentPnL = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        SUM(pnl_usd) as total_pnl,
        SUM(CASE WHEN pnl_usd > 0 THEN pnl_usd ELSE 0 END) as total_gains,
        SUM(CASE WHEN pnl_usd < 0 THEN pnl_usd ELSE 0 END) as total_losses,
        COUNT(*) as position_count,
        COUNT(DISTINCT market_id) as unique_markets
      FROM polymarket_wallet_pnl
      WHERE wallet_address = '${WALLET}'
      GROUP BY wallet_address
    `,
    format: 'JSONEachRow',
  });

  const pnlData = await currentPnL.json();
  console.log('Current P&L Data:', JSON.stringify(pnlData, null, 2));
  console.log();

  // Step 2: Breakdown by market
  console.log('STEP 2: P&L Breakdown by Market');
  console.log('-'.repeat(80));

  const marketBreakdown = await clickhouse.query({
    query: `
      SELECT
        market_id,
        COUNT(*) as position_count,
        SUM(shares) as total_shares,
        SUM(pnl_usd) as market_pnl,
        AVG(pnl_usd) as avg_pnl,
        SUM(CASE WHEN pnl_usd > 0 THEN 1 ELSE 0 END) as winning_positions,
        SUM(CASE WHEN pnl_usd < 0 THEN 1 ELSE 0 END) as losing_positions
      FROM polymarket_wallet_pnl
      WHERE wallet_address = '${WALLET}'
      GROUP BY market_id
      ORDER BY market_pnl DESC
    `,
    format: 'JSONEachRow',
  });

  const markets = await marketBreakdown.json();
  console.log('Market Breakdown:');
  markets.forEach((m: any, i: number) => {
    console.log(`  ${i + 1}. Market: ${m.market_id}`);
    console.log(`     Positions: ${m.position_count} | Shares: ${m.total_shares}`);
    console.log(`     P&L: $${parseFloat(m.market_pnl).toFixed(2)} | Avg: $${parseFloat(m.avg_pnl).toFixed(2)}`);
    console.log(`     W/L: ${m.winning_positions}W / ${m.losing_positions}L`);
    console.log();
  });

  // Step 3: Get raw cashflow data
  console.log('STEP 3: Raw Cashflow Analysis');
  console.log('-'.repeat(80));

  const cashflows = await clickhouse.query({
    query: `
      SELECT
        market_id,
        outcome_index,
        SUM(shares) as total_shares,
        SUM(cost_basis) as total_cost,
        COUNT(*) as trade_count,
        COUNT(DISTINCT tx_hash) as unique_txs
      FROM polymarket_wallet_pnl
      WHERE wallet_address = '${WALLET}'
      GROUP BY market_id, outcome_index
      ORDER BY market_id, outcome_index
    `,
    format: 'JSONEachRow',
  });

  const flows = await cashflows.json();
  console.log('Cashflow Summary:');
  flows.forEach((f: any, i: number) => {
    console.log(`  ${i + 1}. Market: ${f.market_id} | Outcome: ${f.outcome_index}`);
    console.log(`     Shares: ${f.total_shares} | Cost: $${parseFloat(f.total_cost).toFixed(2)}`);
    console.log(`     Trades: ${f.trade_count} | Unique TXs: ${f.unique_txs}`);
    console.log();
  });

  // Step 4: Check for duplicate counting
  console.log('STEP 4: Duplicate Detection Analysis');
  console.log('-'.repeat(80));

  const duplicates = await clickhouse.query({
    query: `
      SELECT
        market_id,
        outcome_index,
        tx_hash,
        COUNT(*) as occurrence_count,
        SUM(shares) as total_shares,
        SUM(pnl_usd) as total_pnl
      FROM polymarket_wallet_pnl
      WHERE wallet_address = '${WALLET}'
      GROUP BY market_id, outcome_index, tx_hash
      HAVING COUNT(*) > 1
      ORDER BY occurrence_count DESC
    `,
    format: 'JSONEachRow',
  });

  const dupes = await duplicates.json();
  if (dupes.length > 0) {
    console.log('⚠️  DUPLICATES FOUND!');
    console.log(`Found ${dupes.length} transactions counted multiple times:`);
    dupes.forEach((d: any, i: number) => {
      console.log(`  ${i + 1}. TX: ${d.tx_hash}`);
      console.log(`     Market: ${d.market_id} | Outcome: ${d.outcome_index}`);
      console.log(`     Counted: ${d.occurrence_count}x | P&L: $${parseFloat(d.total_pnl).toFixed(2)}`);
      console.log();
    });
  } else {
    console.log('✓ No duplicate transactions found');
  }
  console.log();

  // Step 5: Manual P&L calculation from source data
  console.log('STEP 5: Manual P&L Calculation from Source');
  console.log('-'.repeat(80));

  const sourceData = await clickhouse.query({
    query: `
      SELECT
        market_id,
        outcome_index,
        shares,
        cost_basis,
        payout_per_share,
        pnl_usd,
        tx_hash
      FROM polymarket_wallet_pnl
      WHERE wallet_address = '${WALLET}'
      ORDER BY market_id, outcome_index
    `,
    format: 'JSONEachRow',
  });

  const positions = await sourceData.json();
  console.log(`Total positions in database: ${positions.length}`);

  let manualPnL = 0;
  let netShares = 0;
  let netCost = 0;

  positions.forEach((p: any) => {
    const pnl = parseFloat(p.pnl_usd);
    manualPnL += pnl;
    netShares += parseFloat(p.shares);
    netCost += parseFloat(p.cost_basis);
  });

  console.log(`Manual Sum of P&L: $${manualPnL.toFixed(2)}`);
  console.log(`Net Shares: ${netShares.toFixed(2)}`);
  console.log(`Net Cost: $${netCost.toFixed(2)}`);
  console.log();

  // Step 6: Calculate theoretical correct P&L
  console.log('STEP 6: Calculating Theoretical Correct P&L');
  console.log('-'.repeat(80));

  const expectedPnL = 1914;
  const actualPnL = 6870;
  const inflationFactor = actualPnL / expectedPnL;

  console.log(`Expected P&L (Polymarket): $${expectedPnL.toFixed(2)}`);
  console.log(`Actual P&L (Our DB): $${actualPnL.toFixed(2)}`);
  console.log(`Inflation Factor: ${inflationFactor.toFixed(2)}x`);
  console.log();

  if (Math.abs(inflationFactor - 3.6) < 0.1) {
    console.log('✓ Inflation factor matches expected 3.6x');
  } else {
    console.log(`⚠️  Inflation factor mismatch: expected 3.6x, got ${inflationFactor.toFixed(2)}x`);
  }
  console.log();

  // Step 7: Test hypothesis - dividing by 3.6
  console.log('STEP 7: Hypothesis Testing');
  console.log('-'.repeat(80));

  const correctedPnL = actualPnL / 3.6;
  const errorMargin = Math.abs(correctedPnL - expectedPnL);
  const errorPercent = (errorMargin / expectedPnL) * 100;

  console.log(`If we divide $${actualPnL} by 3.6:`);
  console.log(`  Result: $${correctedPnL.toFixed(2)}`);
  console.log(`  Expected: $${expectedPnL.toFixed(2)}`);
  console.log(`  Error: $${errorMargin.toFixed(2)} (${errorPercent.toFixed(2)}%)`);
  console.log();

  if (errorPercent < 5) {
    console.log('✓ HYPOTHESIS CONFIRMED: Simple 3.6x multiplier factor');
  } else {
    console.log('✗ Hypothesis rejected: Factor is not consistent');
  }
  console.log();

  // Step 8: Check for systematic multipliers
  console.log('STEP 8: Searching for Systematic Multipliers');
  console.log('-'.repeat(80));

  // Check if positions are being counted multiple times per outcome
  const outcomeMultiplier = await clickhouse.query({
    query: `
      SELECT
        market_id,
        outcome_index,
        COUNT(*) as row_count,
        COUNT(DISTINCT tx_hash) as unique_tx_count,
        COUNT(*) / COUNT(DISTINCT tx_hash) as multiplier_per_tx
      FROM polymarket_wallet_pnl
      WHERE wallet_address = '${WALLET}'
      GROUP BY market_id, outcome_index
      HAVING COUNT(*) > COUNT(DISTINCT tx_hash)
    `,
    format: 'JSONEachRow',
  });

  const multipliers = await outcomeMultiplier.json();
  if (multipliers.length > 0) {
    console.log('⚠️  MULTIPLIER PATTERN DETECTED!');
    console.log('Positions being counted multiple times per transaction:');
    multipliers.forEach((m: any) => {
      console.log(`  Market: ${m.market_id} | Outcome: ${m.outcome_index}`);
      console.log(`    Rows: ${m.row_count} | Unique TXs: ${m.unique_tx_count}`);
      console.log(`    Multiplier: ${parseFloat(m.multiplier_per_tx).toFixed(2)}x per transaction`);
      console.log();
    });
  } else {
    console.log('✓ No systematic multipliers detected at transaction level');
  }
  console.log();

  // Step 9: Summary and Recommendations
  console.log('='.repeat(80));
  console.log('ANALYSIS SUMMARY');
  console.log('='.repeat(80));
  console.log();
  console.log('KEY FINDINGS:');
  console.log(`  1. Database P&L: $${actualPnL.toFixed(2)}`);
  console.log(`  2. Expected P&L: $${expectedPnL.toFixed(2)}`);
  console.log(`  3. Inflation Factor: ${inflationFactor.toFixed(2)}x`);
  console.log(`  4. Corrected P&L (÷3.6): $${correctedPnL.toFixed(2)} (${errorPercent.toFixed(2)}% error)`);
  console.log();

  if (dupes.length > 0) {
    console.log('ROOT CAUSE HYPOTHESIS:');
    console.log('  → Duplicate transaction counting detected');
    console.log(`  → ${dupes.length} transactions counted multiple times`);
  } else if (multipliers.length > 0) {
    console.log('ROOT CAUSE HYPOTHESIS:');
    console.log('  → Systematic multiplier in position counting');
    console.log(`  → ${multipliers.length} markets affected`);
  } else {
    console.log('ROOT CAUSE HYPOTHESIS:');
    console.log('  → Inflation factor is consistent at ~3.6x');
    console.log('  → Likely source: summing absolute values or joining fanout');
  }
  console.log();
  console.log('NEXT STEPS:');
  console.log('  1. Check polymarket_wallet_pnl table creation logic');
  console.log('  2. Verify join conditions in P&L aggregation');
  console.log('  3. Check if outcomes are being summed without netting');
  console.log('  4. Review settlement calculation for multiplier logic');
  console.log('='.repeat(80));
}

forensicAnalysis().catch(console.error);
