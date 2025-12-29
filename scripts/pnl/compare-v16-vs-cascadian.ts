/**
 * Compare V16 vs pm_cascadian_pnl_v1_new
 *
 * Goal: Find exactly which conditions account for the ~347k difference
 * between V16 and the cascadian table.
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV16Engine } from '../../lib/pnl/uiActivityEngineV16';

const SMART_MONEY_1 = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

interface CascadianRow {
  condition_id: string;
  outcome_index: number;
  trade_cash_flow: number;
  final_shares: number;
  resolution_price: number | null;
  realized_pnl: number;
  is_resolved: number;
}

interface V16Position {
  condition_id: string;
  outcome_index: number;
  realized_pnl: number;
}

interface DiffRow {
  condition_id: string;
  outcome_index: number;
  cascadian_pnl: number;
  v16_pnl: number;
  delta: number;
  cascadian_cash_flow: number;
  cascadian_final_shares: number;
  cascadian_resolution_price: number | null;
}

async function loadCascadianData(wallet: string): Promise<Map<string, CascadianRow>> {
  const query = `
    SELECT
      condition_id,
      outcome_index,
      trade_cash_flow,
      final_shares,
      resolution_price,
      realized_pnl,
      is_resolved
    FROM pm_cascadian_pnl_v1_new
    WHERE lower(trader_wallet) = lower('${wallet}')
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const map = new Map<string, CascadianRow>();
  for (const r of rows) {
    const key = `${r.condition_id.toLowerCase()}_${r.outcome_index}`;
    map.set(key, {
      condition_id: r.condition_id.toLowerCase(),
      outcome_index: Number(r.outcome_index),
      trade_cash_flow: Number(r.trade_cash_flow),
      final_shares: Number(r.final_shares),
      resolution_price: r.resolution_price !== null ? Number(r.resolution_price) : null,
      realized_pnl: Number(r.realized_pnl),
      is_resolved: Number(r.is_resolved),
    });
  }

  return map;
}

async function loadV16Data(wallet: string): Promise<Map<string, V16Position>> {
  const engine = createV16Engine();
  const result = await engine.compute(wallet);

  const map = new Map<string, V16Position>();
  for (const pos of result.positions) {
    const key = `${pos.condition_id.toLowerCase()}_${pos.outcome_index}`;
    map.set(key, {
      condition_id: pos.condition_id.toLowerCase(),
      outcome_index: pos.outcome_index,
      realized_pnl: pos.realized_pnl,
    });
  }

  return map;
}

async function main() {
  console.log('='.repeat(120));
  console.log('V16 vs pm_cascadian_pnl_v1_new DIFF REPORT');
  console.log('='.repeat(120));
  console.log(`Wallet: Smart Money 1 (${SMART_MONEY_1.substring(0, 12)}...)`);
  console.log('');

  // Load data from both sources
  console.log('Loading cascadian data...');
  const cascadianData = await loadCascadianData(SMART_MONEY_1);
  console.log(`  Found ${cascadianData.size} condition/outcome pairs`);

  console.log('Running V16 engine...');
  const startTime = Date.now();
  const v16Data = await loadV16Data(SMART_MONEY_1);
  console.log(`  Found ${v16Data.size} condition/outcome pairs in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // Collect all keys from both sources
  const allKeys = new Set([...cascadianData.keys(), ...v16Data.keys()]);
  console.log(`  Total unique keys: ${allKeys.size}`);

  // Build diff rows
  const diffRows: DiffRow[] = [];

  for (const key of allKeys) {
    const cascadian = cascadianData.get(key);
    const v16 = v16Data.get(key);

    const cascadianPnl = cascadian?.realized_pnl ?? 0;
    const v16Pnl = v16?.realized_pnl ?? 0;
    const delta = v16Pnl - cascadianPnl;

    // Parse key to get condition_id and outcome_index
    const [conditionId, outcomeStr] = key.split('_');
    const outcomeIndex = parseInt(outcomeStr, 10);

    diffRows.push({
      condition_id: conditionId,
      outcome_index: outcomeIndex,
      cascadian_pnl: cascadianPnl,
      v16_pnl: v16Pnl,
      delta,
      cascadian_cash_flow: cascadian?.trade_cash_flow ?? 0,
      cascadian_final_shares: cascadian?.final_shares ?? 0,
      cascadian_resolution_price: cascadian?.resolution_price ?? null,
    });
  }

  // Sort by absolute delta descending
  diffRows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Print top 30 by delta
  console.log('');
  console.log('='.repeat(120));
  console.log('TOP 30 CONDITIONS BY |DELTA|');
  console.log('='.repeat(120));
  console.log(
    'Condition ID (first 20)  | Idx | Cascadian PnL    | V16 PnL          | Delta            | Cash Flow        | Final Shares'
  );
  console.log('-'.repeat(120));

  for (const row of diffRows.slice(0, 30)) {
    const condShort = row.condition_id.substring(0, 20);
    console.log(
      `${condShort.padEnd(24)} | ${row.outcome_index}   | $${row.cascadian_pnl.toLocaleString().padStart(14)} | $${row.v16_pnl.toLocaleString().padStart(14)} | $${row.delta.toLocaleString().padStart(14)} | $${row.cascadian_cash_flow.toLocaleString().padStart(14)} | ${row.cascadian_final_shares.toLocaleString().padStart(14)}`
    );
  }

  // Print summary
  console.log('');
  console.log('='.repeat(120));
  console.log('SUMMARY');
  console.log('='.repeat(120));

  const totalCascadian = diffRows.reduce((s, r) => s + r.cascadian_pnl, 0);
  const totalV16 = diffRows.reduce((s, r) => s + r.v16_pnl, 0);
  const totalDelta = diffRows.reduce((s, r) => s + r.delta, 0);

  console.log(`Total Cascadian PnL: $${totalCascadian.toLocaleString()}`);
  console.log(`Total V16 PnL:       $${totalV16.toLocaleString()}`);
  console.log(`Total Delta:         $${totalDelta.toLocaleString()}`);
  console.log(`UI Reported:         $332,563`);

  console.log('');
  console.log('Error analysis:');
  const cascadianVsUI = Math.abs(totalCascadian - 332563) / 332563 * 100;
  const v16VsUI = Math.abs(totalV16 - 332563) / 332563 * 100;
  const v16VsCascadian = Math.abs(totalV16 - totalCascadian) / Math.abs(totalCascadian) * 100;

  console.log(`  Cascadian vs UI:     ${cascadianVsUI.toFixed(1)}%`);
  console.log(`  V16 vs UI:           ${v16VsUI.toFixed(1)}%`);
  console.log(`  V16 vs Cascadian:    ${v16VsCascadian.toFixed(1)}%`);

  // Analyze where delta is concentrated
  console.log('');
  console.log('Delta concentration:');
  const top5Delta = diffRows.slice(0, 5).reduce((s, r) => s + r.delta, 0);
  const top10Delta = diffRows.slice(0, 10).reduce((s, r) => s + r.delta, 0);
  const top20Delta = diffRows.slice(0, 20).reduce((s, r) => s + r.delta, 0);

  console.log(`  Top 5 conditions:  $${top5Delta.toLocaleString()} (${(top5Delta / totalDelta * 100).toFixed(1)}% of total delta)`);
  console.log(`  Top 10 conditions: $${top10Delta.toLocaleString()} (${(top10Delta / totalDelta * 100).toFixed(1)}% of total delta)`);
  console.log(`  Top 20 conditions: $${top20Delta.toLocaleString()} (${(top20Delta / totalDelta * 100).toFixed(1)}% of total delta)`);

  // Show detailed breakdown for top 3 conditions
  console.log('');
  console.log('='.repeat(120));
  console.log('DETAILED BREAKDOWN: TOP 3 CONDITIONS');
  console.log('='.repeat(120));

  for (const row of diffRows.slice(0, 3)) {
    console.log('');
    console.log(`Condition: ${row.condition_id}`);
    console.log(`Outcome:   idx=${row.outcome_index}`);
    console.log(`  Cascadian:`);
    console.log(`    trade_cash_flow:   $${row.cascadian_cash_flow.toLocaleString()}`);
    console.log(`    final_shares:      ${row.cascadian_final_shares.toLocaleString()}`);
    console.log(`    resolution_price:  ${row.cascadian_resolution_price !== null ? `$${row.cascadian_resolution_price}` : 'N/A'}`);
    console.log(`    realized_pnl:      $${row.cascadian_pnl.toLocaleString()}`);
    console.log(`    Formula check:     cash_flow + (shares * res_price) = $${row.cascadian_resolution_price !== null ? (row.cascadian_cash_flow + row.cascadian_final_shares * row.cascadian_resolution_price).toLocaleString() : 'N/A'}`);
    console.log(`  V16:`);
    console.log(`    realized_pnl:      $${row.v16_pnl.toLocaleString()}`);
    console.log(`  Delta:               $${row.delta.toLocaleString()}`);
  }

  console.log('');
  console.log('='.repeat(120));
  console.log('REPORT COMPLETE');
  console.log('='.repeat(120));
}

main().catch(console.error);
