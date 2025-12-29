/**
 * Deep Dive into a specific wallet's PnL calculation
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const WALLET = process.argv[2] || '0x418db17eaa8f25eaf2085657d0becd82462c6786';

async function deepDive() {
  console.log('='.repeat(100));
  console.log('DEEP DIVE: Wallet', WALLET);
  console.log('='.repeat(100));

  // 1. Run V17 engine and get detailed output
  console.log('\n--- V17 Engine Output ---');
  const engine = createV17Engine();
  const result = await engine.compute(WALLET);

  console.log('V17 Summary:');
  console.log('  Realized PnL:', result.realized_pnl.toFixed(2));
  console.log('  Unrealized PnL:', result.unrealized_pnl.toFixed(2));
  console.log('  Total PnL:', (result.realized_pnl + result.unrealized_pnl).toFixed(2));
  console.log('  Positions:', result.positions_count);

  // 2. Check raw trades for this wallet
  console.log('\n--- Raw Trade Data ---');
  const tradesQ = `
    SELECT
      count() as total_trades,
      countDistinct(condition_id) as unique_markets,
      sum(usdc_amount)/1e6 as total_usdc_volume,
      min(trade_time) as first_trade,
      max(trade_time) as last_trade
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json())[0] as any;
  console.log('Trade stats:', trades);

  // 3. Get top markets by volume with position summary
  console.log('\n--- Top Markets by Volume ---');
  const mktsQ = `
    SELECT
      condition_id,
      count() as trades,
      sum(usdc_amount)/1e6 as usdc_vol,
      sum(if(side='BUY', usdc_amount, 0))/1e6 as buy_usdc,
      sum(if(side='SELL', usdc_amount, 0))/1e6 as sell_usdc,
      sum(if(side='BUY', token_amount, 0))/1e6 as buy_tokens,
      sum(if(side='SELL', token_amount, 0))/1e6 as sell_tokens
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
    GROUP BY condition_id
    ORDER BY usdc_vol DESC
    LIMIT 15
  `;
  const mktsR = await clickhouse.query({ query: mktsQ, format: 'JSONEachRow' });
  const mkts = (await mktsR.json()) as any[];

  console.log('condition_id (16 chars) | trades | buy_usdc | sell_usdc | net_tokens | cash_flow');
  console.log('-'.repeat(90));
  for (const m of mkts) {
    const netTokens = m.buy_tokens - m.sell_tokens;
    const cashFlow = m.sell_usdc - m.buy_usdc;
    console.log(
      `${m.condition_id.substring(0, 16)}... | ${String(m.trades).padStart(3)} | $${m.buy_usdc.toFixed(2).padStart(8)} | $${m.sell_usdc.toFixed(2).padStart(8)} | ${netTokens.toFixed(2).padStart(8)} | $${cashFlow.toFixed(2).padStart(8)}`
    );
  }

  // 4. Check resolution status for these markets
  console.log('\n--- Resolution Status for Top Markets ---');
  const conditionIds = mkts.map((m) => "'" + m.condition_id + "'").join(',');
  const resQ = `
    SELECT
      condition_id,
      payout_numerators,
      resolution_time
    FROM pm_market_resolutions_v1
    WHERE condition_id IN (${conditionIds})
  `;

  try {
    const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
    const resolutions = (await resR.json()) as any[];
    console.log(`Found ${resolutions.length} resolutions out of ${mkts.length} markets`);

    const resolutionMap = new Map<string, any>();
    for (const r of resolutions) {
      resolutionMap.set(r.condition_id, r);
    }

    // Calculate expected PnL for each market
    console.log('\n--- Expected PnL per Market ---');
    console.log('condition_id | status | net_tokens | cash_flow | payout | realized_pnl');
    console.log('-'.repeat(90));

    let totalRealizedCheck = 0;
    let totalUnrealizedCheck = 0;

    for (const m of mkts) {
      const res = resolutionMap.get(m.condition_id);
      const netTokens = m.buy_tokens - m.sell_tokens;
      const cashFlow = m.sell_usdc - m.buy_usdc;

      if (res) {
        // Resolved - calculate realized PnL
        // Assuming outcome_index 0 for simplicity (need to check actual outcome)
        const payout = res.payout_numerators[0] || 0;
        const realizedPnl = cashFlow + netTokens * payout;
        totalRealizedCheck += realizedPnl;
        console.log(
          `${m.condition_id.substring(0, 12)}... | RESOLVED | ${netTokens.toFixed(2).padStart(8)} | $${cashFlow.toFixed(2).padStart(8)} | ${payout} | $${realizedPnl.toFixed(2).padStart(8)}`
        );
      } else {
        // Unresolved - calculate unrealized with 0.5 mark price
        const unrealizedPnl = cashFlow + netTokens * 0.5;
        totalUnrealizedCheck += unrealizedPnl;
        console.log(
          `${m.condition_id.substring(0, 12)}... | OPEN     | ${netTokens.toFixed(2).padStart(8)} | $${cashFlow.toFixed(2).padStart(8)} | 0.5 | $${unrealizedPnl.toFixed(2).padStart(8)}`
        );
      }
    }

    console.log('-'.repeat(90));
    console.log(`Manual check - Realized: $${totalRealizedCheck.toFixed(2)} | Unrealized: $${totalUnrealizedCheck.toFixed(2)}`);
    console.log(`V17 says     - Realized: $${result.realized_pnl.toFixed(2)} | Unrealized: $${result.unrealized_pnl.toFixed(2)}`);
  } catch (e: any) {
    console.log('Resolution query error:', e.message);
  }
}

deepDive().catch(console.error);
