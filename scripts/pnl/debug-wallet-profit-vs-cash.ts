#!/usr/bin/env npx tsx
/**
 * Debug Wallet Profit vs Net-Cash
 *
 * Compares:
 * A) UI tooltip values (via Playwright or manual)
 * B) Our current "net-cash" formula: sell + redemption - buy
 * C) Profit-based realized PnL using avg-cost inventory
 *
 * The hypothesis: UI matches profit-based, not net-cash.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import { CostBasisEngine, LedgerEvent } from '../../lib/pnl/costBasisEngine';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

interface WalletDebugResult {
  wallet: string;
  // Net-cash components
  total_buy_usdc: number;
  total_sell_usdc: number;
  redemption_payout_usdc: number;
  net_cash: number;
  // Profit-based components
  realized_profit_from_sells: number;
  realized_profit_from_redemptions: number;
  realized_profit_total: number;
  // Position info
  open_positions: number;
  closed_positions: number;
  events_processed: number;
}

async function getWalletTrades(wallet: string): Promise<LedgerEvent[]> {
  const walletLower = wallet.toLowerCase();

  // Get CLOB trades
  const tradesQ = await clickhouse.query({
    query: `
      SELECT
        '${walletLower}' as wallet_address,
        m.condition_id as canonical_condition_id,
        m.outcome_index as outcome_index,
        'CLOB' as source_type,
        t.trade_time as event_time,
        t.event_id,
        CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END / 1e6 as usdc_delta,
        CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END / 1e6 as token_delta,
        NULL as payout_norm
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount,
               any(token_amount) as token_amount, any(trade_time) as trade_time,
               any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${walletLower}'
        GROUP BY event_id
      ) t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      ORDER BY t.trade_time ASC
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQ.json() as any[];

  // Get redemptions
  const redemptionsQ = await clickhouse.query({
    query: `
      SELECT
        lower(wallet) as wallet_address,
        condition_id as canonical_condition_id,
        0 as outcome_index,  -- We'll figure out the winning outcome from payout
        'PayoutRedemption' as source_type,
        last_redemption as event_time,
        concat(wallet, '_', condition_id, '_redemption') as event_id,
        redemption_payout as usdc_delta,
        -redemption_payout as token_delta,  -- tokens redeemed = tokens lost
        1.0 as payout_norm  -- winning outcome
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const redemptions = await redemptionsQ.json() as any[];

  // Combine and sort by time
  const allEvents: LedgerEvent[] = [
    ...trades.map((t: any) => ({
      wallet_address: t.wallet_address,
      canonical_condition_id: t.canonical_condition_id,
      outcome_index: Number(t.outcome_index),
      source_type: t.source_type as 'CLOB',
      event_time: new Date(t.event_time),
      event_id: t.event_id,
      usdc_delta: Number(t.usdc_delta),
      token_delta: Number(t.token_delta),
      payout_norm: null,
    })),
    ...redemptions.map((r: any) => ({
      wallet_address: r.wallet_address,
      canonical_condition_id: r.canonical_condition_id,
      outcome_index: 0,  // Will be determined by the position that was held
      source_type: 'PayoutRedemption' as const,
      event_time: new Date(r.event_time),
      event_id: r.event_id,
      usdc_delta: Number(r.usdc_delta),
      token_delta: Number(r.token_delta),
      payout_norm: 1.0,
    })),
  ].sort((a, b) => a.event_time.getTime() - b.event_time.getTime());

  return allEvents;
}

async function debugWallet(wallet: string): Promise<WalletDebugResult> {
  // Get net-cash components directly from aggregates
  const cashQ = await clickhouse.query({
    query: `
      SELECT
        sumIf(usdc_amount, side = 'buy') / 1e6 as total_buy,
        sumIf(usdc_amount, side = 'sell') / 1e6 as total_sell
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });
  const cash = (await cashQ.json() as any[])[0];
  const total_buy_usdc = Number(cash.total_buy) || 0;
  const total_sell_usdc = Number(cash.total_sell) || 0;

  // Get redemption
  const redemptionQ = await clickhouse.query({
    query: `
      SELECT sum(redemption_payout) as total_redemption
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const redemption = (await redemptionQ.json() as any[])[0];
  const redemption_payout_usdc = Number(redemption.total_redemption) || 0;

  // Net-cash formula (what we currently use)
  const net_cash = total_sell_usdc - total_buy_usdc + redemption_payout_usdc;

  // Now compute profit-based PnL using the CostBasisEngine
  const events = await getWalletTrades(wallet);
  const engine = new CostBasisEngine();
  engine.processEvents(events);
  const result = engine.getWalletResult(wallet);

  // Get per-position breakdown to separate sell vs redemption profit
  const positions = engine.getPositionDetails(wallet);
  
  // For now, we'll use the total realized PnL
  // A more detailed breakdown would require tracking sell vs redemption separately in the engine

  return {
    wallet,
    total_buy_usdc,
    total_sell_usdc,
    redemption_payout_usdc,
    net_cash,
    realized_profit_from_sells: 0,  // Would need engine modification to track separately
    realized_profit_from_redemptions: 0,  // Would need engine modification to track separately
    realized_profit_total: result.totalRealizedPnl,
    open_positions: result.openPositions,
    closed_positions: result.closedPositions,
    events_processed: result.eventsProcessed,
  };
}

async function main() {
  const wallets = [
    '0x132b505596fadb6971bbb0fbded509421baf3a16',  // Wallet 2 - smoking gun
    '0x0030490676215689d0764b54c135d47f2c310513',  // Wallet 5
    '0x3d6d9dcc4f40d6447bb650614acc385ff3820dd1',  // Wallet 1
  ];

  console.log('DEBUG: PROFIT vs NET-CASH');
  console.log('='.repeat(100));
  console.log('');
  console.log('Hypothesis: UI "Net total" = profit-based realized (not net-cash)');
  console.log('');

  for (const wallet of wallets) {
    console.log('='.repeat(100));
    console.log(`WALLET: ${wallet}`);
    console.log('-'.repeat(100));

    const result = await debugWallet(wallet);

    console.log('\nA) NET-CASH COMPONENTS (our current formula):');
    console.log(`   total_buy_usdc:        $${result.total_buy_usdc.toFixed(2)}`);
    console.log(`   total_sell_usdc:       $${result.total_sell_usdc.toFixed(2)}`);
    console.log(`   redemption_payout:     $${result.redemption_payout_usdc.toFixed(2)}`);
    console.log(`   -------------------------------------------------`);
    console.log(`   NET-CASH (sell - buy + redemption): $${result.net_cash.toFixed(2)}`);

    console.log('\nB) PROFIT-BASED (via CostBasisEngine):');
    console.log(`   realized_profit_total: $${result.realized_profit_total.toFixed(2)}`);
    console.log(`   events_processed:      ${result.events_processed}`);
    console.log(`   open_positions:        ${result.open_positions}`);
    console.log(`   closed_positions:      ${result.closed_positions}`);

    console.log('\nC) COMPARISON:');
    const diff = Math.abs(result.net_cash - result.realized_profit_total);
    console.log(`   NET-CASH:              $${result.net_cash.toFixed(2)}`);
    console.log(`   PROFIT-BASED:          $${result.realized_profit_total.toFixed(2)}`);
    console.log(`   DIFFERENCE:            $${diff.toFixed(2)}`);
    
    // Check if difference equals sell_usdc (the smoking gun)
    const sellDiff = Math.abs(diff - result.total_sell_usdc);
    if (sellDiff < 1) {
      console.log(`   >>> SMOKING GUN: Difference ≈ total_sell_usdc ($${result.total_sell_usdc.toFixed(2)})`);
    }

    console.log('');
  }

  console.log('='.repeat(100));
  console.log('NEXT STEP: Compare profit-based values against UI tooltip');
  console.log('Use Playwright to scrape UI "Net total" for these wallets');
  console.log('='.repeat(100));

  await clickhouse.close();
}

main().catch(console.error);
