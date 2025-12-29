/**
 * Find a suitable calibration wallet from the copy trading cohort
 *
 * Criteria:
 * 1. In pm_copytrade_candidates_v4 (token-balanced)
 * 2. Has significant trading activity
 * 3. Has some resolved positions (for validation)
 * 4. Good mapping coverage
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('=== FINDING CALIBRATION WALLET ===\n');

  // Get top candidates from cohort with good activity
  const q1 = `
    SELECT
      wallet,
      total_pnl,
      total_cost,
      total_trades,
      hit_rate,
      profit_factor,
      tokens_bought,
      tokens_sold,
      token_imbalance
    FROM pm_copytrade_candidates_v4
    WHERE total_trades >= 50
      AND total_cost >= 1000
      AND abs(total_pnl) >= 100
    ORDER BY total_trades DESC
    LIMIT 20
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const candidates = (await r1.json()) as any[];

  console.log(`Found ${candidates.length} candidates with good activity\n`);

  // For each candidate, check mapping coverage and redemptions
  const results = [];

  for (const c of candidates.slice(0, 10)) {
    const wallet = c.wallet;

    // Check mapping coverage
    const q2 = `
      WITH tokens AS (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}'
          AND is_deleted = 0
      )
      SELECT
        count() as total,
        countIf(m.token_id_dec != '') as mapped
      FROM tokens t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    `;
    const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
    const coverage = (await r2.json())[0] as { total: number; mapped: number };
    const coveragePct = coverage.total > 0 ? (coverage.mapped / coverage.total) * 100 : 0;

    // Check redemptions
    const q3 = `
      SELECT
        count() as redemption_count,
        sum(toFloat64(amount_or_payout)) / 1e6 as redemption_total
      FROM pm_ctf_events
      WHERE user_address = '${wallet}'
        AND event_type = 'PayoutRedemption'
    `;
    const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
    const redemptions = (await r3.json())[0] as { redemption_count: number; redemption_total: string };

    results.push({
      wallet,
      pnl: parseFloat(c.total_pnl).toFixed(2),
      volume: parseFloat(c.total_cost).toFixed(2),
      trades: c.total_trades,
      hitRate: (parseFloat(c.hit_rate) * 100).toFixed(1) + '%',
      tokenImbalance: parseFloat(c.token_imbalance).toFixed(2),
      mappingCoverage: coveragePct.toFixed(1) + '%',
      redemptions: parseFloat(redemptions.redemption_total || '0').toFixed(2),
      redemptionCount: redemptions.redemption_count,
    });
  }

  console.log('Top 10 Candidates:\n');
  console.log('| Wallet | P&L | Volume | Trades | Hit Rate | Token Imbal | Map Coverage | Redemptions |');
  console.log('|--------|-----|--------|--------|----------|-------------|--------------|-------------|');

  for (const r of results) {
    console.log(`| ${r.wallet.slice(0, 10)}... | $${r.pnl} | $${r.volume} | ${r.trades} | ${r.hitRate} | ${r.tokenImbalance} | ${r.mappingCoverage} | $${r.redemptions} (${r.redemptionCount}) |`);
  }

  // Find the best candidate: high mapping coverage, has redemptions, moderate P&L
  const best = results.find(r =>
    parseFloat(r.mappingCoverage) >= 90 &&
    r.redemptionCount > 0
  ) || results[0];

  console.log('\n=== RECOMMENDED CALIBRATION WALLET ===\n');
  console.log(`Wallet: ${best.wallet}`);
  console.log(`P&L: $${best.pnl}`);
  console.log(`Volume: $${best.volume}`);
  console.log(`Trades: ${best.trades}`);
  console.log(`Hit Rate: ${best.hitRate}`);
  console.log(`Token Imbalance: ${best.tokenImbalance}`);
  console.log(`Mapping Coverage: ${best.mappingCoverage}`);
  console.log(`Redemptions: $${best.redemptions} (${best.redemptionCount} events)`);

  // Get detailed stats for the best candidate
  console.log('\n=== DETAILED STATS ===\n');

  const q4 = `
    SELECT
      sum(if(side = 'buy', usdc_amount, 0)) / 1e6 as buys,
      sum(if(side = 'sell', usdc_amount, 0)) / 1e6 as sells,
      sum(if(side = 'buy', token_amount, 0)) / 1e6 as tokens_bought,
      sum(if(side = 'sell', token_amount, 0)) / 1e6 as tokens_sold,
      min(trade_time) as first_trade,
      max(trade_time) as last_trade
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${best.wallet}'
      AND is_deleted = 0
  `;
  const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
  const stats = (await r4.json())[0] as any;

  const buys = parseFloat(stats.buys);
  const sells = parseFloat(stats.sells);
  const tokensBought = parseFloat(stats.tokens_bought);
  const tokensSold = parseFloat(stats.tokens_sold);
  const redemptionTotal = parseFloat(best.redemptions);

  console.log(`CLOB Buys: $${buys.toFixed(2)}`);
  console.log(`CLOB Sells: $${sells.toFixed(2)}`);
  console.log(`Tokens Bought: ${tokensBought.toFixed(2)}`);
  console.log(`Tokens Sold: ${tokensSold.toFixed(2)}`);
  console.log(`Token Deficit: ${(tokensSold - tokensBought).toFixed(2)}`);
  console.log(`First Trade: ${stats.first_trade}`);
  console.log(`Last Trade: ${stats.last_trade}`);

  // Calculate P&L
  const tokenDeficit = Math.max(0, tokensSold - tokensBought);
  const calculatedPnL = sells - buys + redemptionTotal - tokenDeficit;

  console.log('\n=== P&L CALCULATION ===');
  console.log(`Formula: Sells - Buys + Redemptions - TokenDeficit`);
  console.log(`         ${sells.toFixed(2)} - ${buys.toFixed(2)} + ${redemptionTotal.toFixed(2)} - ${tokenDeficit.toFixed(2)}`);
  console.log(`Calculated P&L: $${calculatedPnL.toFixed(2)}`);
  console.log(`Cohort P&L: $${best.pnl}`);
  console.log(`Match: ${Math.abs(calculatedPnL - parseFloat(best.pnl)) < 1 ? '✅' : '❌'}`);

  console.log('\n=== POLYMARKET UI URL ===');
  console.log(`https://polymarket.com/profile/${best.wallet}`);

  console.log('\n=== DONE ===');
  process.exit(0);
}

main().catch(console.error);
