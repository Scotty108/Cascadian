#!/usr/bin/env npx tsx
/**
 * Test All PnL Engines Against Benchmark Wallet
 *
 * Benchmark wallet: 0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e
 * Polymarket UI shows: $58.41
 *
 * Tests:
 * 1. CCR-v1 (cost-basis, maker-only)
 * 2. CCR-v3 (cash-flow, all trades)
 * 3. CCR-Unified (hybrid)
 * 4. Direct SQL calculation approaches
 *
 * Usage: npx tsx scripts/pnl/test-all-engines-benchmark.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';
import { computeCCRv3 } from '../../lib/pnl/ccrEngineV3';
import { computeUnified } from '../../lib/pnl/ccrUnified';

const BENCHMARK_WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
const UI_PNL = 58.41;

interface TestResult {
  engine: string;
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  delta_vs_ui: number;
  delta_pct: string;
  details?: Record<string, any>;
}

async function testCCRv1(): Promise<TestResult> {
  console.log('\n=== Testing CCR-v1 (cost-basis, maker-only) ===');
  const result = await computeCCRv1(BENCHMARK_WALLET);
  return {
    engine: 'CCR-v1',
    total_pnl: result.total_pnl,
    realized_pnl: result.realized_pnl,
    unrealized_pnl: result.unrealized_pnl,
    delta_vs_ui: result.total_pnl - UI_PNL,
    delta_pct: ((result.total_pnl - UI_PNL) / Math.abs(UI_PNL) * 100).toFixed(1) + '%',
    details: {
      positions: result.positions_count,
      resolved: result.resolved_count,
      trades: result.total_trades,
      external_sell_tokens: result.external_sell_tokens,
      ctf_split_tokens: result.ctf_split_tokens,
    }
  };
}

async function testCCRv3(): Promise<TestResult> {
  console.log('\n=== Testing CCR-v3 (cash-flow, all trades) ===');
  const result = await computeCCRv3(BENCHMARK_WALLET);
  return {
    engine: 'CCR-v3',
    total_pnl: result.total_pnl,
    realized_pnl: result.realized_pnl,
    unrealized_pnl: result.unrealized_pnl,
    delta_vs_ui: result.total_pnl - UI_PNL,
    delta_pct: ((result.total_pnl - UI_PNL) / Math.abs(UI_PNL) * 100).toFixed(1) + '%',
    details: {
      positions: result.positions_count,
      trades: result.total_trades,
      usdc_buys: result.usdc_from_buys,
      usdc_sells: result.usdc_from_sells,
      usdc_splits: result.usdc_from_splits,
      usdc_redemptions: result.usdc_from_redemptions,
    }
  };
}

async function testUnified(): Promise<TestResult> {
  console.log('\n=== Testing CCR-Unified (hybrid) ===');
  const result = await computeUnified(BENCHMARK_WALLET);
  return {
    engine: `CCR-Unified (used: ${result.engine_used})`,
    total_pnl: result.total_pnl,
    realized_pnl: result.realized_pnl,
    unrealized_pnl: result.unrealized_pnl,
    delta_vs_ui: result.total_pnl - UI_PNL,
    delta_pct: ((result.total_pnl - UI_PNL) / Math.abs(UI_PNL) * 100).toFixed(1) + '%',
    details: {
      maker_ratio: result.maker_ratio,
      markets_count: result.markets_count,
    }
  };
}

// Simple cash-flow approach using V3 table directly
async function testDirectCashFlow(): Promise<TestResult> {
  console.log('\n=== Testing Direct Cash-Flow (V3 table) ===');

  // Simple approach: USDC in - USDC out + remaining value
  const query = `
    WITH
      clob_flows AS (
        SELECT
          sum(if(side = 'buy', -usdc_amount, usdc_amount)) / 1e6 as net_usdc,
          sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_tokens
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = lower('${BENCHMARK_WALLET}')
      ),
      ctf_flows AS (
        SELECT
          sumIf(toFloat64OrZero(amount_or_payout), event_type = 'PayoutRedemption') / 1e6 as redemptions,
          sumIf(toFloat64OrZero(amount_or_payout), event_type = 'PositionSplit') / 1e6 as split_collateral,
          sumIf(toFloat64OrZero(amount_or_payout), event_type = 'PositionsMerge') / 1e6 as merge_proceeds
        FROM pm_ctf_events
        WHERE is_deleted = 0
          AND lower(user_address) = lower('${BENCHMARK_WALLET}')
      )
    SELECT
      c.net_usdc,
      c.net_tokens,
      f.redemptions,
      f.split_collateral,
      f.merge_proceeds,
      c.net_usdc + f.redemptions + f.merge_proceeds - f.split_collateral as cash_flow_pnl
    FROM clob_flows c, ctf_flows f
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const [row] = await result.json() as any[];

  // Mark remaining tokens at 0.5
  const unrealized = row.net_tokens * 0.5;
  const total_pnl = row.cash_flow_pnl + unrealized;

  return {
    engine: 'Direct Cash-Flow',
    total_pnl: Math.round(total_pnl * 100) / 100,
    realized_pnl: Math.round(row.cash_flow_pnl * 100) / 100,
    unrealized_pnl: Math.round(unrealized * 100) / 100,
    delta_vs_ui: Math.round((total_pnl - UI_PNL) * 100) / 100,
    delta_pct: ((total_pnl - UI_PNL) / Math.abs(UI_PNL) * 100).toFixed(1) + '%',
    details: {
      net_usdc: row.net_usdc,
      net_tokens: row.net_tokens,
      redemptions: row.redemptions,
      split_collateral: row.split_collateral,
    }
  };
}

// Per-position realized PnL approach
async function testPerPositionRealized(): Promise<TestResult> {
  console.log('\n=== Testing Per-Position Realized (V3 + resolutions) ===');

  const query = `
    WITH
      wallet_trades AS (
        SELECT
          t.token_id,
          m.condition_id,
          m.outcome_index,
          t.side,
          t.usdc_amount / 1e6 as usdc,
          t.token_amount / 1e6 as tokens
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_current m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = lower('${BENCHMARK_WALLET}')
      ),
      position_summary AS (
        SELECT
          condition_id,
          outcome_index,
          sum(if(side = 'buy', -usdc, usdc)) as cash_flow,
          sum(if(side = 'buy', tokens, -tokens)) as token_balance
        FROM wallet_trades
        WHERE condition_id IS NOT NULL
        GROUP BY condition_id, outcome_index
      ),
      with_resolution AS (
        SELECT
          p.condition_id,
          p.outcome_index,
          p.cash_flow,
          p.token_balance,
          if(length(r.norm_prices) > 0,
             arrayElement(r.norm_prices, toUInt32(p.outcome_index + 1)),
             NULL) as payout
        FROM position_summary p
        LEFT JOIN pm_condition_resolutions_norm r ON p.condition_id = r.condition_id
      )
    SELECT
      count() as total_positions,
      countIf(payout IS NOT NULL) as resolved,
      round(sumIf(cash_flow + token_balance * payout, payout IS NOT NULL), 2) as realized_pnl,
      round(sumIf(cash_flow + token_balance * 0.5, payout IS NULL), 2) as unrealized_pnl,
      round(sum(cash_flow + token_balance * coalesce(payout, 0.5)), 2) as total_pnl
    FROM with_resolution
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const [row] = await result.json() as any[];

  return {
    engine: 'Per-Position Realized',
    total_pnl: row.total_pnl,
    realized_pnl: row.realized_pnl,
    unrealized_pnl: row.unrealized_pnl,
    delta_vs_ui: Math.round((row.total_pnl - UI_PNL) * 100) / 100,
    delta_pct: ((row.total_pnl - UI_PNL) / Math.abs(UI_PNL) * 100).toFixed(1) + '%',
    details: {
      positions: row.total_positions,
      resolved: row.resolved,
    }
  };
}

// Polymarket-style: Only realized from closed positions
async function testClosedPositionsOnly(): Promise<TestResult> {
  console.log('\n=== Testing Closed Positions Only ===');

  const query = `
    WITH
      wallet_trades AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          t.side,
          t.usdc_amount / 1e6 as usdc,
          t.token_amount / 1e6 as tokens
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_current m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = lower('${BENCHMARK_WALLET}')
          AND m.condition_id IS NOT NULL
      ),
      per_outcome AS (
        SELECT
          condition_id,
          outcome_index,
          sum(if(side = 'buy', -usdc, usdc)) as cash_flow,
          sum(if(side = 'buy', tokens, -tokens)) as token_balance
        FROM wallet_trades
        GROUP BY condition_id, outcome_index
      ),
      per_condition AS (
        SELECT
          condition_id,
          sum(cash_flow) as total_cash_flow,
          sum(abs(token_balance)) as total_abs_tokens
        FROM per_outcome
        GROUP BY condition_id
      )
    SELECT
      count() as total_conditions,
      countIf(total_abs_tokens < 1) as closed,
      countIf(total_abs_tokens >= 1) as open,
      round(sumIf(total_cash_flow, total_abs_tokens < 1), 2) as closed_pnl,
      round(sumIf(total_cash_flow, total_abs_tokens >= 1), 2) as open_cash_flow
    FROM per_condition
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const [row] = await result.json() as any[];

  return {
    engine: 'Closed Positions Only',
    total_pnl: row.closed_pnl,
    realized_pnl: row.closed_pnl,
    unrealized_pnl: 0,
    delta_vs_ui: Math.round((row.closed_pnl - UI_PNL) * 100) / 100,
    delta_pct: ((row.closed_pnl - UI_PNL) / Math.abs(UI_PNL) * 100).toFixed(1) + '%',
    details: {
      closed_conditions: row.closed,
      open_conditions: row.open,
      open_cash_flow: row.open_cash_flow,
    }
  };
}

// Get wallet activity summary
async function getWalletSummary() {
  console.log('\n=== Wallet Activity Summary ===');

  const query = `
    SELECT
      count() as total_trades,
      uniqExact(token_id) as unique_tokens,
      countIf(side = 'buy') as buys,
      countIf(side = 'sell') as sells,
      countIf(role = 'maker') as maker_trades,
      countIf(role = 'taker') as taker_trades,
      round(sum(usdc_amount) / 1e6, 2) as total_volume,
      min(trade_time) as first_trade,
      max(trade_time) as last_trade
    FROM pm_trader_events_v3
    WHERE lower(trader_wallet) = lower('${BENCHMARK_WALLET}')
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const [row] = await result.json() as any[];

  console.log(`  Total trades: ${row.total_trades}`);
  console.log(`  Unique tokens: ${row.unique_tokens}`);
  console.log(`  Buys: ${row.buys}, Sells: ${row.sells}`);
  console.log(`  Maker: ${row.maker_trades}, Taker: ${row.taker_trades}`);
  console.log(`  Total volume: $${row.total_volume}`);
  console.log(`  Period: ${row.first_trade} to ${row.last_trade}`);

  // Check CTF events
  const ctfQuery = `
    SELECT
      event_type,
      count() as cnt,
      round(sum(toFloat64OrZero(amount_or_payout)) / 1e6, 2) as total_amount
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND lower(user_address) = lower('${BENCHMARK_WALLET}')
    GROUP BY event_type
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = await ctfResult.json() as any[];

  console.log('\n  CTF Events:');
  for (const row of ctfRows) {
    console.log(`    ${row.event_type}: ${row.cnt} events, $${row.total_amount}`);
  }

  // Check ERC1155 transfers
  const ercQuery = `
    SELECT
      from_address,
      to_address,
      count() as transfers
    FROM pm_erc1155_transfers
    WHERE is_deleted = 0
      AND (lower(from_address) = lower('${BENCHMARK_WALLET}')
           OR lower(to_address) = lower('${BENCHMARK_WALLET}'))
    GROUP BY from_address, to_address
  `;

  const ercResult = await clickhouse.query({ query: ercQuery, format: 'JSONEachRow' });
  const ercRows = await ercResult.json() as any[];

  console.log('\n  ERC1155 Transfers:');
  for (const row of ercRows) {
    const isFrom = row.from_address.toLowerCase() === BENCHMARK_WALLET.toLowerCase();
    const direction = isFrom ? 'SENT TO' : 'RECEIVED FROM';
    const counterparty = isFrom ? row.to_address : row.from_address;
    console.log(`    ${direction} ${counterparty.slice(0, 10)}...: ${row.transfers} transfers`);
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  PnL Engine Benchmark Test                                    ║');
  console.log('╠═══════════════════════════════════════════════════════════════╣');
  console.log(`║  Wallet: ${BENCHMARK_WALLET.slice(0, 20)}...${BENCHMARK_WALLET.slice(-8)}`);
  console.log(`║  Polymarket UI shows: $${UI_PNL}                              ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');

  await getWalletSummary();

  const results: TestResult[] = [];

  try {
    results.push(await testCCRv1());
  } catch (e: any) {
    console.log(`  CCR-v1 ERROR: ${e.message}`);
  }

  try {
    results.push(await testCCRv3());
  } catch (e: any) {
    console.log(`  CCR-v3 ERROR: ${e.message}`);
  }

  try {
    results.push(await testUnified());
  } catch (e: any) {
    console.log(`  Unified ERROR: ${e.message}`);
  }

  try {
    results.push(await testDirectCashFlow());
  } catch (e: any) {
    console.log(`  Direct Cash-Flow ERROR: ${e.message}`);
  }

  try {
    results.push(await testPerPositionRealized());
  } catch (e: any) {
    console.log(`  Per-Position ERROR: ${e.message}`);
  }

  try {
    results.push(await testClosedPositionsOnly());
  } catch (e: any) {
    console.log(`  Closed-Only ERROR: ${e.message}`);
  }

  // Summary table
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           RESULTS SUMMARY                                      ║');
  console.log('╠═══════════════════════════════╤═══════════╤═══════════╤══════════╤════════════╣');
  console.log('║ Engine                        │ Total PnL │ Realized  │ Unrealiz │ Delta (%)  ║');
  console.log('╠═══════════════════════════════╪═══════════╪═══════════╪══════════╪════════════╣');

  for (const r of results) {
    const engine = r.engine.padEnd(29);
    const total = ('$' + r.total_pnl.toFixed(2)).padStart(9);
    const realized = ('$' + r.realized_pnl.toFixed(2)).padStart(9);
    const unrealized = ('$' + r.unrealized_pnl.toFixed(2)).padStart(8);
    const delta = r.delta_pct.padStart(10);
    console.log(`║ ${engine} │ ${total} │ ${realized} │ ${unrealized} │ ${delta} ║`);
  }

  console.log('╠═══════════════════════════════╪═══════════╪═══════════╪══════════╪════════════╣');
  console.log(`║ Polymarket UI (target)        │    $${UI_PNL.toFixed(2)} │           │          │       0.0% ║`);
  console.log('╚═══════════════════════════════╧═══════════╧═══════════╧══════════╧════════════╝');

  // Find closest match
  const sorted = [...results].sort((a, b) => Math.abs(a.delta_vs_ui) - Math.abs(b.delta_vs_ui));
  console.log(`\n🎯 Closest match: ${sorted[0].engine} (delta: ${sorted[0].delta_pct})`);

  // Print details of closest match
  console.log('\nDetails of closest match:');
  console.log(JSON.stringify(sorted[0].details, null, 2));

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
