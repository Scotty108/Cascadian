/**
 * Wallet Metrics Validation Script
 *
 * Compares CCR-v1 engine output against Polymarket UI values.
 * Usage: npx tsx scripts/validate-wallet-metrics.ts <wallet_address>
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

// Known UI benchmark values (manually observed from Polymarket)
const UI_BENCHMARKS: Record<string, {
  name: string;
  realized_pnl?: number;
  predictions?: number;
  wins?: number;
  losses?: number;
}> = {
  '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae': {
    name: '@Latina',
    realized_pnl: 411886.53, // Updated 2026-01-01 from Polymarket UI
    predictions: 52,
    wins: 29,
    losses: 3, // UI display filter - actual is ~21
  },
  '0x03a9f592e5eb9a34f0df6c41c3a37c1f063237ba': {
    name: '@Btlenc9',
    realized_pnl: 2508,
  },
};

interface ValidationResult {
  metric: string;
  our_value: number | string;
  ccr_value: number | string;
  ui_value: number | string;
  match: '✅' | '⚠️' | '❌' | '-';
  notes?: string;
}

async function validateWallet(wallet: string): Promise<void> {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`WALLET METRICS VALIDATION`);
  console.log(`${'═'.repeat(80)}`);

  const benchmark = UI_BENCHMARKS[wallet.toLowerCase()];
  console.log(`Wallet: ${wallet}`);
  console.log(`Name: ${benchmark?.name || 'Unknown'}\n`);

  // Get CCR-v1 metrics
  console.log('Computing CCR-v1 metrics...');
  const ccr = await computeCCRv1(wallet);

  // Get database metrics
  const tradesQuery = `
    SELECT
      countDistinct(event_id) as unique_trades,
      count() as raw_trades
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
      AND role = 'maker'
  `;
  const tradesResult = await client.query({ query: tradesQuery, format: 'JSONEachRow' });
  const trades = (await tradesResult.json())[0] as { unique_trades: string; raw_trades: string };

  const marketsQuery = `
    SELECT
      countDistinct(token_id) as unique_tokens,
      countDistinct(m.condition_id) as unique_conditions
    FROM (
      SELECT event_id, any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY event_id
    ) t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
  `;
  const marketsResult = await client.query({ query: marketsQuery, format: 'JSONEachRow' });
  const markets = (await marketsResult.json())[0] as { unique_tokens: string; unique_conditions: string };

  // Build validation results
  const results: ValidationResult[] = [];

  // Realized PnL
  const pnlDiff = benchmark?.realized_pnl
    ? Math.abs((ccr.realized_pnl - benchmark.realized_pnl) / benchmark.realized_pnl) * 100
    : null;
  results.push({
    metric: 'Realized PnL',
    our_value: '-',
    ccr_value: `$${ccr.realized_pnl.toLocaleString()}`,
    ui_value: benchmark?.realized_pnl ? `$${benchmark.realized_pnl.toLocaleString()}` : '?',
    match: pnlDiff !== null ? (pnlDiff <= 5 ? '✅' : pnlDiff <= 10 ? '⚠️' : '❌') : '-',
    notes: pnlDiff !== null ? `${pnlDiff >= 0 ? '+' : ''}${pnlDiff.toFixed(1)}%` : undefined,
  });

  // Win Count
  results.push({
    metric: 'Winning Positions',
    our_value: '-',
    ccr_value: ccr.win_count.toString(),
    ui_value: benchmark?.wins?.toString() || '?',
    match: benchmark?.wins !== undefined
      ? (ccr.win_count === benchmark.wins ? '✅' : '❌')
      : '-',
  });

  // Loss Count
  results.push({
    metric: 'Losing Positions',
    our_value: '-',
    ccr_value: ccr.loss_count.toString(),
    ui_value: benchmark?.losses?.toString() || '?',
    match: benchmark?.losses !== undefined ? '⚠️' : '-',
    notes: 'UI filters display',
  });

  // Win Rate
  results.push({
    metric: 'Win Rate',
    our_value: '-',
    ccr_value: `${(ccr.win_rate * 100).toFixed(1)}%`,
    ui_value: '?',
    match: '-',
  });

  // Total Trades
  results.push({
    metric: 'Total Trades',
    our_value: trades.unique_trades,
    ccr_value: ccr.total_trades.toString(),
    ui_value: '-',
    match: Number(trades.unique_trades) === ccr.total_trades ? '✅' : '❌',
  });

  // Markets Traded
  results.push({
    metric: 'Markets Traded',
    our_value: markets.unique_conditions,
    ccr_value: ccr.positions_count.toString(),
    ui_value: benchmark?.predictions?.toString() || '?',
    match: benchmark?.predictions !== undefined
      ? (Number(markets.unique_conditions) === benchmark.predictions ? '✅' : '⚠️')
      : '-',
  });

  // Resolved Count
  results.push({
    metric: 'Resolved Markets',
    our_value: '-',
    ccr_value: ccr.resolved_count.toString(),
    ui_value: '-',
    match: '-',
  });

  // Print results table
  console.log('\n┌────────────────────────┬─────────────────┬─────────────────┬─────────────────┬────────┬────────────────┐');
  console.log('│ Metric                 │ DB Query        │ CCR-v1          │ UI Value        │ Match  │ Notes          │');
  console.log('├────────────────────────┼─────────────────┼─────────────────┼─────────────────┼────────┼────────────────┤');

  for (const r of results) {
    const metric = r.metric.padEnd(22);
    const our = String(r.our_value).padEnd(15);
    const ccr_val = String(r.ccr_value).padEnd(15);
    const ui = String(r.ui_value).padEnd(15);
    const match = r.match.padEnd(6);
    const notes = (r.notes || '').padEnd(14);
    console.log(`│ ${metric} │ ${our} │ ${ccr_val} │ ${ui} │ ${match} │ ${notes} │`);
  }

  console.log('└────────────────────────┴─────────────────┴─────────────────┴─────────────────┴────────┴────────────────┘');

  // Full CCR-v1 output
  console.log('\n📊 Full CCR-v1 Metrics:');
  console.log(JSON.stringify(ccr, null, 2));

  await client.close();
}

// Run
const wallet = process.argv[2] || '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';
validateWallet(wallet).catch(console.error);
