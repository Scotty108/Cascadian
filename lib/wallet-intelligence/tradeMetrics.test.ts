/**
 * Trade Metrics Tests
 * Run: npx vitest run lib/wallet-intelligence/tradeMetrics.test.ts
 */

import { describe, it, expect } from 'vitest';
import { computeTradeMetrics, aggregateWalletMetrics, RawTrade } from './tradeMetrics';

const mockPriceLookup = {
  getMidYesAt: () => 0.7, // Always return 0.7 for testing
};

describe('Trade Metrics - Per Trade PnL', () => {
  it('BUY trade held to resolution - YES wins', () => {
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
      notional_usd: 50, // 100 * 0.50
      fee_usd: 0,
    }];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 1 as const }]
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    expect(results).toHaveLength(1);
    expect(results[0].realized_pnl_usd).toBe(50); // 100 - 50
    expect(results[0].realized_roi).toBe(1.0); // 100% return
    expect(results[0].outcome_side).toBe(1);
  });

  it('BUY trade held to resolution - YES loses', () => {
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
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 0 as const }]
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    expect(results[0].realized_pnl_usd).toBe(-50); // 0 - 50
    expect(results[0].realized_roi).toBe(-1.0); // -100% return
    expect(results[0].outcome_side).toBe(0);
  });

  it('NO side BUY trade - NO wins', () => {
    const trades: RawTrade[] = [{
      trade_id: 't1',
      ts: new Date('2024-01-01'),
      wallet: '0xabc',
      condition_id: 'market1',
      token_id: 'token1',
      outcome_index: 1,
      side: 'NO',
      action: 'BUY',
      price_yes: 0.7, // YES at 0.7, so NO at 0.3
      qty: 100,
      notional_usd: 30, // 100 * 0.30
      fee_usd: 0,
    }];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 0 as const }] // YES loses = NO wins
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    expect(results[0].side).toBe('NO');
    expect(results[0].outcome_side).toBe(1); // NO won
    expect(results[0].realized_pnl_usd).toBe(70); // 100 - 30
    expect(results[0].realized_roi).toBeCloseTo(2.333, 2); // 233% return
  });

  it('SELL trade uses FIFO cost basis', () => {
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
        price_yes: 0.4,
        qty: 100,
        notional_usd: 40, // Cost basis: $0.40/share
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
        price_yes: 0.6,
        qty: 50, // Sell 50 of the 100 bought
        notional_usd: 30, // Proceeds: 50 * 0.6 = 30
        fee_usd: 0,
      },
    ];

    const resolutions = new Map<string, { resolved_at: Date; outcome_yes: 0 | 1 }>();

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    expect(results).toHaveLength(2);

    // SELL trade
    const sellTrade = results[1];
    expect(sellTrade.action).toBe('SELL');
    expect(sellTrade.cost_basis_usd).toBe(20); // 50 * 0.40 = 20 (FIFO from first buy)
    expect(sellTrade.realized_pnl_usd).toBe(10); // 30 - 20
    expect(sellTrade.realized_roi).toBe(0.5); // 50% return
  });

  it('Multiple buys then sell uses FIFO correctly', () => {
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
        qty: 75, // Sell 75: all 50 from t1 + 25 from t2
        notional_usd: 52.5, // 75 * 0.7
        fee_usd: 0,
      },
    ];

    const resolutions = new Map<string, { resolved_at: Date; outcome_yes: 0 | 1 }>();

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    const sellTrade = results[2];
    // FIFO cost: 50 * 0.30 + 25 * 0.50 = 15 + 12.5 = 27.5
    expect(sellTrade.cost_basis_usd).toBe(27.5);
    expect(sellTrade.realized_pnl_usd).toBe(25); // 52.5 - 27.5
  });

  it('handles fees correctly', () => {
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
      fee_usd: 1, // $1 fee
    }];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 1 as const }]
    ]);

    const results = computeTradeMetrics(trades, resolutions, mockPriceLookup);

    // PnL = settlement - cost - fee = 100 - 50 - 1 = 49
    expect(results[0].realized_pnl_usd).toBe(49);
  });
});

describe('Wallet Aggregate Metrics', () => {
  it('aggregates correctly', () => {
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
        category: 'Sports',
      },
      {
        trade_id: 't2',
        ts: new Date('2024-01-02'),
        wallet: '0xabc',
        condition_id: 'market2',
        token_id: 'token2',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.6,
        qty: 50,
        notional_usd: 30,
        fee_usd: 0,
        category: 'Crypto',
      },
    ];

    const resolutions = new Map([
      ['market1', { resolved_at: new Date('2024-01-10'), outcome_yes: 1 as const }],
      ['market2', { resolved_at: new Date('2024-01-10'), outcome_yes: 0 as const }],
    ]);

    const tradeResults = computeTradeMetrics(trades, resolutions, mockPriceLookup);
    const metrics = aggregateWalletMetrics(tradeResults);

    expect(metrics.total_trades).toBe(2);
    expect(metrics.buy_trades).toBe(2);
    expect(metrics.resolved_trades).toBe(2);
    expect(metrics.total_volume_usd).toBe(80);
    // PnL: market1 = 100-50 = 50, market2 = 0-30 = -30, total = 20
    expect(metrics.total_pnl_usd).toBe(20);
    expect(metrics.win_rate).toBe(0.5); // 1 win, 1 loss
    expect(metrics.unique_markets).toBe(2);
    expect(metrics.unique_categories).toBe(2);
  });
});
