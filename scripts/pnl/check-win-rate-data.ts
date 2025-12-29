/**
 * Check Win Rate Data Availability
 *
 * Assess what data we have to calculate win rate and Omega ratio.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const W2_WALLET = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('WIN RATE & OMEGA RATIO DATA ASSESSMENT');
  console.log('═'.repeat(80));
  console.log('');

  // 1. Check market-level attribution
  console.log('1. MARKET-LEVEL ATTRIBUTION (W2)');
  console.log('─'.repeat(80));

  const marketQuery = await clickhouse.query({
    query: `
      SELECT
        t.condition_id,
        t.outcome_index,
        count() as trade_count,
        sum(t.usdc_amount) / 1e6 as total_usdc,
        any(r.resolution_price) as resolution_price,
        any(r.winning_outcome) as winning_outcome
      FROM (
        SELECT
          event_id,
          any(condition_id) as condition_id,
          any(outcome_index) as outcome_index,
          any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String}
          AND is_deleted = 0
        GROUP BY event_id
      ) t
      LEFT JOIN pm_market_resolution_prices r
        ON t.condition_id = r.condition_id
        AND t.outcome_index = r.outcome_index
      GROUP BY t.condition_id, t.outcome_index
      ORDER BY total_usdc DESC
      LIMIT 10
    `,
    query_params: { wallet: W2_WALLET },
    format: 'JSONEachRow',
  });

  const markets = (await marketQuery.json()) as Array<{
    condition_id: string;
    outcome_index: number;
    trade_count: number;
    total_usdc: number;
    resolution_price: number | null;
    winning_outcome: string | null;
  }>;

  console.log('Top 10 markets by volume:');
  console.log('condition_id          | outcome | trades | volume   | res_price | winner');
  console.log('─'.repeat(80));

  for (const m of markets) {
    const condId = m.condition_id ? m.condition_id.substring(0, 20) : 'NULL';
    const resPrice = m.resolution_price !== null ? m.resolution_price.toFixed(2) : 'NULL';
    const winner = m.winning_outcome !== null ? m.winning_outcome : 'NULL';
    console.log(
      `${condId}... | ${String(m.outcome_index).padStart(7)} | ${String(m.trade_count).padStart(6)} | $${m.total_usdc.toFixed(0).padStart(7)} | ${resPrice.padStart(9)} | ${winner}`
    );
  }

  // 2. Count markets with/without resolution
  console.log('');
  console.log('2. RESOLUTION COVERAGE');
  console.log('─'.repeat(80));

  const coverageQuery = await clickhouse.query({
    query: `
      SELECT
        countDistinct(t.condition_id) as total_markets,
        countDistinct(if(r.condition_id IS NOT NULL, t.condition_id, NULL)) as resolved_markets
      FROM (
        SELECT event_id, any(condition_id) as condition_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      ) t
      LEFT JOIN pm_market_resolution_prices r ON t.condition_id = r.condition_id
    `,
    query_params: { wallet: W2_WALLET },
    format: 'JSONEachRow',
  });

  const coverage = (await coverageQuery.json()) as Array<{
    total_markets: number;
    resolved_markets: number;
  }>;

  console.log(`Total markets traded: ${coverage[0].total_markets}`);
  console.log(`Markets with resolution data: ${coverage[0].resolved_markets}`);
  console.log(`Coverage: ${((coverage[0].resolved_markets / coverage[0].total_markets) * 100).toFixed(1)}%`);

  // 3. Check pm_market_resolution_prices table
  console.log('');
  console.log('3. RESOLUTION TABLE STATS');
  console.log('─'.repeat(80));

  const resTableQuery = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        countDistinct(condition_id) as unique_conditions,
        min(resolution_time) as earliest,
        max(resolution_time) as latest
      FROM pm_market_resolution_prices
    `,
    format: 'JSONEachRow',
  });

  const resStats = (await resTableQuery.json()) as Array<{
    total_rows: number;
    unique_conditions: number;
    earliest: string;
    latest: string;
  }>;

  console.log(`Total resolution records: ${resStats[0].total_rows}`);
  console.log(`Unique conditions: ${resStats[0].unique_conditions}`);
  console.log(`Date range: ${resStats[0].earliest} to ${resStats[0].latest}`);

  // 4. Can we compute per-market PnL?
  console.log('');
  console.log('4. PER-MARKET PNL FEASIBILITY');
  console.log('─'.repeat(80));

  // Check if we can compute per-market returns
  const perMarketQuery = await clickhouse.query({
    query: `
      WITH wallet_trades AS (
        SELECT
          event_id,
          any(condition_id) as condition_id,
          any(outcome_index) as outcome_index,
          any(side) as side,
          any(usdc_amount) / 1e6 as usdc,
          any(token_amount) / 1e6 as tokens,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        t.condition_id,
        -- Buys: spent USDC
        sum(if(t.side = 'BUY', t.usdc, 0)) as total_bought_usdc,
        sum(if(t.side = 'BUY', t.tokens, 0)) as total_bought_tokens,
        -- Sells: received USDC
        sum(if(t.side = 'SELL', t.usdc, 0)) as total_sold_usdc,
        sum(if(t.side = 'SELL', t.tokens, 0)) as total_sold_tokens,
        -- Net position
        sum(if(t.side = 'BUY', t.tokens, 0)) - sum(if(t.side = 'SELL', t.tokens, 0)) as net_tokens,
        -- Resolution info
        any(r.resolution_price) as resolution_price,
        any(r.winning_outcome) as winning_outcome
      FROM wallet_trades t
      LEFT JOIN pm_market_resolution_prices r ON t.condition_id = r.condition_id
      GROUP BY t.condition_id
      ORDER BY total_bought_usdc DESC
      LIMIT 5
    `,
    query_params: { wallet: W2_WALLET },
    format: 'JSONEachRow',
  });

  const perMarket = (await perMarketQuery.json()) as Array<{
    condition_id: string;
    total_bought_usdc: number;
    total_bought_tokens: number;
    total_sold_usdc: number;
    total_sold_tokens: number;
    net_tokens: number;
    resolution_price: number | null;
    winning_outcome: string | null;
  }>;

  console.log('Per-market breakdown (top 5 by volume):');
  console.log('');

  for (const m of perMarket) {
    const condId = m.condition_id ? m.condition_id.substring(0, 16) : 'NULL';
    const resolved = m.resolution_price !== null;
    const resPrice = resolved ? m.resolution_price!.toFixed(2) : 'pending';

    // Calculate return if resolved and no open position
    let marketReturn = 'N/A';
    if (resolved && Math.abs(m.net_tokens) < 0.01) {
      const netCashflow = m.total_sold_usdc - m.total_bought_usdc;
      const roi = m.total_bought_usdc > 0 ? (netCashflow / m.total_bought_usdc * 100) : 0;
      marketReturn = `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`;
    } else if (Math.abs(m.net_tokens) > 0.01) {
      marketReturn = `${m.net_tokens.toFixed(0)} tokens open`;
    }

    console.log(`${condId}...`);
    console.log(`  Bought: $${m.total_bought_usdc.toFixed(2)} for ${m.total_bought_tokens.toFixed(0)} tokens`);
    console.log(`  Sold:   $${m.total_sold_usdc.toFixed(2)} for ${m.total_sold_tokens.toFixed(0)} tokens`);
    console.log(`  Status: ${resPrice} | Return: ${marketReturn}`);
    console.log('');
  }

  // Summary
  console.log('═'.repeat(80));
  console.log('ASSESSMENT SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Data available:');
  console.log('  [x] Complete trade history (pm_trader_events_v2)');
  console.log('  [x] Market resolution prices (pm_market_resolution_prices)');
  console.log('  [x] condition_id links trades to markets');
  console.log('');
  console.log('Can calculate:');
  console.log('  [x] Realized PnL (V11_POLY engine)');
  console.log('  [x] Volume');
  console.log('  [~] Per-market returns (need to handle open positions)');
  console.log('  [~] Win rate (need to define "win" for partial exits)');
  console.log('  [~] Omega ratio (need return distribution by market)');
  console.log('');
}

main().catch(console.error);
