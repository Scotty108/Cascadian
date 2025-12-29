/**
 * CLOB-Only Outlier Forensics
 *
 * Deep investigation of 3 outlier wallets with >5% error between V29 and UI tooltip.
 * Analyzes ledger composition, PnL decomposition, and proposes hypotheses.
 *
 * Outliers:
 * 1. 0xd04f7c90bc6f15a29c744b4e974a19fcd7aa5acd - UI: -$21,562 vs V29: -$26,450 (22.7%)
 * 2. 0x61a10eac439207396992885a78dacc2ca1766657 - UI: -$3,216 vs V29: -$6,420 (99.6%)
 * 3. 0x65b8e0082af7a5f53356755520d596516421aca8 - UI: -$1,705 vs V29: -$1,349 (20.9%)
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

// Read truth dataset
const truthPath = path.join(__dirname, '../../data/regression/clob_only_truth_v1.json');
const truthData = JSON.parse(fs.readFileSync(truthPath, 'utf-8'));

const OUTLIER_WALLETS = [
  '0xd04f7c90bc6f15a29c744b4e974a19fcd7aa5acd',
  '0x61a10eac439207396992885a78dacc2ca1766657',
  '0x65b8e0082af7a5f53356755520d596516421aca8',
];

interface LedgerRow {
  source_type: string;
  condition_id: string;
  outcome_index: number;
  event_time: string;
  event_id: string;
  usdc_delta: number;
  token_delta: number;
  payout_numerators: string | null;
  payout_norm: number | null;
}

interface ConditionRollup {
  condition_id: string;
  outcome_index: number;
  total_usdc_delta: number;
  total_token_delta: number;
  clob_count: number;
  redemption_count: number;
  split_count: number;
  merge_count: number;
  has_resolution: boolean;
  resolution_price: number | null;
  final_shares: number;
  cash_flow: number;
  realized_pnl: number;
  first_event: string;
  last_event: string;
}

interface WalletForensics {
  wallet: string;
  uiPnl: number;
  v29Pnl: number;
  errorPct: number;
  eventComposition: {
    total: number;
    bySourceType: Record<string, number>;
    byCondition: Array<{
      condition_id: string;
      outcome_index: number;
      CLOB: number;
      PayoutRedemption: number;
      PositionSplit: number;
      PositionsMerge: number;
    }>;
    timeline: {
      first_event: string;
      last_event: string;
      span_days: number;
    };
  };
  ledgerRollups: {
    total_usdc_delta: number;
    total_token_delta: number;
    conditions: ConditionRollup[];
    redemptions_without_clob: number;
    negative_inventory_conditions: number;
  };
  engineDecomposition: {
    total_cash_flow: number;
    total_unrealized_shares: number;
    total_realized_pnl: number;
    total_unrealized_pnl: number;
    conditions_with_anomalies: Array<{
      condition_id: string;
      outcome_index: number;
      anomaly: string;
      cash_flow: number;
      final_shares: number;
      resolution_price: number | null;
      calculated_pnl: number;
    }>;
  };
  hypothesis: string[];
  rawLedger: LedgerRow[];
}

async function getWalletLedger(wallet: string): Promise<LedgerRow[]> {
  const query = `
    SELECT
      source_type,
      condition_id,
      outcome_index,
      event_time,
      event_id,
      usdc_delta,
      token_delta,
      payout_numerators,
      payout_norm
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
    ORDER BY event_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map((r: any) => ({
    source_type: r.source_type,
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    event_time: r.event_time,
    event_id: r.event_id,
    usdc_delta: Number(r.usdc_delta),
    token_delta: Number(r.token_delta),
    payout_numerators: r.payout_numerators,
    payout_norm: r.payout_norm ? Number(r.payout_norm) : null,
  }));
}

async function getV29Pnl(wallet: string): Promise<number> {
  // V29 uses cash flow engine on pm_unified_ledger_v8_tbl with payout_norm
  const query = `
    WITH position_agg AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) as cash_flow,
        sum(token_delta) as final_shares,
        any(payout_norm) as payout_norm
      FROM pm_unified_ledger_v8_tbl
      WHERE lower(wallet_address) = lower('${wallet}')
      GROUP BY condition_id, outcome_index
    )
    SELECT
      sum(cash_flow + (final_shares * COALESCE(payout_norm, 0))) as total_pnl,
      sum(CASE WHEN payout_norm IS NOT NULL THEN cash_flow + (final_shares * payout_norm) ELSE 0 END) as realized_pnl
    FROM position_agg
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows[0]?.total_pnl ? Number(rows[0].total_pnl) : 0;
}

function analyzeEventComposition(ledger: LedgerRow[]) {
  const bySourceType: Record<string, number> = {};
  const byConditionMap = new Map<string, any>();

  for (const row of ledger) {
    bySourceType[row.source_type] = (bySourceType[row.source_type] || 0) + 1;

    const key = `${row.condition_id}-${row.outcome_index}`;
    if (!byConditionMap.has(key)) {
      byConditionMap.set(key, {
        condition_id: row.condition_id,
        outcome_index: row.outcome_index,
        CLOB: 0,
        PayoutRedemption: 0,
        PositionSplit: 0,
        PositionsMerge: 0,
      });
    }
    const condData = byConditionMap.get(key);
    condData[row.source_type] = (condData[row.source_type] || 0) + 1;
  }

  const timeline = {
    first_event: ledger[0]?.event_time || '',
    last_event: ledger[ledger.length - 1]?.event_time || '',
    span_days: 0,
  };

  if (timeline.first_event && timeline.last_event) {
    const first = new Date(timeline.first_event);
    const last = new Date(timeline.last_event);
    timeline.span_days = Math.round((last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
  }

  return {
    total: ledger.length,
    bySourceType,
    byCondition: Array.from(byConditionMap.values()),
    timeline,
  };
}

function analyzeLedgerRollups(ledger: LedgerRow[]): {
  total_usdc_delta: number;
  total_token_delta: number;
  conditions: ConditionRollup[];
  redemptions_without_clob: number;
  negative_inventory_conditions: number;
} {
  const conditionMap = new Map<string, ConditionRollup>();

  for (const row of ledger) {
    const key = `${row.condition_id}-${row.outcome_index}`;

    if (!conditionMap.has(key)) {
      conditionMap.set(key, {
        condition_id: row.condition_id,
        outcome_index: row.outcome_index,
        total_usdc_delta: 0,
        total_token_delta: 0,
        clob_count: 0,
        redemption_count: 0,
        split_count: 0,
        merge_count: 0,
        has_resolution: false,
        resolution_price: null,
        final_shares: 0,
        cash_flow: 0,
        realized_pnl: 0,
        first_event: row.event_time,
        last_event: row.event_time,
      });
    }

    const cond = conditionMap.get(key)!;
    cond.total_usdc_delta += row.usdc_delta;
    cond.total_token_delta += row.token_delta;
    cond.last_event = row.event_time;

    if (row.source_type === 'CLOB') cond.clob_count++;
    if (row.source_type === 'PayoutRedemption') cond.redemption_count++;
    if (row.source_type === 'PositionSplit') cond.split_count++;
    if (row.source_type === 'PositionsMerge') cond.merge_count++;

    if (row.payout_norm !== null && row.payout_norm !== undefined) {
      cond.has_resolution = true;
      cond.resolution_price = row.payout_norm;
    }
  }

  // Calculate PnL for each condition
  const conditions = Array.from(conditionMap.values());
  for (const cond of conditions) {
    cond.cash_flow = cond.total_usdc_delta;
    cond.final_shares = cond.total_token_delta;

    if (cond.has_resolution && cond.resolution_price !== null) {
      cond.realized_pnl = cond.cash_flow + (cond.final_shares * cond.resolution_price);
    } else {
      cond.realized_pnl = 0;
    }
  }

  const total_usdc_delta = conditions.reduce((sum, c) => sum + c.total_usdc_delta, 0);
  const total_token_delta = conditions.reduce((sum, c) => sum + c.total_token_delta, 0);

  // Count redemptions without CLOB trades
  const redemptions_without_clob = conditions.filter(
    c => c.redemption_count > 0 && c.clob_count === 0
  ).length;

  // Count negative inventory
  const negative_inventory_conditions = conditions.filter(
    c => c.final_shares < -0.01
  ).length;

  return {
    total_usdc_delta,
    total_token_delta,
    conditions,
    redemptions_without_clob,
    negative_inventory_conditions,
  };
}

function analyzeEngineDecomposition(rollups: {
  conditions: ConditionRollup[];
}) {
  const total_cash_flow = rollups.conditions.reduce((sum, c) => sum + c.cash_flow, 0);
  const total_unrealized_shares = rollups.conditions
    .filter(c => !c.has_resolution)
    .reduce((sum, c) => sum + c.final_shares, 0);

  const total_realized_pnl = rollups.conditions
    .filter(c => c.has_resolution)
    .reduce((sum, c) => sum + c.realized_pnl, 0);

  const total_unrealized_pnl = rollups.conditions
    .filter(c => !c.has_resolution)
    .reduce((sum, c) => sum + (c.cash_flow + c.final_shares * 0.5), 0);

  const conditions_with_anomalies: Array<{
    condition_id: string;
    outcome_index: number;
    anomaly: string;
    cash_flow: number;
    final_shares: number;
    resolution_price: number | null;
    calculated_pnl: number;
  }> = [];

  for (const cond of rollups.conditions) {
    const anomalies: string[] = [];

    // Negative inventory
    if (cond.final_shares < -0.01) {
      anomalies.push('NEGATIVE_INVENTORY');
    }

    // Redemption without CLOB
    if (cond.redemption_count > 0 && cond.clob_count === 0) {
      anomalies.push('REDEMPTION_WITHOUT_CLOB');
    }

    // Large cash flow divergence
    if (cond.has_resolution && Math.abs(cond.cash_flow) > 1000 && Math.abs(cond.realized_pnl) < 100) {
      anomalies.push('LARGE_CASH_FLOW_SMALL_PNL');
    }

    // Unexpected resolution behavior
    if (cond.has_resolution && cond.resolution_price === 0 && cond.final_shares > 0) {
      anomalies.push('LOSING_SHARES_HELD');
    }

    if (anomalies.length > 0) {
      conditions_with_anomalies.push({
        condition_id: cond.condition_id,
        outcome_index: cond.outcome_index,
        anomaly: anomalies.join(', '),
        cash_flow: cond.cash_flow,
        final_shares: cond.final_shares,
        resolution_price: cond.resolution_price,
        calculated_pnl: cond.realized_pnl,
      });
    }
  }

  return {
    total_cash_flow,
    total_unrealized_shares,
    total_realized_pnl,
    total_unrealized_pnl,
    conditions_with_anomalies,
  };
}

function generateHypotheses(
  wallet: string,
  eventComp: any,
  ledgerRollups: any,
  engineDecomp: any,
  uiPnl: number,
  v29Pnl: number
): string[] {
  const hypotheses: string[] = [];

  // Check for redemptions without CLOB
  if (ledgerRollups.redemptions_without_clob > 0) {
    hypotheses.push('REDEMPTION_TIMING - Wallet has redemption events without matching CLOB trades');
  }

  // Check for negative inventory
  if (ledgerRollups.negative_inventory_conditions > 0) {
    hypotheses.push('NEG_INVENTORY_GUARD - Negative inventory detected, may indicate missing ledger rows or UI netting rule');
  }

  // Check if cash flow alone is closer to UI
  const cashFlowOnly = ledgerRollups.total_usdc_delta;
  const cashFlowError = Math.abs(cashFlowOnly - uiPnl);
  const v29Error = Math.abs(v29Pnl - uiPnl);

  if (cashFlowError < v29Error * 0.5) {
    hypotheses.push('UI_NETTING_RULE - UI may exclude unrealized positions or use different netting');
  }

  // Check for anomalies
  if (engineDecomp.conditions_with_anomalies.length > 0) {
    hypotheses.push(`MISSING_LEDGER_ROWS - ${engineDecomp.conditions_with_anomalies.length} conditions with anomalies detected`);
  }

  // Check event density
  const avgEventsPerCondition = eventComp.total / eventComp.byCondition.length;
  if (avgEventsPerCondition < 2) {
    hypotheses.push('LOW_EVENT_DENSITY - Average < 2 events per condition, may indicate incomplete data');
  }

  return hypotheses;
}

async function investigateWallet(wallet: string): Promise<WalletForensics> {
  console.log(`\n${'='.repeat(100)}`);
  console.log(`INVESTIGATING: ${wallet}`);
  console.log('='.repeat(100));

  // Get truth data
  const truthRecord = truthData.wallets.find((w: any) => w.wallet.toLowerCase() === wallet.toLowerCase());
  const uiPnl = truthRecord?.uiPnl || 0;

  // Get V29 PnL
  const v29Pnl = await getV29Pnl(wallet);
  const errorPct = uiPnl !== 0 ? Math.abs((v29Pnl - uiPnl) / uiPnl) * 100 : 999;

  console.log(`UI PnL:  ${uiPnl.toFixed(2)}`);
  console.log(`V29 PnL: ${v29Pnl.toFixed(2)}`);
  console.log(`Error:   ${errorPct.toFixed(1)}%`);

  // Get ledger
  const ledger = await getWalletLedger(wallet);
  console.log(`\nLedger rows: ${ledger.length}`);

  // Analyze
  const eventComposition = analyzeEventComposition(ledger);
  const ledgerRollups = analyzeLedgerRollups(ledger);
  const engineDecomposition = analyzeEngineDecomposition(ledgerRollups);
  const hypothesis = generateHypotheses(
    wallet,
    eventComposition,
    ledgerRollups,
    engineDecomposition,
    uiPnl,
    v29Pnl
  );

  console.log(`\nEvent Composition:`);
  console.log(`  ${JSON.stringify(eventComposition.bySourceType, null, 2)}`);
  console.log(`\nLedger Rollups:`);
  console.log(`  Total USDC delta: ${ledgerRollups.total_usdc_delta.toFixed(2)}`);
  console.log(`  Total token delta: ${ledgerRollups.total_token_delta.toFixed(2)}`);
  console.log(`  Conditions: ${ledgerRollups.conditions.length}`);
  console.log(`  Redemptions without CLOB: ${ledgerRollups.redemptions_without_clob}`);
  console.log(`  Negative inventory conditions: ${ledgerRollups.negative_inventory_conditions}`);

  console.log(`\nEngine Decomposition:`);
  console.log(`  Total cash flow: ${engineDecomposition.total_cash_flow.toFixed(2)}`);
  console.log(`  Total realized PnL: ${engineDecomposition.total_realized_pnl.toFixed(2)}`);
  console.log(`  Total unrealized PnL: ${engineDecomposition.total_unrealized_pnl.toFixed(2)}`);
  console.log(`  Anomalies: ${engineDecomposition.conditions_with_anomalies.length}`);

  if (engineDecomposition.conditions_with_anomalies.length > 0) {
    console.log(`\n  Anomaly Details:`);
    for (const anomaly of engineDecomposition.conditions_with_anomalies.slice(0, 5)) {
      console.log(`    - ${anomaly.condition_id.slice(0, 8)}... outcome ${anomaly.outcome_index}: ${anomaly.anomaly}`);
      console.log(`      Cash flow: ${anomaly.cash_flow.toFixed(2)}, Final shares: ${anomaly.final_shares.toFixed(2)}, PnL: ${anomaly.calculated_pnl.toFixed(2)}`);
    }
  }

  console.log(`\nHypotheses:`);
  for (const h of hypothesis) {
    console.log(`  - ${h}`);
  }

  return {
    wallet,
    uiPnl,
    v29Pnl,
    errorPct,
    eventComposition,
    ledgerRollups,
    engineDecomposition,
    hypothesis,
    rawLedger: ledger,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('CLOB-ONLY OUTLIER FORENSICS');
  console.log('='.repeat(100));
  console.log('Investigating 3 outlier wallets with >5% error between V29 and UI tooltip');
  console.log('');

  const results: WalletForensics[] = [];

  for (const wallet of OUTLIER_WALLETS) {
    const forensics = await investigateWallet(wallet);
    results.push(forensics);
  }

  // Write results
  const outputPath = path.join(__dirname, '../../tmp/outlier_forensics.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log(`\n${'='.repeat(100)}`);
  console.log(`RESULTS WRITTEN TO: ${outputPath}`);
  console.log('='.repeat(100));

  // Summary
  console.log('\nSUMMARY:');
  console.log('-'.repeat(100));
  for (const r of results) {
    console.log(`${r.wallet.slice(0, 10)}...`);
    console.log(`  UI: $${r.uiPnl.toFixed(2)} | V29: $${r.v29Pnl.toFixed(2)} | Error: ${r.errorPct.toFixed(1)}%`);
    console.log(`  Primary hypotheses: ${r.hypothesis.slice(0, 2).join(', ')}`);
    console.log('');
  }
}

main().catch(console.error);
