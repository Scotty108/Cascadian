/**
 * Market-by-Market Breakdown Analysis
 * Wallet: 0x6770bf688b8121331b1c5cfd7723ebd4152545fb
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

const WALLET = '0x6770bf688b8121331b1c5cfd7723ebd4152545fb';
const POLYMARKET_PNL = 1914;

async function marketBreakdown() {
  console.log('='.repeat(80));
  console.log('MARKET-BY-MARKET P&L BREAKDOWN');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log(`Expected (Polymarket): $${POLYMARKET_PNL.toFixed(2)}`);
  console.log('='.repeat(80));
  console.log();

  // Get all markets for this wallet
  console.log('Per-Market P&L (sorted by magnitude):');
  console.log('-'.repeat(80));

  const markets = await clickhouse.query({
    query: `
      SELECT
        market_id,
        condition_id_norm,
        realized_pnl_usd,
        resolved_at
      FROM realized_pnl_by_market_final
      WHERE wallet = '${WALLET}'
      ORDER BY ABS(realized_pnl_usd) DESC
    `,
    format: 'JSONEachRow',
  });

  const marketData = await markets.json();

  console.log(`Found ${marketData.length} markets\n`);

  let totalPnL = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let positivePnL = 0;
  let negativePnL = 0;

  marketData.forEach((m: any, i: number) => {
    const pnl = parseFloat(m.realized_pnl_usd);
    totalPnL += pnl;

    if (pnl > 0) {
      positiveCount++;
      positivePnL += pnl;
    } else if (pnl < 0) {
      negativeCount++;
      negativePnL += pnl;
    }

    if (i < 20) {  // Show top 20
      console.log(`${i + 1}. Market: ${m.market_id.substring(0, 16)}...`);
      console.log(`   Condition: ${m.condition_id_norm.substring(0, 16)}...`);
      console.log(`   P&L: $${pnl.toFixed(2)}`);
      console.log(`   Resolved: ${m.resolved_at || 'Not resolved'}`);
      console.log();
    }
  });

  console.log('='.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(80));
  console.log(`Total Markets: ${marketData.length}`);
  console.log(`Winning Markets: ${positiveCount} ($${positivePnL.toFixed(2)})`);
  console.log(`Losing Markets: ${negativeCount} ($${negativePnL.toFixed(2)})`);
  console.log(`Net P&L: $${totalPnL.toFixed(2)}`);
  console.log();

  console.log('DISCREPANCY ANALYSIS');
  console.log('-'.repeat(80));
  const difference = totalPnL - POLYMARKET_PNL;
  const percentError = (Math.abs(difference) / Math.abs(POLYMARKET_PNL)) * 100;

  console.log(`Polymarket UI: $${POLYMARKET_PNL.toFixed(2)}`);
  console.log(`Our Database: $${totalPnL.toFixed(2)}`);
  console.log(`Difference: $${difference.toFixed(2)}`);
  console.log(`Percent Error: ${percentError.toFixed(1)}%`);
  console.log();

  if (Math.sign(totalPnL) !== Math.sign(POLYMARKET_PNL)) {
    console.log('🔴 CRITICAL: SIGN MISMATCH DETECTED!');
    console.log('   Polymarket shows:', POLYMARKET_PNL > 0 ? 'PROFIT' : 'LOSS');
    console.log('   We show:', totalPnL > 0 ? 'PROFIT' : 'LOSS');
    console.log();
  }

  // Check for patterns
  console.log('PATTERN ANALYSIS');
  console.log('-'.repeat(80));

  if (positivePnL > 0 && negativePnL < 0) {
    console.log(`Gross Gains: $${positivePnL.toFixed(2)}`);
    console.log(`Gross Losses: $${Math.abs(negativePnL).toFixed(2)}`);
    console.log(`Net: $${(positivePnL + negativePnL).toFixed(2)}`);
    console.log();

    // Test if we're summing absolutes
    const absSum = positivePnL + Math.abs(negativePnL);
    console.log(`If summing |gains| + |losses|: $${absSum.toFixed(2)}`);

    if (Math.abs(absSum - Math.abs(POLYMARKET_PNL)) < 100) {
      console.log('🔍 HYPOTHESIS: May be summing absolute values!');
    }
    console.log();
  }

  // Check win rate
  const winRate = positiveCount / (positiveCount + negativeCount);
  console.log(`Win Rate: ${(winRate * 100).toFixed(1)}%`);
  console.log(`Average Win: $${(positivePnL / positiveCount).toFixed(2)}`);
  console.log(`Average Loss: $${(negativePnL / negativeCount).toFixed(2)}`);
  console.log();

  console.log('='.repeat(80));
  console.log('NEXT STEPS');
  console.log('='.repeat(80));
  console.log('1. Review settlement calculation SQL for sign errors');
  console.log('2. Check if cost_basis and payout are being subtracted correctly');
  console.log('3. Verify payout vector indexing (should be 1-indexed in ClickHouse)');
  console.log('4. Test with a single known market to verify formula');
  console.log('='.repeat(80));
}

marketBreakdown().catch(console.error);
