/**
 * Trade Metrics V2 Tests
 *
 * Tests for the fixed PnL calculation that properly handles partial sells before resolution.
 *
 * Run: npx vitest run lib/wallet-intelligence/tradeMetricsV2.test.ts
 */

import { describe, it, expect } from 'vitest';
import { computeTradeMetrics, aggregateWalletMetrics, RawTrade } from './tradeMetricsV2';

const mockPriceLookup = {
  getMidYesAt: () => 0.7,
};

describe('Trade Metrics V2 - Fixed PnL Calculation', () => {
  it('BUY trade held to resolution - full position', () => {
    const trades: RawTrade[] = [{
      trade_id: 't1',
      ts: new Date('2024-01-01'),
      wallet: '0xabc',
      condition_id: 'market1',
      token_id: 'token1',
      outcome_index: 0,
      side: 'YES',
      action: 'BUY',
      price_yes: 0.5,
      qty: 100,
      notional_usd: 50,
      fee_usd: 0,
    }];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 1 as const }]
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    expect(results).toHaveLength(1);
    expect(results[0].qty_remaining).toBe(100); // All shares held
    expect(results[0].realized_pnl_usd).toBe(50); // 100 - 50
    expect(results[0].realized_roi).toBe(1.0);
  });

  it('BUY then SELL all before resolution - no resolution PnL', () => {
    const trades: RawTrade[] = [
      {
        trade_id: 't1',
        ts: new Date('2024-01-01'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5,
        qty: 100,
        notional_usd: 50,
        fee_usd: 0,
      },
      {
        trade_id: 't2',
        ts: new Date('2024-01-02'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'SELL',
        price_yes: 0.7,
        qty: 100, // Sell all
        notional_usd: 70,
        fee_usd: 0,
      },
    ];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 1 as const }]
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    expect(results).toHaveLength(2);

    // BUY trade: no remaining shares, so no resolution PnL
    const buyTrade = results[0];
    expect(buyTrade.action).toBe('BUY');
    expect(buyTrade.qty_remaining).toBe(0);
    expect(buyTrade.realized_pnl_usd).toBe(0); // No resolution PnL since all sold
    expect(buyTrade.is_resolved).toBe(true);

    // SELL trade: normal FIFO PnL
    const sellTrade = results[1];
    expect(sellTrade.action).toBe('SELL');
    expect(sellTrade.realized_pnl_usd).toBe(20); // 70 - 50
  });

  it('CRITICAL: Partial sell before resolution - no double counting', () => {
    // This is the bug that was being tested:
    // BUY 100 @ $0.50, SELL 60 @ $0.70, hold 40 to YES resolution
    const trades: RawTrade[] = [
      {
        trade_id: 't1',
        ts: new Date('2024-01-01'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5,
        qty: 100,
        notional_usd: 50, // $0.50/share
        fee_usd: 0,
      },
      {
        trade_id: 't2',
        ts: new Date('2024-01-02'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'SELL',
        price_yes: 0.7,
        qty: 60, // Sell 60, keep 40
        notional_usd: 42, // 60 * 0.70
        fee_usd: 0,
      },
    ];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 1 as const }]
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    expect(results).toHaveLength(2);

    // SELL trade PnL: 60 sold @ $0.70, cost $0.50/share
    // PnL = 42 - 30 = $12
    const sellTrade = results.find(t => t.action === 'SELL')!;
    expect(sellTrade.realized_pnl_usd).toBe(12);

    // BUY trade: only 40 remaining shares
    const buyTrade = results.find(t => t.action === 'BUY')!;
    expect(buyTrade.qty_remaining).toBe(40);
    // Resolution PnL on 40 shares: 40 × $1.00 - 40 × $0.50 = $20
    expect(buyTrade.realized_pnl_usd).toBe(20);

    // TOTAL PnL = $12 (sell) + $20 (resolution) = $32
    const totalPnl = results.reduce((sum, t) => sum + (t.realized_pnl_usd || 0), 0);
    expect(totalPnl).toBe(32);

    // Verification: Manual calculation
    // Started with $50, ended with:
    // - $42 from selling 60 shares
    // - $40 from 40 winning shares
    // Total: $82 - $50 original cost = $32 profit
  });

  it('Multiple buys, partial sells, resolution - complex scenario', () => {
    const trades: RawTrade[] = [
      {
        trade_id: 't1',
        ts: new Date('2024-01-01'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.3,
        qty: 50,
        notional_usd: 15, // $0.30/share
        fee_usd: 0,
      },
      {
        trade_id: 't2',
        ts: new Date('2024-01-02'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5,
        qty: 50,
        notional_usd: 25, // $0.50/share
        fee_usd: 0,
      },
      {
        trade_id: 't3',
        ts: new Date('2024-01-03'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'SELL',
        price_yes: 0.7,
        qty: 75, // Sell 75: all 50 from t1 + 25 from t2 (FIFO)
        notional_usd: 52.5,
        fee_usd: 0,
      },
    ];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 1 as const }]
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    expect(results).toHaveLength(3);

    // SELL trade: FIFO cost = 50 * 0.30 + 25 * 0.50 = 15 + 12.5 = 27.5
    // PnL = 52.5 - 27.5 = 25
    const sellTrade = results.find(t => t.action === 'SELL')!;
    expect(sellTrade.cost_basis_usd).toBe(27.5);
    expect(sellTrade.realized_pnl_usd).toBe(25);

    // First buy: fully sold via FIFO
    const buy1 = results.find(t => t.trade_id === 't1')!;
    expect(buy1.qty_remaining).toBe(0);
    expect(buy1.realized_pnl_usd).toBe(0);

    // Second buy: 25 remaining (50 bought, 25 sold)
    const buy2 = results.find(t => t.trade_id === 't2')!;
    expect(buy2.qty_remaining).toBe(25);
    // Resolution PnL: 25 × $1.00 - 25 × $0.50 = $12.50
    expect(buy2.realized_pnl_usd).toBe(12.5);

    // TOTAL PnL = $25 (sell) + $0 (buy1) + $12.5 (buy2) = $37.5
    const totalPnl = results.reduce((sum, t) => sum + (t.realized_pnl_usd || 0), 0);
    expect(totalPnl).toBe(37.5);

    // Verification: Started with $40, got $52.5 + $25 = $77.5, profit = $37.5
  });

  it('Resolution to NO - losing position', () => {
    const trades: RawTrade[] = [{
      trade_id: 't1',
      ts: new Date('2024-01-01'),
      wallet: '0xabc',
      condition_id: 'market1',
      token_id: 'token1',
      outcome_index: 0,
      side: 'YES',
      action: 'BUY',
      price_yes: 0.7,
      qty: 100,
      notional_usd: 70,
      fee_usd: 0,
    }];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 0 as const }]
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    expect(results[0].qty_remaining).toBe(100);
    expect(results[0].realized_pnl_usd).toBe(-70); // Lost everything
    expect(results[0].realized_roi).toBeCloseTo(-1.0, 2);
  });

  it('Fees are correctly proportioned to remaining shares', () => {
    const trades: RawTrade[] = [
      {
        trade_id: 't1',
        ts: new Date('2024-01-01'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5,
        qty: 100,
        notional_usd: 50,
        fee_usd: 2, // $2 fee on 100 shares
      },
      {
        trade_id: 't2',
        ts: new Date('2024-01-02'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'SELL',
        price_yes: 0.6,
        qty: 50,
        notional_usd: 30,
        fee_usd: 0,
      },
    ];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 1 as const }]
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    const buyTrade = results.find(t => t.action === 'BUY')!;
    expect(buyTrade.qty_remaining).toBe(50);

    // Resolution PnL on 50 shares:
    // Settlement: 50 × $1.00 = $50
    // Cost: 50 × $0.50 = $25
    // Fee: $2 × (50/100) = $1
    // PnL = 50 - 25 - 1 = $24
    expect(buyTrade.realized_pnl_usd).toBe(24);
  });
});

describe('Wallet Aggregate Metrics V2', () => {
  it('aggregates correctly with partial sells', () => {
    const trades: RawTrade[] = [
      {
        trade_id: 't1',
        ts: new Date('2024-01-01'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5,
        qty: 100,
        notional_usd: 50,
        fee_usd: 0,
      },
      {
        trade_id: 't2',
        ts: new Date('2024-01-02'),
        wallet: '0xabc',
        condition_id: 'market1',
        token_id: 'token1',
        outcome_index: 0,
        side: 'YES',
        action: 'SELL',
        price_yes: 0.7,
        qty: 60,
        notional_usd: 42,
        fee_usd: 0,
      },
    ];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 1 as const }]
    ]);

    const tradeResults = computeTradeMetrics(trades, resolutions, mockPriceLookup);
    const metrics = aggregateWalletMetrics(tradeResults);

    expect(metrics.total_trades).toBe(2);
    expect(metrics.buy_trades).toBe(1);
    expect(metrics.sell_trades).toBe(1);

    // Total PnL should be $32 (12 from sell + 20 from resolution on remaining 40)
    expect(metrics.total_pnl_usd).toBe(32);
  });
});
