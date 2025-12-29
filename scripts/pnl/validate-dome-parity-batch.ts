/**
 * ============================================================================
 * DOME PARITY VALIDATOR - Batch Mode
 * ============================================================================
 *
 * Run validation against multiple wallets and check if the pattern holds:
 * "The V17-Dome gap is entirely explained by different redemption accounting"
 *
 * Usage:
 *   pnpm tsx scripts/pnl/validate-dome-parity-batch.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

// ============================================================================
// Configuration
// ============================================================================

const DOME_API_KEY = process.env.DOME_API_KEY || '3850d9ac-1c76-4f94-b987-85c2b2d14c89';
const DOME_API_BASE = 'https://api.domeapi.io/v1';

// Test wallets - mix of volumes
const TEST_WALLETS = [
  '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', // Original target
  '0x654ee63920c474c83a1fae56f02754e9bf6da732', // ~$10M
  '0x5235578efe24555b0c98e7dc10a902b09089c04a', // ~$10M
  '0xac92f07ce8848235f02a09f2624ed2116fab9d64', // ~$10M
  '0x5e69473d8a410eb889dde1d96eddb2ffef09c0c8', // ~$10M
];

// ============================================================================
// Dome API
// ============================================================================

async function fetchDome(wallet: string): Promise<number | null> {
  const url = `${DOME_API_BASE}/polymarket/wallet/pnl/${wallet}?granularity=all`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${DOME_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return null;

    const data = await response.json();

    // Check for placeholder
    if (data.start_time === 1609459200) {
      const pnl = data.pnl_over_time?.[data.pnl_over_time.length - 1]?.pnl_to_date;
      if (pnl === 0) return null;
    }

    const latestPnl = data.pnl_over_time?.[data.pnl_over_time.length - 1]?.pnl_to_date;
    return latestPnl !== undefined ? Number(latestPnl) : null;
  } catch {
    return null;
  }
}

// ============================================================================
// V17 Decomposition
// ============================================================================

interface V17Summary {
  realized_pnl: number;
  resolved_trade_cashflow: number;
  resolved_synthetic_redemption: number;
  resolved_count: number;
}

async function getV17Summary(wallet: string): Promise<V17Summary> {
  const engine = createV17Engine();
  const result = await engine.compute(wallet);

  let resolved_trade_cashflow = 0;
  let resolved_synthetic_redemption = 0;
  let resolved_count = 0;

  for (const pos of result.positions) {
    if (pos.is_resolved && pos.resolution_price !== null) {
      resolved_trade_cashflow += pos.trade_cash_flow;
      resolved_synthetic_redemption += pos.final_shares * pos.resolution_price;
      resolved_count++;
    }
  }

  return {
    realized_pnl: result.realized_pnl,
    resolved_trade_cashflow,
    resolved_synthetic_redemption,
    resolved_count,
  };
}

// ============================================================================
// Explicit Redemptions
// ============================================================================

async function getExplicitRedemptions(wallet: string): Promise<number> {
  const query = `
    SELECT sum(toFloat64OrNull(amount_or_payout) / 1000000.0) as total
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND event_type = 'PayoutRedemption'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return Number(rows[0]?.total) || 0;
}

// ============================================================================
// Main
// ============================================================================

interface WalletResult {
  wallet: string;
  dome_realized: number | null;
  v17_realized: number;
  delta: number | null;
  delta_pct: number | null;
  resolved_cashflow: number;
  synthetic_redemption: number;
  explicit_redemption: number;
  dome_implied_redemption: number | null;
  redemption_gap: number | null;
  gap_matches_delta: boolean | null;
}

async function validateWallet(wallet: string): Promise<WalletResult> {
  const [dome_realized, v17, explicit] = await Promise.all([
    fetchDome(wallet),
    getV17Summary(wallet),
    getExplicitRedemptions(wallet),
  ]);

  let delta: number | null = null;
  let delta_pct: number | null = null;
  let dome_implied_redemption: number | null = null;
  let redemption_gap: number | null = null;
  let gap_matches_delta: boolean | null = null;

  if (dome_realized !== null) {
    delta = v17.realized_pnl - dome_realized;
    delta_pct = delta / Math.max(1, Math.abs(dome_realized)) * 100;
    dome_implied_redemption = dome_realized - v17.resolved_trade_cashflow;
    redemption_gap = v17.resolved_synthetic_redemption - dome_implied_redemption;
    gap_matches_delta = Math.abs(redemption_gap - delta) < 10; // Within $10
  }

  return {
    wallet,
    dome_realized,
    v17_realized: v17.realized_pnl,
    delta,
    delta_pct,
    resolved_cashflow: v17.resolved_trade_cashflow,
    synthetic_redemption: v17.resolved_synthetic_redemption,
    explicit_redemption: explicit,
    dome_implied_redemption,
    redemption_gap,
    gap_matches_delta,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('DOME PARITY VALIDATOR - Batch Mode');
  console.log('='.repeat(100));
  console.log('');
  console.log('Testing', TEST_WALLETS.length, 'wallets to validate pattern:');
  console.log('"V17-Dome gap is entirely explained by different redemption accounting"');
  console.log('');

  const results: WalletResult[] = [];

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const wallet = TEST_WALLETS[i];
    console.log(`[${i + 1}/${TEST_WALLETS.length}] Processing ${wallet.slice(0, 10)}...`);

    try {
      const result = await validateWallet(wallet);
      results.push(result);
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
      results.push({
        wallet,
        dome_realized: null,
        v17_realized: 0,
        delta: null,
        delta_pct: null,
        resolved_cashflow: 0,
        synthetic_redemption: 0,
        explicit_redemption: 0,
        dome_implied_redemption: null,
        redemption_gap: null,
        gap_matches_delta: null,
      });
    }

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('RESULTS');
  console.log('='.repeat(100));
  console.log('');

  // Summary table
  console.log('| Wallet (10)  | Dome       | V17        | Delta $    | Delta %  | Gap=Delta |');
  console.log('|--------------|------------|------------|------------|----------|-----------|');

  for (const r of results) {
    const walletShort = r.wallet.slice(0, 10) + '..';
    const domeStr = r.dome_realized !== null ? `$${r.dome_realized.toFixed(0).padStart(9)}` : '      N/A';
    const v17Str = `$${r.v17_realized.toFixed(0).padStart(9)}`;
    const deltaStr = r.delta !== null ? `$${r.delta.toFixed(0).padStart(9)}` : '      N/A';
    const deltaPctStr = r.delta_pct !== null ? `${r.delta_pct.toFixed(1).padStart(7)}%` : '     N/A';
    const gapMatchStr = r.gap_matches_delta === null ? '   N/A' : r.gap_matches_delta ? '     YES' : '      NO';

    console.log(`| ${walletShort} | ${domeStr} | ${v17Str} | ${deltaStr} | ${deltaPctStr} | ${gapMatchStr} |`);
  }

  console.log('');

  // Detailed breakdown for each wallet with Dome data
  console.log('='.repeat(100));
  console.log('DETAILED BREAKDOWN');
  console.log('='.repeat(100));
  console.log('');

  for (const r of results) {
    if (r.dome_realized === null) {
      console.log(`${r.wallet.slice(0, 16)}... - NO DOME DATA`);
      console.log('');
      continue;
    }

    console.log(`${r.wallet.slice(0, 16)}...`);
    console.log(`  Dome realized:           $${r.dome_realized.toFixed(2)}`);
    console.log(`  V17 realized:            $${r.v17_realized.toFixed(2)}`);
    console.log(`  Delta:                   $${r.delta!.toFixed(2)} (${r.delta_pct!.toFixed(1)}%)`);
    console.log('');
    console.log(`  Resolved trade cashflow: $${r.resolved_cashflow.toFixed(2)}`);
    console.log(`  V17 synthetic:           $${r.synthetic_redemption.toFixed(2)}`);
    console.log(`  Dome implied:            $${r.dome_implied_redemption!.toFixed(2)}`);
    console.log(`  Explicit on-chain:       $${r.explicit_redemption.toFixed(2)}`);
    console.log('');
    console.log(`  Redemption gap:          $${r.redemption_gap!.toFixed(2)}`);
    console.log(`  Gap matches delta:       ${r.gap_matches_delta ? 'YES' : 'NO'}`);
    console.log('');
  }

  // Final verdict
  const withDome = results.filter((r) => r.dome_realized !== null);
  const patternHolds = withDome.filter((r) => r.gap_matches_delta === true);

  console.log('='.repeat(100));
  console.log('VERDICT');
  console.log('='.repeat(100));
  console.log('');
  console.log(`Wallets with Dome data: ${withDome.length}/${results.length}`);
  console.log(`Pattern holds (gap=delta): ${patternHolds.length}/${withDome.length}`);
  console.log('');

  if (patternHolds.length === withDome.length && withDome.length > 0) {
    console.log('PATTERN VALIDATED: V17-Dome gap is entirely due to redemption accounting differences');
  } else if (patternHolds.length > withDome.length / 2) {
    console.log('PATTERN MOSTLY HOLDS: Some wallets may have additional factors');
  } else {
    console.log('PATTERN DOES NOT HOLD: Additional investigation needed');
  }

  console.log('');
  console.log('='.repeat(100));
}

main().catch(console.error);
