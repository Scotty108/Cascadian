#!/usr/bin/env npx tsx
/**
 * Cash Flow + Settlement PnL Formula
 *
 * THE CORRECT FORMULA (discovered 2026-01-07):
 *
 * PnL = Trading Cash Flow + Settlement Value
 *     = (USDC received from sells - USDC spent on buys) + (Net tokens × Payout price)
 *
 * Where:
 * - Trading Cash Flow = sum of USDC from sells minus sum of USDC from buys
 * - Net tokens = tokens bought - tokens sold (per position)
 * - Payout price = resolution price (0 or 1 for binary markets)
 * - Settlement Value = sum across all positions of (net_tokens * payout)
 *
 * This works because:
 * - When you sell tokens you don't have, you receive USDC but owe tokens
 * - At resolution, those owed tokens must be settled at payout price
 * - If you're short winning tokens, settlement is negative (you pay)
 * - If you're short losing tokens, settlement is 0 (you keep the USDC)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

interface WalletPnL {
  wallet: string;
  tradingPnL: number;
  settlementPnL: number;
  totalPnL: number;
  resolvedPositions: number;
  unresolvedPositions: number;
  unresolvedValue: number;
}

async function calculateWalletPnL(wallet: string): Promise<WalletPnL> {
  // Query 1: Get trading cash flow
  const cashFlowQuery = `
    SELECT
      SUM(CASE WHEN side = 'sell' THEN usdc_amount ELSE -usdc_amount END) / 1e6 as net_usdc_flow
    FROM pm_trader_events_v3
    WHERE lower(trader_wallet) = lower('${wallet}')
  `;

  const cashFlowResult = await clickhouse.query({ query: cashFlowQuery, format: 'JSONEachRow' });
  const cashFlowData = await cashFlowResult.json() as any[];
  const tradingPnL = cashFlowData[0]?.net_usdc_flow || 0;

  // Query 2: Get settlement value for resolved positions + unrealized for unresolved
  const settlementQuery = `
    WITH positions AS (
      SELECT
        m.condition_id,
        m.outcome_index,
        SUM(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) / 1e6 as net_tokens
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_current m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower('${wallet}')
      GROUP BY m.condition_id, m.outcome_index
    ),
    resolved AS (
      SELECT
        p.condition_id,
        p.outcome_index,
        p.net_tokens,
        arrayElement(r.norm_prices, toUInt8(p.outcome_index + 1)) as payout,
        1 as is_resolved
      FROM positions p
      JOIN pm_condition_resolutions_norm r ON lower(p.condition_id) = lower(r.condition_id)
    ),
    unresolved AS (
      SELECT
        p.condition_id,
        p.outcome_index,
        p.net_tokens,
        0.5 as payout,  -- Mark to mid for unresolved
        0 as is_resolved
      FROM positions p
      LEFT JOIN pm_condition_resolutions_norm r ON lower(p.condition_id) = lower(r.condition_id)
      WHERE r.condition_id IS NULL
    ),
    all_positions AS (
      SELECT * FROM resolved
      UNION ALL
      SELECT * FROM unresolved
    )
    SELECT
      sumIf(net_tokens * payout, is_resolved = 1) as resolved_settlement,
      sumIf(net_tokens * payout, is_resolved = 0) as unresolved_value,
      countIf(is_resolved = 1) as resolved_count,
      countIf(is_resolved = 0) as unresolved_count
    FROM all_positions
  `;

  const settlementResult = await clickhouse.query({ query: settlementQuery, format: 'JSONEachRow' });
  const settlementData = await settlementResult.json() as any[];

  const settlementPnL = settlementData[0]?.resolved_settlement || 0;
  const unresolvedValue = settlementData[0]?.unresolved_value || 0;
  const resolvedPositions = Number(settlementData[0]?.resolved_count || 0);
  const unresolvedPositions = Number(settlementData[0]?.unresolved_count || 0);

  return {
    wallet,
    tradingPnL,
    settlementPnL,
    totalPnL: tradingPnL + settlementPnL,
    resolvedPositions,
    unresolvedPositions,
    unresolvedValue
  };
}

async function main() {
  // Benchmark wallets from pm_ui_pnl_benchmarks_v1 (fresh_dec16_2025)
  const testWallets = [
    { address: '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e', uiPnL: 58.41, note: 'Original test wallet' },
    { address: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', uiPnL: 22053934, note: 'Theo4 - #1' },
    { address: '0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf', uiPnL: 16620028, note: 'Fredi9999 - #2' },
    { address: '0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76', uiPnL: 8709973, note: 'Len9311238 - #3' },
    { address: '0x863134d00841b2e200492805a01e1e2f5defaa53', uiPnL: 7532409.5, note: 'RepTrump - #5' },
  ];

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Cash Flow + Settlement PnL Calculator                        ║');
  console.log('║  Formula: PnL = Trading Cash Flow + Settlement Value          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  for (const { address, uiPnL, note } of testWallets) {
    console.log(`Testing wallet: ${address}`);
    if (note) console.log(`Note: ${note}`);
    console.log(`Target UI PnL: $${uiPnL.toLocaleString()}`);
    console.log('─'.repeat(60));

    const result = await calculateWalletPnL(address);

    const delta = result.totalPnL - uiPnL;
    const deltaPct = ((delta / Math.abs(uiPnL)) * 100).toFixed(2);

    console.log(`  Trading Cash Flow:   $${result.tradingPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  Settlement Value:    $${result.settlementPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  ─────────────────────────────────`);
    console.log(`  Total PnL:           $${result.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  UI PnL:              $${uiPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`  Delta:               ${delta >= 0 ? '+' : ''}$${delta.toLocaleString(undefined, { maximumFractionDigits: 2 })} (${deltaPct}%)`);
    console.log();
    console.log(`  Resolved positions:   ${result.resolvedPositions}`);
    console.log(`  Unresolved positions: ${result.unresolvedPositions}`);
    if (result.unresolvedPositions > 0) {
      console.log(`  Unresolved value:    $${result.unresolvedValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} (marked to $0.50)`);
    }

    // Verdict
    const isAccurate = Math.abs(delta) < Math.abs(uiPnL) * 0.05; // Within 5%
    console.log();
    console.log(`  Verdict: ${isAccurate ? '✅ ACCURATE' : '⚠️  CHECK REQUIRED'} (${deltaPct}% error)`);
    console.log();
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
