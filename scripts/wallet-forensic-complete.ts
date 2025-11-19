/**
 * Complete Forensic Analysis: Wallet 0x6770bf688b8121331b1c5cfd7723ebd4152545fb
 *
 * Investigation Goals:
 * 1. Find this wallet's P&L in our database
 * 2. Compare to Polymarket UI ($1,914)
 * 3. Identify source of discrepancy
 * 4. Understand why it's not in our JSON export
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

const WALLET = '0x6770bf688b8121331b1c5cfd7723ebd4152545fb';
const POLYMARKET_PNL = 1914;

async function completeForensicAnalysis() {
  console.log('='.repeat(80));
  console.log('COMPLETE FORENSIC ANALYSIS');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log(`Polymarket UI P&L: $${POLYMARKET_PNL.toFixed(2)}`);
  console.log('='.repeat(80));
  console.log();

  // 1. Check realized_pnl_by_market_final (the actual calculation table)
  console.log('1. REALIZED P&L BY MARKET (Source of Truth)');
  console.log('-'.repeat(80));
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          market_id,
          pnl_usd,
          shares_net,
          cost_basis_net,
          payout_received
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET}'
        ORDER BY ABS(pnl_usd) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow',
    });

    const markets = await result.json();
    console.log(`Found ${markets.length} markets for this wallet`);

    if (markets.length > 0) {
      console.log('\nTop markets by P&L magnitude:');
      markets.forEach((m: any, i: number) => {
        console.log(`  ${i + 1}. Market: ${m.market_id.substring(0, 16)}...`);
        console.log(`     P&L: $${parseFloat(m.pnl_usd).toFixed(2)}`);
        console.log(`     Shares: ${parseFloat(m.shares_net).toFixed(2)}`);
        console.log(`     Cost: $${parseFloat(m.cost_basis_net).toFixed(2)}`);
        console.log(`     Payout: $${parseFloat(m.payout_received).toFixed(2)}`);
        console.log();
      });

      // Calculate total
      const totalResult = await clickhouse.query({
        query: `
          SELECT
            SUM(pnl_usd) as total_pnl,
            SUM(pnl_usd_abs) as total_pnl_abs,
            COUNT(*) as market_count,
            SUM(CASE WHEN pnl_usd > 0 THEN pnl_usd ELSE 0 END) as total_gains,
            SUM(CASE WHEN pnl_usd < 0 THEN pnl_usd ELSE 0 END) as total_losses
          FROM realized_pnl_by_market_final
          WHERE wallet = '${WALLET}'
        `,
        format: 'JSONEachRow',
      });

      const totals = await totalResult.json();
      const total = totals[0];
      console.log('AGGREGATE TOTALS:');
      console.log(`  Total P&L: $${parseFloat(total.total_pnl).toFixed(2)}`);
      console.log(`  Total P&L (abs): $${parseFloat(total.total_pnl_abs).toFixed(2)}`);
      console.log(`  Markets: ${total.market_count}`);
      console.log(`  Gains: $${parseFloat(total.total_gains).toFixed(2)}`);
      console.log(`  Losses: $${parseFloat(total.total_losses).toFixed(2)}`);
      console.log();

      const dbPnL = parseFloat(total.total_pnl);
      const inflationFactor = dbPnL / POLYMARKET_PNL;
      console.log('COMPARISON:');
      console.log(`  Polymarket UI: $${POLYMARKET_PNL.toFixed(2)}`);
      console.log(`  Our Database: $${dbPnL.toFixed(2)}`);
      console.log(`  Difference: $${(dbPnL - POLYMARKET_PNL).toFixed(2)}`);
      console.log(`  Inflation Factor: ${inflationFactor.toFixed(2)}x`);
      console.log();

      // Check if using absolute values is the issue
      const absInflation = parseFloat(total.total_pnl_abs) / POLYMARKET_PNL;
      console.log('ABSOLUTE VALUE TEST:');
      console.log(`  If summing ABS values: $${parseFloat(total.total_pnl_abs).toFixed(2)}`);
      console.log(`  Inflation from ABS: ${absInflation.toFixed(2)}x`);
      console.log();
    } else {
      console.log('⚠️  No data found in realized_pnl_by_market_final');
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  console.log();

  // 2. Check wallet_pnl_summary_final
  console.log('2. WALLET P&L SUMMARY FINAL');
  console.log('-'.repeat(80));
  try {
    const result = await clickhouse.query({
      query: `
        SELECT *
        FROM wallet_pnl_summary_final
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow',
    });

    const summary = await result.json();
    if (summary.length > 0) {
      console.log('Summary data:', JSON.stringify(summary[0], null, 2));
    } else {
      console.log('⚠️  No data found in wallet_pnl_summary_final');
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  console.log();

  // 3. Check wallet_metrics
  console.log('3. WALLET METRICS');
  console.log('-'.repeat(80));
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          wallet,
          total_pnl_usd,
          realized_pnl_usd,
          unrealized_pnl_usd,
          total_markets_traded,
          win_rate,
          timestamp
        FROM wallet_metrics
        WHERE wallet = '${WALLET}'
        ORDER BY timestamp DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });

    const metrics = await result.json();
    if (metrics.length > 0) {
      console.log('Latest metrics:', JSON.stringify(metrics[0], null, 2));
    } else {
      console.log('⚠️  No data found in wallet_metrics');
    }
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  console.log();

  // 4. Check if wallet is in outcome_positions_v2
  console.log('4. OUTCOME POSITIONS V2 (Trade Count)');
  console.log('-'.repeat(80));
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as position_count,
          COUNT(DISTINCT condition_id) as unique_conditions,
          COUNT(DISTINCT market_id) as unique_markets,
          SUM(shares_bought) as total_bought,
          SUM(shares_sold) as total_sold
        FROM outcome_positions_v2
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow',
    });

    const positions = await result.json();
    console.log('Position counts:', JSON.stringify(positions[0], null, 2));
  } catch (e: any) {
    console.log('Error:', e.message);
  }
  console.log();

  // 5. Root cause analysis
  console.log('='.repeat(80));
  console.log('ROOT CAUSE ANALYSIS');
  console.log('='.repeat(80));
  console.log();
  console.log('FINDINGS:');
  console.log('  1. This wallet is NOT in our JSON export (audited_wallet_pnl_extended.json)');
  console.log('  2. Need to check if wallet has sufficient coverage to be included');
  console.log('  3. Need to verify database P&L calculation is correct');
  console.log('  4. Need to understand discrepancy with Polymarket UI');
  console.log();
  console.log('HYPOTHESIS:');
  console.log('  A. Wallet may be below 2% coverage threshold for JSON export');
  console.log('  B. Database calculation may have join fanout or duplication');
  console.log('  C. Polymarket UI may use different settlement rules');
  console.log('  D. Timing differences (unrealized vs realized)');
  console.log();
  console.log('NEXT STEPS:');
  console.log('  1. Calculate coverage % for this wallet');
  console.log('  2. Verify no duplicate rows in realized_pnl_by_market_final');
  console.log('  3. Check for systematic inflation pattern');
  console.log('  4. Compare against Polymarket API (not just UI)');
  console.log('='.repeat(80));
}

completeForensicAnalysis().catch(console.error);
