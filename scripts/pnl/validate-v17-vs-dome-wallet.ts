/**
 * ============================================================================
 * VALIDATE V17 VS DOME - Single Wallet Validator
 * ============================================================================
 *
 * Purpose: Compare Cascadian V17 realized PnL against Dome API truth.
 *
 * Usage:
 *   pnpm tsx scripts/pnl/validate-v17-vs-dome-wallet.ts [wallet]
 *
 * If no wallet provided, uses default target wallet.
 *
 * Success criteria: |delta_pct| <= 5%
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createV17Engine, WalletMetricsV17 } from '../../lib/pnl/uiActivityEngineV17';
import { clickhouse } from '../../lib/clickhouse/client';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';
const PASS_THRESHOLD = 0.05; // 5% tolerance

// ============================================================================
// Dome API Client
// ============================================================================

const DOME_API_KEY = process.env.DOME_API_KEY || '3850d9ac-1c76-4f94-b987-85c2b2d14c89';
const DOME_API_BASE = 'https://api.domeapi.io/v1';

interface DomeTruth {
  wallet: string;
  realized_pnl: number | null;
  confidence: 'high' | 'low' | 'none';
  error?: string;
  raw?: any;
}

async function fetchDomeTruth(wallet: string): Promise<DomeTruth> {
  const url = `${DOME_API_BASE}/polymarket/wallet/pnl/${wallet}?granularity=all`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${DOME_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        wallet,
        realized_pnl: null,
        confidence: 'none',
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();

    // Check for placeholder (Dome hasn't processed this wallet)
    const startTime = data.start_time;
    const PLACEHOLDER_START = 1609459200; // 2021-01-01
    if (startTime === PLACEHOLDER_START) {
      const pnlToDate = data.pnl_over_time?.[data.pnl_over_time.length - 1]?.pnl_to_date;
      if (pnlToDate === 0) {
        return {
          wallet,
          realized_pnl: null,
          confidence: 'none',
          error: 'Placeholder response (Dome has not processed this wallet)',
          raw: data,
        };
      }
    }

    // Extract realized PnL from pnl_over_time
    if (!data.pnl_over_time || data.pnl_over_time.length === 0) {
      return {
        wallet,
        realized_pnl: null,
        confidence: 'none',
        error: 'No pnl_over_time data',
        raw: data,
      };
    }

    const latestPnl = data.pnl_over_time[data.pnl_over_time.length - 1].pnl_to_date;

    return {
      wallet,
      realized_pnl: Number(latestPnl),
      confidence: latestPnl !== 0 ? 'high' : 'low',
      raw: data,
    };
  } catch (err: any) {
    return {
      wallet,
      realized_pnl: null,
      confidence: 'none',
      error: err.message,
    };
  }
}

// ============================================================================
// V17 Calculation
// ============================================================================

async function computeV17Pnl(wallet: string): Promise<WalletMetricsV17> {
  const engine = createV17Engine();
  return engine.compute(wallet);
}

// ============================================================================
// Cashflow Sanity Check
// ============================================================================

interface CashflowSanity {
  total_buy_usdc: number;
  total_sell_usdc: number;
  total_fees: number;
  net_cash_flow: number;
  trade_count: number;
  unique_markets: number;
}

async function getCashflowSanity(wallet: string): Promise<CashflowSanity> {
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc,
        any(fee_amount) / 1000000.0 as fee,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      sum(CASE WHEN side = 'buy' THEN abs(usdc) ELSE 0 END) as total_buy_usdc,
      sum(CASE WHEN side = 'sell' THEN abs(usdc) ELSE 0 END) as total_sell_usdc,
      sum(abs(fee)) as total_fees,
      sum(CASE WHEN side = 'sell' THEN abs(usdc) ELSE -abs(usdc) END) as net_cash_flow,
      count() as trade_count,
      uniq(token_id) as unique_markets
    FROM deduped
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  const r = rows[0] || {};

  return {
    total_buy_usdc: Number(r.total_buy_usdc) || 0,
    total_sell_usdc: Number(r.total_sell_usdc) || 0,
    total_fees: Number(r.total_fees) || 0,
    net_cash_flow: Number(r.net_cash_flow) || 0,
    trade_count: Number(r.trade_count) || 0,
    unique_markets: Number(r.unique_markets) || 0,
  };
}

// ============================================================================
// Top Delta Markets (debug)
// ============================================================================

interface MarketDelta {
  condition_id: string;
  category: string;
  realized_pnl: number;
  trade_cash_flow: number;
  final_shares: number;
  resolution_price: number | null;
  is_resolved: boolean;
}

function getTopDeltaMarkets(v17: WalletMetricsV17, limit: number = 10): MarketDelta[] {
  // Sort positions by absolute realized PnL
  return v17.positions
    .map((p) => ({
      condition_id: p.condition_id,
      category: p.category,
      realized_pnl: p.realized_pnl,
      trade_cash_flow: p.trade_cash_flow,
      final_shares: p.final_shares,
      resolution_price: p.resolution_price,
      is_resolved: p.is_resolved,
    }))
    .sort((a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl))
    .slice(0, limit);
}

// ============================================================================
// Main Validation
// ============================================================================

async function main() {
  const wallet = process.argv[2] || DEFAULT_WALLET;

  console.log('='.repeat(90));
  console.log('VALIDATE V17 VS DOME - Single Wallet');
  console.log('='.repeat(90));
  console.log('');
  console.log('Wallet:', wallet);
  console.log('Pass threshold:', `±${PASS_THRESHOLD * 100}%`);
  console.log('');

  // Step 1: Fetch Dome truth
  console.log('--- Fetching Dome Truth ---');
  const dome = await fetchDomeTruth(wallet);

  if (dome.error || dome.realized_pnl === null) {
    console.log('ERROR: Could not fetch Dome truth');
    console.log('  Error:', dome.error);
    console.log('');
    console.log('RESULT: BLOCKED (no Dome data)');
    process.exit(1);
  }

  console.log('Dome realized PnL:', `$${dome.realized_pnl.toFixed(2)}`);
  console.log('Dome confidence:', dome.confidence);
  console.log('');

  // Step 2: Compute V17 PnL
  console.log('--- Computing V17 PnL ---');
  const v17 = await computeV17Pnl(wallet);

  console.log('V17 realized PnL:', `$${v17.realized_pnl.toFixed(2)}`);
  console.log('V17 unrealized PnL:', `$${v17.unrealized_pnl.toFixed(2)}`);
  console.log('V17 total PnL:', `$${v17.total_pnl.toFixed(2)}`);
  console.log('V17 positions:', v17.positions_count);
  console.log('V17 resolutions:', v17.resolutions);
  console.log('');

  // Step 3: Compare
  console.log('--- Comparison ---');
  const delta_abs = v17.realized_pnl - dome.realized_pnl;
  const delta_pct = delta_abs / Math.max(1, Math.abs(dome.realized_pnl));
  const passed = Math.abs(delta_pct) <= PASS_THRESHOLD;

  console.log('');
  console.log('| Metric          | Dome        | V17         | Delta       |');
  console.log('|-----------------|-------------|-------------|-------------|');
  console.log(
    `| Realized PnL    | $${dome.realized_pnl.toFixed(2).padStart(9)} | $${v17.realized_pnl.toFixed(2).padStart(9)} | $${delta_abs.toFixed(2).padStart(9)} |`
  );
  console.log('');
  console.log('Delta %:', `${(delta_pct * 100).toFixed(2)}%`);
  console.log('');

  // Step 4: Pass/Fail verdict
  console.log('='.repeat(90));
  if (passed) {
    console.log(`✅ PASS: V17 matches Dome within ±${PASS_THRESHOLD * 100}%`);
  } else {
    console.log(`❌ FAIL: V17 differs from Dome by ${(delta_pct * 100).toFixed(2)}%`);
  }
  console.log('='.repeat(90));
  console.log('');

  // Step 5: Debug artifacts (if failed or verbose)
  const showDebug = !passed || process.argv.includes('--verbose');

  if (showDebug) {
    console.log('');
    console.log('='.repeat(90));
    console.log('DEBUG ARTIFACTS');
    console.log('='.repeat(90));
    console.log('');

    // Cashflow sanity
    console.log('--- Cashflow Sanity ---');
    const cashflow = await getCashflowSanity(wallet);
    console.log('Total Buy USDC:', `$${cashflow.total_buy_usdc.toFixed(2)}`);
    console.log('Total Sell USDC:', `$${cashflow.total_sell_usdc.toFixed(2)}`);
    console.log('Total Fees:', `$${cashflow.total_fees.toFixed(2)}`);
    console.log('Net Cash Flow:', `$${cashflow.net_cash_flow.toFixed(2)}`);
    console.log('Trade Count:', cashflow.trade_count);
    console.log('Unique Markets:', cashflow.unique_markets);
    console.log('');

    // Top delta markets
    console.log('--- Top 10 Markets by Realized PnL ---');
    const topMarkets = getTopDeltaMarkets(v17, 10);
    console.log('');
    console.log('| # | Condition ID (first 16) | Category   | Realized PnL | Cash Flow   | Shares     | Res Price |');
    console.log('|---|-------------------------|------------|--------------|-------------|------------|-----------|');

    topMarkets.forEach((m, i) => {
      const condShort = m.condition_id.slice(0, 16) + '...';
      const catShort = m.category.slice(0, 10).padEnd(10);
      const resPrice = m.resolution_price !== null ? m.resolution_price.toFixed(2) : 'N/A';
      console.log(
        `| ${(i + 1).toString().padStart(1)} | ${condShort.padEnd(23)} | ${catShort} | $${m.realized_pnl.toFixed(2).padStart(10)} | $${m.trade_cash_flow.toFixed(2).padStart(9)} | ${m.final_shares.toFixed(2).padStart(10)} | ${resPrice.padStart(9)} |`
      );
    });

    console.log('');

    // Category breakdown
    console.log('--- Category Breakdown ---');
    console.log('');
    console.log('| Category        | Realized PnL | Positions | Win Rate |');
    console.log('|-----------------|--------------|-----------|----------|');

    for (const cat of v17.by_category.slice(0, 10)) {
      const catName = cat.category.slice(0, 15).padEnd(15);
      console.log(
        `| ${catName} | $${cat.realized_pnl.toFixed(2).padStart(10)} | ${cat.positions_count.toString().padStart(9)} | ${(cat.win_rate * 100).toFixed(0).padStart(7)}% |`
      );
    }

    console.log('');
  }

  // Exit with appropriate code
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
