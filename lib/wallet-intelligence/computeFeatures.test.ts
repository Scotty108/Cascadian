/**
 * Feature Computation Tests
 * Run: npx vitest run lib/wallet-intelligence/computeFeatures.test.ts
 */

import { describe, it, expect } from 'vitest';
import { computeWalletFeatures } from './computeFeatures';
import type { Position } from './types';

describe('Wallet Features Computation', () => {
  const makePosition = (overrides: Partial<Position>): Position => ({
    position_id: 'pos-1',
    wallet: '0xabc',
    condition_id: 'market-1',
    category: 'Sports',
    event_id: 'event-1',
    side: 'YES',
    ts_open: new Date('2024-01-01T00:00:00Z'),
    ts_close: null,
    ts_resolve: new Date('2024-01-10T00:00:00Z'),
    qty_shares: 100,
    entry_cost_usd: 50,
    exit_proceeds_usd: 100,
    fees_usd: 0,
    avg_entry_price_side: 0.5,
    avg_exit_price_side: null,
    outcome_side: 1,
    pnl_usd: 50,
    roi: 1.0,
    hold_minutes: 9 * 24 * 60,
    p_close_1h: 0.9,
    p_close_4h: 0.8,
    p_close_24h: 0.7,
    p_close_72h: 0.6,
    ...overrides,
  });

  it('computes basic metrics correctly', () => {
    const positions = [
      makePosition({ pnl_usd: 50, roi: 1.0 }),
      makePosition({ position_id: 'pos-2', pnl_usd: -25, roi: -0.5 }),
    ];

    const features = computeWalletFeatures('0xabc', positions);

    expect(features.wallet).toBe('0xabc');
    expect(features.positions_total).toBe(2);
    expect(features.win_rate).toBeCloseTo(0.5);
    expect(features.total_pnl_usd).toBe(25); // 50 - 25
  });

  it('computes win rate correctly', () => {
    const positions = [
      makePosition({ pnl_usd: 100 }),
      makePosition({ position_id: 'pos-2', pnl_usd: 50 }),
      makePosition({ position_id: 'pos-3', pnl_usd: -20 }),
    ];

    const features = computeWalletFeatures('0xabc', positions);

    expect(features.win_rate).toBeCloseTo(2 / 3);
  });

  it('computes CLV metrics', () => {
    // Entry at 0.5, close_24h at 0.7 → CLV = 0.2
    const positions = [makePosition({
      avg_entry_price_side: 0.5,
      p_close_24h: 0.7,
    })];

    const features = computeWalletFeatures('0xabc', positions);

    expect(features.avg_clv_24h).toBeCloseTo(0.2);
    expect(features.clv_win_rate_24h).toBe(1); // Positive CLV
  });

  it('computes concentration metrics', () => {
    const positions = [
      makePosition({ category: 'Sports', event_id: 'e1', condition_id: 'm1' }),
      makePosition({ position_id: 'p2', category: 'Sports', event_id: 'e1', condition_id: 'm2' }),
      makePosition({ position_id: 'p3', category: 'Crypto', event_id: 'e2', condition_id: 'm3' }),
    ];

    const features = computeWalletFeatures('0xabc', positions);

    expect(features.unique_categories).toBe(2);
    expect(features.unique_events).toBe(2);
    expect(features.unique_markets).toBe(3);
    // Sports has 2/3, Crypto has 1/3 → HHI = (2/3)^2 + (1/3)^2 = 4/9 + 1/9 = 5/9
    expect(features.category_hhi).toBeCloseTo(5 / 9);
    expect(features.top_category_share).toBeCloseTo(2 / 3);
  });

  it('computes Brier score correctly', () => {
    // Entry price 0.8, outcome 1 → Brier = (0.8 - 1)^2 = 0.04
    const positions = [makePosition({
      avg_entry_price_side: 0.8,
      outcome_side: 1,
    })];

    const features = computeWalletFeatures('0xabc', positions);

    expect(features.brier_score).toBeCloseTo(0.04);
  });

  it('handles empty positions', () => {
    const features = computeWalletFeatures('0xabc', []);

    expect(features.positions_total).toBe(0);
    expect(features.win_rate).toBe(0);
    expect(features.total_pnl_usd).toBe(0);
  });

  it('computes hold time metrics', () => {
    const positions = [
      makePosition({ hold_minutes: 100 }),
      makePosition({ position_id: 'p2', hold_minutes: 200 }),
      makePosition({ position_id: 'p3', hold_minutes: 300 }),
    ];

    const features = computeWalletFeatures('0xabc', positions);

    expect(features.hold_minutes_median).toBe(200);
    expect(features.hold_minutes_p50).toBe(200);
  });

  it('computes pct held to resolve', () => {
    const positions = [
      makePosition({ ts_close: null }), // Held to resolve
      makePosition({ position_id: 'p2', ts_close: new Date() }), // Closed early
      makePosition({ position_id: 'p3', ts_close: null }), // Held to resolve
    ];

    const features = computeWalletFeatures('0xabc', positions);

    expect(features.pct_held_to_resolve).toBeCloseTo(2 / 3);
  });
});
