#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('🔍 Searching for egg markets...\n');

  // Search for the eggs market
  const searchResult = await clickhouse.query({
    query: `
      SELECT DISTINCT
        t.market_id,
        t.condition_id,
        lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
        count() as trade_count,
        sum(toFloat64(t.shares)) as total_shares,
        groupArray(t.outcome_index) as outcomes
      FROM default.trades_raw t
      WHERE lower(t.wallet) = '${wallet}'
        AND (market_id LIKE '%egg%' OR market_id LIKE '%4.50%' OR market_id LIKE '%may%')
      GROUP BY t.market_id, t.condition_id
      ORDER BY trade_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const markets = await searchResult.json<Array<any>>();

  console.log(`Found ${markets.length} egg-related markets for this wallet:\n`);

  for (const market of markets) {
    console.log(`━━━ Market: ${market.market_id} ━━━`);
    console.log(`  Condition ID: ${market.condition_id_norm.substring(0, 16)}...`);
    console.log(`  Trades: ${market.trade_count}`);
    console.log(`  Total shares: ${parseFloat(market.total_shares).toFixed(2)}`);

    // Get detailed trades
    const tradesResult = await clickhouse.query({
      query: `
        SELECT
          trade_direction,
          outcome_index,
          toFloat64(shares) as shares,
          toFloat64(entry_price) as price,
          toFloat64(cashflow_usdc) as cashflow,
          block_time
        FROM default.trades_raw
        WHERE lower(wallet) = '${wallet}'
          AND lower(replaceAll(condition_id, '0x', '')) = '${market.condition_id_norm}'
        ORDER BY block_time
      `,
      format: 'JSONEachRow'
    });
    const trades = await tradesResult.json<Array<any>>();

    console.log(`\n  All trades:`);
    trades.forEach((t, i) => {
      console.log(`    ${i+1}. ${t.trade_direction} ${parseFloat(t.shares).toFixed(1)} @ ${parseFloat(t.price).toFixed(2)} (outcome ${t.outcome_index}) | Cashflow: $${parseFloat(t.cashflow).toFixed(2)} | ${t.block_time}`);
    });

    // Check for resolution
    const resResult = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          winning_index,
          winning_outcome
        FROM default.market_resolutions_final
        WHERE condition_id_norm = '${market.condition_id_norm}'
      `,
      format: 'JSONEachRow'
    });
    const resolution = await resResult.json<Array<any>>();

    if (resolution.length > 0) {
      const res = resolution[0];
      console.log(`\n  ✅ Resolution found:`);
      console.log(`    Winning outcome: ${res.winning_outcome} (index ${res.winning_index})`);
      console.log(`    Payout: ${res.payout_numerators} / ${res.payout_denominator}`);

      // Calculate P&L
      let netSharesOutcome0 = 0;
      let netSharesOutcome1 = 0;
      let totalCashflow = 0;

      trades.forEach(t => {
        const shares = parseFloat(t.shares);
        const cashflow = parseFloat(t.cashflow);

        if (t.outcome_index === 0) {
          netSharesOutcome0 += (t.trade_direction === 'BUY' ? shares : -shares);
        } else if (t.outcome_index === 1) {
          netSharesOutcome1 += (t.trade_direction === 'BUY' ? shares : -shares);
        }
        totalCashflow += cashflow;
      });

      console.log(`\n  Position:`);
      console.log(`    Net shares outcome 0: ${netSharesOutcome0.toFixed(2)}`);
      console.log(`    Net shares outcome 1: ${netSharesOutcome1.toFixed(2)}`);
      console.log(`    Total cashflow: $${totalCashflow.toFixed(2)}`);

      const payouts = res.payout_numerators.split(',').map((n: string) => parseInt(n));
      const denom = parseInt(res.payout_denominator);
      const winningIndex = parseInt(res.winning_index);

      const payout0 = netSharesOutcome0 * (payouts[0] / denom);
      const payout1 = netSharesOutcome1 * (payouts[1] / denom);
      const totalPayout = payout0 + payout1;
      const pnl = totalPayout + totalCashflow;

      console.log(`\n  P&L Calculation:`);
      console.log(`    Payout outcome 0: $${payout0.toFixed(2)}`);
      console.log(`    Payout outcome 1: $${payout1.toFixed(2)}`);
      console.log(`    Total payout: $${totalPayout.toFixed(2)}`);
      console.log(`    Total cashflow: $${totalCashflow.toFixed(2)}`);
      console.log(`    Net P&L: $${pnl.toFixed(2)}`);
    } else {
      console.log(`\n  ❌ No resolution found`);
    }

    console.log('\n');
  }

  // Also check if there are any trades at all for this wallet
  console.log('\n━━━ Overall Wallet Stats ━━━');
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        uniqExact(market_id) as unique_market_ids,
        uniqExact(lower(replaceAll(condition_id, '0x', ''))) as unique_condition_ids
      FROM default.trades_raw
      WHERE lower(wallet) = '${wallet}'
    `,
    format: 'JSONEachRow'
  });
  const stats = await statsResult.json<Array<any>>();
  console.log(`Total trades: ${stats[0].total_trades}`);
  console.log(`Unique market IDs: ${stats[0].unique_market_ids}`);
  console.log(`Unique condition IDs: ${stats[0].unique_condition_ids}`);
}

main().catch(console.error);
