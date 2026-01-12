/**
 * Position Builder Tests
 * Run: npx vitest run lib/wallet-intelligence/positionBuilder.test.ts
 */

import { describe, it, expect } from 'vitest';
import { buildPositions } from './positionBuilder';
import type { Fill, MarketResolution } from './types';

// Mock resolution lookup
const mockResolutions: Record<string, MarketResolution> = {
  'market-yes-wins': {
    condition_id: 'market-yes-wins',
    resolved_at: new Date('2024-01-10T00:00:00Z'),
    outcome_yes: 1,
    payout_numerators: [1, 0],
  },
  'market-no-wins': {
    condition_id: 'market-no-wins',
    resolved_at: new Date('2024-01-10T00:00:00Z'),
    outcome_yes: 0,
    payout_numerators: [0, 1],
  },
};

const resolutionLookup = {
  getResolution: (conditionId: string) => mockResolutions[conditionId] || null,
};

// Simple price lookup (returns same price always for testing)
const priceLookup = {
  getMidYesAt: (_conditionId: string, _ts: Date) => 0.6,
};

describe('Position Builder', () => {
  it('simple buy and hold to resolution - YES wins', () => {
    const fills: Fill[] = [
      {
        fill_id: 'fill-1',
        ts_fill: new Date('2024-01-01T00:00:00Z'),
        wallet: '0xabc',
        condition_id: 'market-yes-wins',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5, // Bought at 50 cents
        qty_shares: 100,
        notional_usd: 50, // 100 shares * $0.50
        fee_usd: 0,
        tx_hash: 'tx1',
        block_number: 1,
      },
    ];

    const positions = buildPositions(fills, resolutionLookup, priceLookup);

    expect(positions).toHaveLength(1);
    const pos = positions[0];

    expect(pos.wallet).toBe('0xabc');
    expect(pos.side).toBe('YES');
    expect(pos.ts_close).toBeNull(); // Held to resolution
    expect(pos.qty_shares).toBe(100);
    expect(pos.entry_cost_usd).toBe(50);
    expect(pos.avg_entry_price_side).toBeCloseTo(0.5);
    expect(pos.outcome_side).toBe(1); // YES won
    expect(pos.exit_proceeds_usd).toBe(100); // 100 shares * $1
    expect(pos.pnl_usd).toBe(50); // $100 - $50
    expect(pos.roi).toBeCloseTo(1.0); // 100% return
  });

  it('simple buy and hold to resolution - YES loses', () => {
    const fills: Fill[] = [
      {
        fill_id: 'fill-1',
        ts_fill: new Date('2024-01-01T00:00:00Z'),
        wallet: '0xabc',
        condition_id: 'market-no-wins',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5,
        qty_shares: 100,
        notional_usd: 50,
        fee_usd: 0,
        tx_hash: 'tx1',
        block_number: 1,
      },
    ];

    const positions = buildPositions(fills, resolutionLookup, priceLookup);

    expect(positions).toHaveLength(1);
    const pos = positions[0];

    expect(pos.outcome_side).toBe(0); // YES lost
    expect(pos.exit_proceeds_usd).toBe(0); // 100 shares * $0
    expect(pos.pnl_usd).toBe(-50); // Lost everything
    expect(pos.roi).toBeCloseTo(-1.0); // -100% return
  });

  it('NO side position - NO wins', () => {
    const fills: Fill[] = [
      {
        fill_id: 'fill-1',
        ts_fill: new Date('2024-01-01T00:00:00Z'),
        wallet: '0xabc',
        condition_id: 'market-no-wins',
        outcome_index: 1,
        side: 'NO',
        action: 'BUY',
        price_yes: 0.6, // YES is at 0.6, so NO is at 0.4
        qty_shares: 100,
        notional_usd: 40, // 100 shares * $0.40
        fee_usd: 0,
        tx_hash: 'tx1',
        block_number: 1,
      },
    ];

    const positions = buildPositions(fills, resolutionLookup, priceLookup);

    expect(positions).toHaveLength(1);
    const pos = positions[0];

    expect(pos.side).toBe('NO');
    expect(pos.avg_entry_price_side).toBeCloseTo(0.4); // 1 - 0.6
    expect(pos.outcome_side).toBe(1); // NO won (since YES lost)
    expect(pos.exit_proceeds_usd).toBe(100); // 100 shares * $1
    expect(pos.pnl_usd).toBe(60); // $100 - $40
    expect(pos.roi).toBeCloseTo(1.5); // 150% return
  });

  it('buy then sell (close early)', () => {
    const fills: Fill[] = [
      {
        fill_id: 'fill-1',
        ts_fill: new Date('2024-01-01T00:00:00Z'),
        wallet: '0xabc',
        condition_id: 'market-yes-wins',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5,
        qty_shares: 100,
        notional_usd: 50,
        fee_usd: 0,
        tx_hash: 'tx1',
        block_number: 1,
      },
      {
        fill_id: 'fill-2',
        ts_fill: new Date('2024-01-05T00:00:00Z'),
        wallet: '0xabc',
        condition_id: 'market-yes-wins',
        outcome_index: 0,
        side: 'YES',
        action: 'SELL',
        price_yes: 0.7,
        qty_shares: 100,
        notional_usd: 70, // Sold at 70 cents
        fee_usd: 0,
        tx_hash: 'tx2',
        block_number: 2,
      },
    ];

    const positions = buildPositions(fills, resolutionLookup, priceLookup);

    expect(positions).toHaveLength(1);
    const pos = positions[0];

    expect(pos.ts_close).not.toBeNull(); // Closed early
    expect(pos.entry_cost_usd).toBe(50);
    expect(pos.exit_proceeds_usd).toBe(70);
    expect(pos.pnl_usd).toBe(20); // $70 - $50
    expect(pos.roi).toBeCloseTo(0.4); // 40% return
    expect(pos.avg_exit_price_side).toBeCloseTo(0.7);
  });

  it('multiple buys with weighted average', () => {
    const fills: Fill[] = [
      {
        fill_id: 'fill-1',
        ts_fill: new Date('2024-01-01T00:00:00Z'),
        wallet: '0xabc',
        condition_id: 'market-yes-wins',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.4, // 100 shares at $0.40
        qty_shares: 100,
        notional_usd: 40,
        fee_usd: 0,
        tx_hash: 'tx1',
        block_number: 1,
      },
      {
        fill_id: 'fill-2',
        ts_fill: new Date('2024-01-02T00:00:00Z'),
        wallet: '0xabc',
        condition_id: 'market-yes-wins',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.6, // 100 shares at $0.60
        qty_shares: 100,
        notional_usd: 60,
        fee_usd: 0,
        tx_hash: 'tx2',
        block_number: 2,
      },
    ];

    const positions = buildPositions(fills, resolutionLookup, priceLookup);

    expect(positions).toHaveLength(1);
    const pos = positions[0];

    expect(pos.qty_shares).toBe(200);
    expect(pos.entry_cost_usd).toBe(100); // $40 + $60
    // Weighted avg: (100*0.4 + 100*0.6) / 200 = 0.5
    expect(pos.avg_entry_price_side).toBeCloseTo(0.5);
    expect(pos.exit_proceeds_usd).toBe(200); // YES won, 200 shares * $1
    expect(pos.pnl_usd).toBe(100); // $200 - $100
    expect(pos.roi).toBeCloseTo(1.0); // 100% return
  });

  it('handles fees correctly', () => {
    const fills: Fill[] = [
      {
        fill_id: 'fill-1',
        ts_fill: new Date('2024-01-01T00:00:00Z'),
        wallet: '0xabc',
        condition_id: 'market-yes-wins',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5,
        qty_shares: 100,
        notional_usd: 50,
        fee_usd: 1, // $1 fee
        tx_hash: 'tx1',
        block_number: 1,
      },
    ];

    const positions = buildPositions(fills, resolutionLookup, priceLookup);

    expect(positions).toHaveLength(1);
    const pos = positions[0];

    expect(pos.entry_cost_usd).toBe(51); // $50 + $1 fee
    expect(pos.fees_usd).toBe(1);
    expect(pos.pnl_usd).toBe(49); // $100 - $51
  });

  it('calculates hold time correctly', () => {
    const fills: Fill[] = [
      {
        fill_id: 'fill-1',
        ts_fill: new Date('2024-01-01T00:00:00Z'),
        wallet: '0xabc',
        condition_id: 'market-yes-wins',
        outcome_index: 0,
        side: 'YES',
        action: 'BUY',
        price_yes: 0.5,
        qty_shares: 100,
        notional_usd: 50,
        fee_usd: 0,
        tx_hash: 'tx1',
        block_number: 1,
      },
    ];

    const positions = buildPositions(fills, resolutionLookup, priceLookup);
    const pos = positions[0];

    // From Jan 1 to Jan 10 = 9 days = 9 * 24 * 60 = 12960 minutes
    expect(pos.hold_minutes).toBe(9 * 24 * 60);
  });
});
