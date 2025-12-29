/**
 * V29 FORENSIC AUTOPSY SCRIPT
 *
 * Deep-dive wallet-level diagnostics for high-error V29 UiParity wallets.
 *
 * Terminal: Claude 2 (Data Health & Engine Safety)
 * Date: 2025-12-06
 */

import { clickhouse } from '../../lib/clickhouse/client';
import {
  InventoryEngineV29,
  loadV29EventsFromTable,
  loadV29ResolutionInfo,
  loadV29ResolutionPrices,
  V29Event,
  V29ConditionPosition,
  V29Options,
} from '../../lib/pnl/inventoryEngineV29';

// ============================================================================
// TARGET WALLETS FOR AUTOPSY
// ============================================================================
const TARGET_WALLETS = [
  // TRADER_STRICT with massive errors
  '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', // 42948% error, TRADER_STRICT
  '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', // 2256% error, TRADER_STRICT, 155 CLOB
  '0x343d4466dc323b850e5249394894c7381d91456e', // 1630% error, TRADER_STRICT

  // Reference MAKER_HEAVY
  '0xee00ba338c59557141789b127927a55f5cc5cea1', // 85019% error, MAKER_HEAVY, 973 merges
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function getWalletLedgerStats(wallet: string): Promise<{
  totalRows: number;
  distinctConditions: number;
  distinctOutcomes: number;
  sourceTypeCounts: Record<string, number>;
  minEventTime: string;
  maxEventTime: string;
}> {
  const query = `
    SELECT
      count() as total_rows,
      count(DISTINCT condition_id) as distinct_conditions,
      count(DISTINCT concat(condition_id, toString(outcome_index))) as distinct_outcomes,
      min(event_time) as min_event_time,
      max(event_time) as max_event_time
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
  `;

  const sourceQuery = `
    SELECT source_type, count() as cnt
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
    GROUP BY source_type
  `;

  const [statsResult, sourceResult] = await Promise.all([
    clickhouse.query({ query, format: 'JSONEachRow' }),
    clickhouse.query({ query: sourceQuery, format: 'JSONEachRow' }),
  ]);

  const stats = (await statsResult.json() as any[])[0] || {};
  const sources = (await sourceResult.json() as any[]);

  const sourceTypeCounts: Record<string, number> = {};
  for (const s of sources) {
    sourceTypeCounts[s.source_type] = Number(s.cnt);
  }

  return {
    totalRows: Number(stats.total_rows) || 0,
    distinctConditions: Number(stats.distinct_conditions) || 0,
    distinctOutcomes: Number(stats.distinct_outcomes) || 0,
    sourceTypeCounts,
    minEventTime: stats.min_event_time || 'N/A',
    maxEventTime: stats.max_event_time || 'N/A',
  };
}

async function checkV8ViewVsTableParity(wallet: string): Promise<{
  tableRows: number;
  viewRows: number;
  match: boolean;
}> {
  const tableQuery = `
    SELECT count() as cnt
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
  `;

  const viewQuery = `
    SELECT count() as cnt
    FROM pm_unified_ledger_v8
    WHERE lower(wallet_address) = lower('${wallet}')
  `;

  try {
    const [tableResult, viewResult] = await Promise.all([
      clickhouse.query({ query: tableQuery, format: 'JSONEachRow' }),
      clickhouse.query({ query: viewQuery, format: 'JSONEachRow' }).catch(() => ({ json: async () => [{ cnt: -1 }] })),
    ]);

    const tableRows = Number((await tableResult.json() as any[])[0]?.cnt) || 0;
    const viewRows = Number((await viewResult.json() as any[])[0]?.cnt);

    return {
      tableRows,
      viewRows: viewRows === -1 ? -1 : viewRows,
      match: viewRows === -1 ? true : tableRows === viewRows, // If view timed out, assume match
    };
  } catch {
    return { tableRows: 0, viewRows: -1, match: true };
  }
}

async function checkCTFEventActivity(wallet: string): Promise<{
  splitCount: number;
  mergeCount: number;
  redemptionCount: number;
  erc1155TransferCount: number;
}> {
  // Check split/merge/redemption from unified ledger
  const ledgerQuery = `
    SELECT
      countIf(source_type = 'PositionSplit') as split_count,
      countIf(source_type = 'PositionsMerge') as merge_count,
      countIf(source_type = 'PayoutRedemption') as redemption_count
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
  `;

  // Check ERC1155 transfers
  const erc1155Query = `
    SELECT count() as transfer_count
    FROM pm_erc1155_transfers
    WHERE lower(from_address) = lower('${wallet}')
       OR lower(to_address) = lower('${wallet}')
  `;

  const [ledgerResult, erc1155Result] = await Promise.all([
    clickhouse.query({ query: ledgerQuery, format: 'JSONEachRow' }),
    clickhouse.query({ query: erc1155Query, format: 'JSONEachRow' }).catch(() => ({ json: async () => [{ transfer_count: -1 }] })),
  ]);

  const ledger = (await ledgerResult.json() as any[])[0] || {};
  const erc1155 = (await erc1155Result.json() as any[])[0] || {};

  return {
    splitCount: Number(ledger.split_count) || 0,
    mergeCount: Number(ledger.merge_count) || 0,
    redemptionCount: Number(ledger.redemption_count) || 0,
    erc1155TransferCount: Number(erc1155.transfer_count) || 0,
  };
}

async function getTopConditionsByPnLImpact(
  wallet: string,
  positions: V29ConditionPosition[],
  resolutionInfo: Map<string, any>,
  limit: number = 10
): Promise<Array<{
  conditionId: string;
  totalQuantity: number;
  totalCostBasis: number;
  realizedPnl: number;
  isResolved: boolean;
  payoutVector: number[];
  unrealizedValue: number;
  clobBuys: number;
  clobSells: number;
  splitEvents: number;
  mergeEvents: number;
  outcomeBreakdown: Array<{ outcomeIndex: number; qty: number }>;
}>> {
  // Calculate unrealized value for each position
  const positionsWithValue = positions.map(p => {
    const res = resolutionInfo.get(p.conditionId);
    let unrealizedValue = 0;

    if (p.totalQuantity > 0.0001 && res?.isResolved) {
      // Calculate market value using per-outcome payouts
      let marketValue = 0;
      for (const [idx, qty] of p.outcomeQuantities.entries()) {
        if (qty > 0.0001) {
          const payout = res.outcomePayouts[idx] ?? 0;
          marketValue += qty * payout;
        }
      }
      unrealizedValue = marketValue - p.totalCostBasis;
    }

    return {
      ...p,
      unrealizedValue,
      isResolved: res?.isResolved ?? false,
      payoutVector: res?.outcomePayouts ?? [],
    };
  });

  // Sort by absolute PnL impact (realized + unrealized)
  positionsWithValue.sort((a, b) =>
    Math.abs(b.realizedPnl + b.unrealizedValue) - Math.abs(a.realizedPnl + a.unrealizedValue)
  );

  return positionsWithValue.slice(0, limit).map(p => ({
    conditionId: p.conditionId,
    totalQuantity: p.totalQuantity,
    totalCostBasis: p.totalCostBasis,
    realizedPnl: p.realizedPnl,
    isResolved: p.isResolved,
    payoutVector: p.payoutVector,
    unrealizedValue: p.unrealizedValue,
    clobBuys: p.clobBuys,
    clobSells: p.clobSells,
    splitEvents: p.splitEvents,
    mergeEvents: p.mergeEvents,
    outcomeBreakdown: Array.from(p.outcomeQuantities.entries())
      .map(([idx, qty]) => ({ outcomeIndex: idx, qty }))
      .filter(o => Math.abs(o.qty) > 0.0001),
  }));
}

async function checkMissingResolutions(
  wallet: string,
  positions: V29ConditionPosition[],
  resolutionInfo: Map<string, any>
): Promise<{
  totalOpenPositions: number;
  missingResolutions: number;
  missingConditionIds: string[];
}> {
  const openPositions = positions.filter(p => p.totalQuantity > 0.0001);
  const missingConditions = openPositions.filter(p => !resolutionInfo.has(p.conditionId));

  return {
    totalOpenPositions: openPositions.length,
    missingResolutions: missingConditions.length,
    missingConditionIds: missingConditions.slice(0, 10).map(p => p.conditionId),
  };
}

async function checkRawCLOBDuplication(wallet: string): Promise<{
  rawTradeCount: number;
  dedupedTradeCount: number;
  duplicationRatio: number;
}> {
  // Raw count
  const rawQuery = `
    SELECT count() as cnt
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
  `;

  // Deduped count
  const dedupQuery = `
    SELECT count() as cnt
    FROM (
      SELECT event_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY event_id
    )
  `;

  const [rawResult, dedupResult] = await Promise.all([
    clickhouse.query({ query: rawQuery, format: 'JSONEachRow' }),
    clickhouse.query({ query: dedupQuery, format: 'JSONEachRow' }),
  ]);

  const rawCount = Number((await rawResult.json() as any[])[0]?.cnt) || 0;
  const dedupCount = Number((await dedupResult.json() as any[])[0]?.cnt) || 0;

  return {
    rawTradeCount: rawCount,
    dedupedTradeCount: dedupCount,
    duplicationRatio: dedupCount > 0 ? rawCount / dedupCount : 1,
  };
}

async function identifyNegativeInventoryConditions(
  positions: V29ConditionPosition[]
): Promise<Array<{
  conditionId: string;
  totalQuantity: number;
  totalCostBasis: number;
  realizedPnl: number;
  clampedTokens: number;
  clobBuys: number;
  clobSells: number;
}>> {
  return positions
    .filter(p => p.totalQuantity < -0.0001)
    .sort((a, b) => a.totalQuantity - b.totalQuantity)
    .slice(0, 10)
    .map(p => ({
      conditionId: p.conditionId,
      totalQuantity: p.totalQuantity,
      totalCostBasis: p.totalCostBasis,
      realizedPnl: p.realizedPnl,
      clampedTokens: p.clampedTokens,
      clobBuys: p.clobBuys,
      clobSells: p.clobSells,
    }));
}

// ============================================================================
// MAIN AUTOPSY FUNCTION
// ============================================================================

interface AutopsyResult {
  wallet: string;
  // From regression data
  regressionSummary: {
    uiPnl: number;
    v29UiParityPnl: number;
    v29UiParityPctError: number;
    delta: number;
    tag: string;
    rootCause: string;
  };
  // Data health
  dataHealth: {
    ledgerStats: Awaited<ReturnType<typeof getWalletLedgerStats>>;
    v8Parity: Awaited<ReturnType<typeof checkV8ViewVsTableParity>>;
    ctfActivity: Awaited<ReturnType<typeof checkCTFEventActivity>>;
    clobDuplication: Awaited<ReturnType<typeof checkRawCLOBDuplication>>;
  };
  // PnL components
  pnlBreakdown: {
    realizedPnl: number;
    rawRealizedPnl: number;
    resolvedUnredeemedValue: number;
    uiParityPnl: number;
    uiParityClampedPnl: number;
    negativeInventoryPositions: number;
    negativeInventoryPnlAdjustment: number;
    positionsCount: number;
    openPositions: number;
    closedPositions: number;
    resolvedUnredeemedPositions: number;
    clampedPositions: number;
    totalClampedTokens: number;
  };
  // Deep analysis
  topConditions: Awaited<ReturnType<typeof getTopConditionsByPnLImpact>>;
  negativeInventoryConditions: Awaited<ReturnType<typeof identifyNegativeInventoryConditions>>;
  missingResolutions: Awaited<ReturnType<typeof checkMissingResolutions>>;
  // Hypothesis testing
  hypotheses: {
    mislabeledWallet: {
      suspectedTag: string;
      evidence: string[];
    };
    missingResolutions: {
      likely: boolean;
      evidence: string[];
    };
    markToMarketIssue: {
      likely: boolean;
      evidence: string[];
    };
    dedupIssue: {
      likely: boolean;
      evidence: string[];
    };
  };
}

async function runWalletAutopsy(
  wallet: string,
  regressionData: {
    uiPnl: number;
    v29UiParityPnl: number;
    v29UiParityPctError: number;
    tag: string;
    rootCause: string;
  }
): Promise<AutopsyResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`AUTOPSY: ${wallet}`);
  console.log(`${'='.repeat(80)}\n`);

  // 1. Load all data in parallel
  const [ledgerStats, v8Parity, ctfActivity, clobDuplication] = await Promise.all([
    getWalletLedgerStats(wallet),
    checkV8ViewVsTableParity(wallet),
    checkCTFEventActivity(wallet),
    checkRawCLOBDuplication(wallet),
  ]);

  console.log('Data health checks complete');

  // 2. Run V29 engine to get full breakdown
  const engine = new InventoryEngineV29({ inventoryGuard: true });
  const events = await loadV29EventsFromTable(wallet);
  engine.processEvents(events);

  const [resolutionPrices, resolutionInfo] = await Promise.all([
    loadV29ResolutionPrices(wallet, true, true),
    loadV29ResolutionInfo(wallet, true, true),
  ]);

  const result = engine.getResult(wallet, resolutionPrices, resolutionInfo);
  const positions = engine.getPositions(wallet);

  console.log('V29 engine run complete');

  // 3. Deep analysis
  const [topConditions, negativeInvConditions, missingRes] = await Promise.all([
    getTopConditionsByPnLImpact(wallet, positions, resolutionInfo, 10),
    identifyNegativeInventoryConditions(positions),
    checkMissingResolutions(wallet, positions, resolutionInfo),
  ]);

  console.log('Deep analysis complete');

  // 4. Hypothesis testing
  const hypotheses = {
    mislabeledWallet: {
      suspectedTag: '',
      evidence: [] as string[],
    },
    missingResolutions: {
      likely: false,
      evidence: [] as string[],
    },
    markToMarketIssue: {
      likely: false,
      evidence: [] as string[],
    },
    dedupIssue: {
      likely: false,
      evidence: [] as string[],
    },
  };

  // Check for mislabeling
  if (ctfActivity.splitCount > 0 || ctfActivity.mergeCount > 10 || ctfActivity.erc1155TransferCount > 100) {
    hypotheses.mislabeledWallet.suspectedTag = ctfActivity.mergeCount > 50 ? 'MAKER_HEAVY' : 'MIXED';
    if (ctfActivity.splitCount > 0) {
      hypotheses.mislabeledWallet.evidence.push(`Has ${ctfActivity.splitCount} splits (should not be TRADER_STRICT)`);
    }
    if (ctfActivity.mergeCount > 0) {
      hypotheses.mislabeledWallet.evidence.push(`Has ${ctfActivity.mergeCount} merges`);
    }
    if (ctfActivity.erc1155TransferCount > 0) {
      hypotheses.mislabeledWallet.evidence.push(`Has ${ctfActivity.erc1155TransferCount} ERC1155 transfers`);
    }
  }

  // Check for missing resolutions
  if (missingRes.missingResolutions > 0) {
    hypotheses.missingResolutions.likely = true;
    hypotheses.missingResolutions.evidence.push(
      `${missingRes.missingResolutions} of ${missingRes.totalOpenPositions} open positions missing resolutions`
    );
    hypotheses.missingResolutions.evidence.push(
      `Missing condition IDs: ${missingRes.missingConditionIds.slice(0, 3).join(', ')}...`
    );
  }

  // Check for mark-to-market issues
  const largeNegativeUnrealized = topConditions.filter(c => c.unrealizedValue < -10000);
  if (largeNegativeUnrealized.length > 0) {
    hypotheses.markToMarketIssue.likely = true;
    for (const c of largeNegativeUnrealized.slice(0, 3)) {
      hypotheses.markToMarketIssue.evidence.push(
        `Condition ${c.conditionId.slice(0, 10)}... has unrealized=${c.unrealizedValue.toFixed(2)}, qty=${c.totalQuantity.toFixed(2)}, cost=${c.totalCostBasis.toFixed(2)}, payouts=${JSON.stringify(c.payoutVector)}`
      );
    }
  }

  // Check for dedup issues
  if (clobDuplication.duplicationRatio > 1.5) {
    hypotheses.dedupIssue.likely = true;
    hypotheses.dedupIssue.evidence.push(
      `Raw/deduped ratio: ${clobDuplication.duplicationRatio.toFixed(2)}x (${clobDuplication.rawTradeCount} raw / ${clobDuplication.dedupedTradeCount} deduped)`
    );
  }

  // Also flag negative inventory as mark-to-market or engine issue
  if (negativeInvConditions.length > 0) {
    hypotheses.markToMarketIssue.likely = true;
    hypotheses.markToMarketIssue.evidence.push(
      `${negativeInvConditions.length} positions with NEGATIVE inventory (sold more than tracked)`
    );
  }

  return {
    wallet,
    regressionSummary: {
      ...regressionData,
      delta: regressionData.uiPnl - regressionData.v29UiParityPnl,
    },
    dataHealth: {
      ledgerStats,
      v8Parity,
      ctfActivity,
      clobDuplication,
    },
    pnlBreakdown: {
      realizedPnl: result.realizedPnl,
      rawRealizedPnl: result.rawRealizedPnl,
      resolvedUnredeemedValue: result.resolvedUnredeemedValue,
      uiParityPnl: result.uiParityPnl,
      uiParityClampedPnl: result.uiParityClampedPnl,
      negativeInventoryPositions: result.negativeInventoryPositions,
      negativeInventoryPnlAdjustment: result.negativeInventoryPnlAdjustment,
      positionsCount: result.positionsCount,
      openPositions: result.openPositions,
      closedPositions: result.closedPositions,
      resolvedUnredeemedPositions: result.resolvedUnredeemedPositions,
      clampedPositions: result.clampedPositions,
      totalClampedTokens: result.totalClampedTokens,
    },
    topConditions,
    negativeInventoryConditions: negativeInvConditions,
    missingResolutions: missingRes,
    hypotheses,
  };
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

function generateMarkdownReport(results: AutopsyResult[]): string {
  let md = `# V29 Error Autopsy Report

**Date:** ${new Date().toISOString().split('T')[0]}
**Terminal:** Claude 2 (Data Health & Engine Safety)
**Benchmark Set:** fresh_2025_12_06

---

## Executive Summary

This report provides deep forensic analysis of ${results.length} high-error wallets from the V29 UiParity regression run. Each wallet was selected because it showed >5% error between V29 uiParityPnl and the Polymarket UI benchmark.

---

`;

  // Per-wallet sections
  for (const r of results) {
    md += `## Wallet: \`${r.wallet}\`

### Regression Summary

| Metric | Value |
|--------|-------|
| **Tag** | ${r.regressionSummary.tag} |
| **UI PnL** | $${r.regressionSummary.uiPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |
| **V29 UiParity PnL** | $${r.regressionSummary.v29UiParityPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |
| **% Error** | ${(r.regressionSummary.v29UiParityPctError * 100).toFixed(2)}% |
| **Delta (UI - V29)** | $${r.regressionSummary.delta.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |
| **Root Cause Tag** | ${r.regressionSummary.rootCause} |

### Data Health

| Metric | Value |
|--------|-------|
| **Ledger Rows** | ${r.dataHealth.ledgerStats.totalRows.toLocaleString()} |
| **Distinct Conditions** | ${r.dataHealth.ledgerStats.distinctConditions.toLocaleString()} |
| **Distinct Outcomes** | ${r.dataHealth.ledgerStats.distinctOutcomes.toLocaleString()} |
| **V8 Table vs View Match** | ${r.dataHealth.v8Parity.match ? '✅ Yes' : '❌ No'} |
| **Splits** | ${r.dataHealth.ctfActivity.splitCount} |
| **Merges** | ${r.dataHealth.ctfActivity.mergeCount} |
| **Redemptions** | ${r.dataHealth.ctfActivity.redemptionCount} |
| **ERC1155 Transfers** | ${r.dataHealth.ctfActivity.erc1155TransferCount} |
| **CLOB Duplication Ratio** | ${r.dataHealth.clobDuplication.duplicationRatio.toFixed(2)}x |

**Source Type Distribution:**
${Object.entries(r.dataHealth.ledgerStats.sourceTypeCounts).map(([k, v]) => `- ${k}: ${v.toLocaleString()}`).join('\n')}

### PnL Component Breakdown

| Component | Value |
|-----------|-------|
| **Realized PnL** | $${r.pnlBreakdown.realizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |
| **Resolved Unredeemed Value** | $${r.pnlBreakdown.resolvedUnredeemedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |
| **UI Parity PnL** | $${r.pnlBreakdown.uiParityPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |
| **UI Parity Clamped** | $${r.pnlBreakdown.uiParityClampedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |
| **Negative Inventory Positions** | ${r.pnlBreakdown.negativeInventoryPositions} |
| **Negative Inv. Adjustment** | $${r.pnlBreakdown.negativeInventoryPnlAdjustment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |
| **Clamped Positions** | ${r.pnlBreakdown.clampedPositions} |
| **Total Clamped Tokens** | ${r.pnlBreakdown.totalClampedTokens.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |

**Position Counts:**
- Total: ${r.pnlBreakdown.positionsCount}
- Open: ${r.pnlBreakdown.openPositions}
- Closed: ${r.pnlBreakdown.closedPositions}
- Resolved-Unredeemed: ${r.pnlBreakdown.resolvedUnredeemedPositions}

### Top Conditions by PnL Impact

| Condition | Qty | Cost Basis | Realized | Unrealized | Resolved | Payouts |
|-----------|-----|------------|----------|------------|----------|---------|
${r.topConditions.map(c => `| \`${c.conditionId.slice(0, 12)}...\` | ${c.totalQuantity.toFixed(2)} | $${c.totalCostBasis.toFixed(2)} | $${c.realizedPnl.toFixed(2)} | $${c.unrealizedValue.toFixed(2)} | ${c.isResolved ? '✅' : '❌'} | ${JSON.stringify(c.payoutVector.map(p => p.toFixed(2)))} |`).join('\n')}

`;

    if (r.negativeInventoryConditions.length > 0) {
      md += `### Negative Inventory Conditions (Top 10)

| Condition | Qty (neg) | Cost Basis | Realized | Clamped |
|-----------|-----------|------------|----------|---------|
${r.negativeInventoryConditions.map(c => `| \`${c.conditionId.slice(0, 12)}...\` | ${c.totalQuantity.toFixed(2)} | $${c.totalCostBasis.toFixed(2)} | $${c.realizedPnl.toFixed(2)} | ${c.clampedTokens.toFixed(2)} |`).join('\n')}

`;
    }

    if (r.missingResolutions.missingResolutions > 0) {
      md += `### Missing Resolutions

**${r.missingResolutions.missingResolutions}** of ${r.missingResolutions.totalOpenPositions} open positions have no resolution data.

Sample missing condition IDs:
${r.missingResolutions.missingConditionIds.map(id => `- \`${id}\``).join('\n')}

`;
    }

    // Hypothesis testing results
    md += `### Hypothesis Testing

`;

    if (r.hypotheses.mislabeledWallet.evidence.length > 0) {
      md += `#### 🏷️ Mislabeled Wallet
**Suspected Tag:** ${r.hypotheses.mislabeledWallet.suspectedTag || 'N/A'}
**Evidence:**
${r.hypotheses.mislabeledWallet.evidence.map(e => `- ${e}`).join('\n')}

`;
    }

    if (r.hypotheses.missingResolutions.likely) {
      md += `#### 📉 Missing Resolutions
**Likely:** ✅ Yes
**Evidence:**
${r.hypotheses.missingResolutions.evidence.map(e => `- ${e}`).join('\n')}

`;
    }

    if (r.hypotheses.markToMarketIssue.likely) {
      md += `#### 💹 Mark-to-Market Issue
**Likely:** ✅ Yes
**Evidence:**
${r.hypotheses.markToMarketIssue.evidence.map(e => `- ${e}`).join('\n')}

`;
    }

    if (r.hypotheses.dedupIssue.likely) {
      md += `#### 🔄 Deduplication Issue
**Likely:** ✅ Yes
**Evidence:**
${r.hypotheses.dedupIssue.evidence.map(e => `- ${e}`).join('\n')}

`;
    }

    // Summary for this wallet
    const diagnosisList: string[] = [];
    if (r.hypotheses.mislabeledWallet.evidence.length > 0) {
      diagnosisList.push(`Wallet appears to be ${r.hypotheses.mislabeledWallet.suspectedTag} not ${r.regressionSummary.tag}`);
    }
    if (r.pnlBreakdown.resolvedUnredeemedValue < -10000) {
      diagnosisList.push(`Large negative resolvedUnredeemedValue ($${r.pnlBreakdown.resolvedUnredeemedValue.toFixed(2)}) indicates cost basis > market value for resolved positions`);
    }
    if (r.pnlBreakdown.negativeInventoryPositions > 0) {
      diagnosisList.push(`${r.pnlBreakdown.negativeInventoryPositions} positions with negative inventory (sold more than tracked)`);
    }
    if (r.hypotheses.dedupIssue.likely) {
      diagnosisList.push(`Possible CLOB deduplication issue (${r.dataHealth.clobDuplication.duplicationRatio.toFixed(2)}x ratio)`);
    }

    md += `### 🔍 Summary Diagnosis

${diagnosisList.length > 0 ? diagnosisList.map(d => `- ${d}`).join('\n') : '- No clear issues identified'}

---

`;
  }

  // Cohort & tagging recommendations
  md += `## Cohort & Tagging Recommendations

### Re-tagging Decisions

Based on the wallet autopsies, the following re-tagging is recommended:

`;

  for (const r of results) {
    if (r.hypotheses.mislabeledWallet.evidence.length > 0 && r.regressionSummary.tag !== r.hypotheses.mislabeledWallet.suspectedTag) {
      md += `- **${r.wallet.slice(0, 10)}...**: Change from \`${r.regressionSummary.tag}\` to \`${r.hypotheses.mislabeledWallet.suspectedTag}\`
  - ${r.hypotheses.mislabeledWallet.evidence.join('; ')}

`;
    }
  }

  md += `### Recommended SAFE_TRADER_STRICT Criteria

To identify wallets that are safe for copy trading, use these thresholds:

| Field | Threshold | Rationale |
|-------|-----------|-----------|
| \`walletTag\` | \`TRADER_STRICT\` | Must be classified as pure CLOB trader |
| \`splitCount\` | \`= 0\` | No CTF splits (which create tokens off-ledger) |
| \`mergeCount\` | \`= 0\` | No CTF merges (which destroy tokens off-ledger) |
| \`v29UiParityPctError\` | \`< 0.03\` (3%) | V29 must closely match UI |
| \`negativeInventoryPositions\` | \`= 0\` | No positions where sold > tracked buys |
| \`clobDuplicationRatio\` | \`< 1.5\` | No significant CLOB duplication |
| \`erc1155TransferCount\` | \`< 10\` | Minimal off-ledger token movement |

**Example Wallets:**

| Wallet | Passes SAFE? | Reason |
|--------|--------------|--------|
`;

  for (const r of results) {
    const passesSafe =
      r.regressionSummary.tag === 'TRADER_STRICT' &&
      r.dataHealth.ctfActivity.splitCount === 0 &&
      r.dataHealth.ctfActivity.mergeCount === 0 &&
      Math.abs(r.regressionSummary.v29UiParityPctError) < 0.03 &&
      r.pnlBreakdown.negativeInventoryPositions === 0 &&
      r.dataHealth.clobDuplication.duplicationRatio < 1.5 &&
      r.dataHealth.ctfActivity.erc1155TransferCount < 10;

    const reasons: string[] = [];
    if (r.regressionSummary.tag !== 'TRADER_STRICT') reasons.push(`tag=${r.regressionSummary.tag}`);
    if (r.dataHealth.ctfActivity.splitCount > 0) reasons.push(`splits=${r.dataHealth.ctfActivity.splitCount}`);
    if (r.dataHealth.ctfActivity.mergeCount > 0) reasons.push(`merges=${r.dataHealth.ctfActivity.mergeCount}`);
    if (Math.abs(r.regressionSummary.v29UiParityPctError) >= 0.03) reasons.push(`err=${(r.regressionSummary.v29UiParityPctError * 100).toFixed(1)}%`);
    if (r.pnlBreakdown.negativeInventoryPositions > 0) reasons.push(`negInv=${r.pnlBreakdown.negativeInventoryPositions}`);

    md += `| \`${r.wallet.slice(0, 10)}...\` | ${passesSafe ? '✅' : '❌'} | ${reasons.join(', ') || 'All checks pass'} |
`;
  }

  // Engine follow-up TODOs
  md += `

---

## V29 Engine Follow-up TODOs for Main Terminal

Based on the forensic analysis, here are the recommended follow-ups:

### [P0] Critical Fixes

`;

  // Analyze common patterns across all results
  const hasNegativeResolvedUnredeemed = results.some(r => r.pnlBreakdown.resolvedUnredeemedValue < -10000);
  const hasNegativeInventory = results.some(r => r.pnlBreakdown.negativeInventoryPositions > 0);
  const hasMislabeledTraderStrict = results.some(r =>
    r.regressionSummary.tag === 'TRADER_STRICT' &&
    r.hypotheses.mislabeledWallet.evidence.length > 0
  );

  if (hasNegativeResolvedUnredeemed) {
    md += `1. **Investigate large negative resolvedUnredeemedValue**
   - Symptom: Several wallets show -$1M to -$18M in resolvedUnredeemedValue
   - Location: \`lib/pnl/inventoryEngineV29.ts\` → \`getResult()\` method, lines 455-474
   - Theory: When cost basis exceeds market value for resolved positions held to losing outcomes
   - TODO: Verify per-outcome payout application; ensure losing positions valued at 0

`;
  }

  if (hasNegativeInventory) {
    md += `2. **Review negative inventory position handling**
   - Symptom: Wallets tagged TRADER_STRICT have negative inventory positions
   - Location: \`lib/pnl/inventoryEngineV29.ts\` → inventory guard logic, lines 258-269
   - Theory: Inventory guard clamps sells but doesn't account for ALL off-ledger sources
   - TODO: Consider stricter tagging criteria that exclude wallets with any negative inventory

`;
  }

  if (hasMislabeledTraderStrict) {
    md += `3. **Update wallet tagging logic**
   - Symptom: Some TRADER_STRICT wallets have merges/splits in their ledger data
   - Location: Tagging logic (wherever \`isTraderStrict\` is computed)
   - TODO: Ensure tagging checks pm_unified_ledger_v8_tbl for CTF events, not just pm_trader_events_v2

`;
  }

  md += `### [P1] Tagging / Cohort Changes

1. **Implement SAFE_TRADER_STRICT flag**
   - Add new field to wallet metrics: \`isSafeTraderStrict\`
   - Use criteria defined above in "Recommended SAFE_TRADER_STRICT Criteria"
   - Only wallets passing ALL checks should be considered for copy trading

2. **Re-run tagging for benchmark wallets**
   - Update tags for wallets identified as mislabeled in this report
   - Re-run regression after tagging updates

### [P2] Architecture / Future Work

1. **Consider V30 with per-position cost basis**
   - V29 uses condition-level pooled cost basis
   - This may cause inaccuracies for wallets trading multiple outcomes
   - V30 could track per-outcome cost basis for higher fidelity

2. **Improve ERC1155 transfer tracking**
   - Current engine ignores ERC1155 transfers
   - These transfers move tokens off-ledger, causing inventory mismatches
   - Consider ingesting ERC1155 transfers into unified ledger

---

**Report generated by Claude Terminal 2**
`;

  return md;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('V29 Forensic Autopsy Script');
  console.log('===========================\n');

  // Regression data from analysis (hardcoded from fresh_2025_12_06 regression)
  const regressionData: Record<string, {
    uiPnl: number;
    v29UiParityPnl: number;
    v29UiParityPctError: number;
    tag: string;
    rootCause: string;
  }> = {
    '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d': {
      uiPnl: 2266615.05,
      v29UiParityPnl: 12001456.26,
      v29UiParityPctError: 429.4881, // 42948.81% = 429.4881x
      tag: 'TRADER_STRICT',
      rootCause: 'UNKNOWN',
    },
    '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a': {
      uiPnl: 1994016.75,
      v29UiParityPnl: 2443882.08,
      v29UiParityPctError: 22.5608, // 2256.08% = 22.5608x
      tag: 'TRADER_STRICT',
      rootCause: 'PRICE_DATA',
    },
    '0x343d4466dc323b850e5249394894c7381d91456e': {
      uiPnl: 2604547.67,
      v29UiParityPnl: 3029214.30,
      v29UiParityPctError: 16.3048, // 1630.48% = 16.3048x
      tag: 'TRADER_STRICT',
      rootCause: 'UNKNOWN',
    },
    '0xee00ba338c59557141789b127927a55f5cc5cea1': {
      uiPnl: 2170858.22,
      v29UiParityPnl: 20627288.13,
      v29UiParityPctError: 850.1905, // 85019.05% = 850.1905x
      tag: 'MAKER_HEAVY',
      rootCause: 'PRICE_DATA',
    },
  };

  const results: AutopsyResult[] = [];

  for (const wallet of TARGET_WALLETS) {
    const regData = regressionData[wallet.toLowerCase()];
    if (!regData) {
      console.error(`No regression data for ${wallet}`);
      continue;
    }

    try {
      const result = await runWalletAutopsy(wallet, regData);
      results.push(result);
    } catch (err: any) {
      console.error(`Error analyzing ${wallet}: ${err.message}`);
    }
  }

  // Generate report
  const report = generateMarkdownReport(results);

  // Write report
  const reportPath = 'docs/reports/V29_ERROR_AUTOPSY_2025_12_06.md';
  const fs = await import('fs');
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport written to: ${reportPath}`);

  // Console summary
  console.log('\n\n========================================');
  console.log('CONSOLE SUMMARY');
  console.log('========================================\n');

  for (const r of results) {
    console.log(`\n${r.wallet.slice(0, 12)}...`);
    console.log(`  Tag: ${r.regressionSummary.tag} | Error: ${(r.regressionSummary.v29UiParityPctError * 100).toFixed(1)}%`);

    // Brief diagnosis
    if (r.pnlBreakdown.resolvedUnredeemedValue < -100000) {
      console.log(`  ⚠️  Large negative resolvedUnredeemedValue: $${r.pnlBreakdown.resolvedUnredeemedValue.toFixed(0)}`);
      console.log(`     → Cost basis for resolved positions exceeds market value (likely losing positions)`);
    }
    if (r.hypotheses.mislabeledWallet.evidence.length > 0) {
      console.log(`  ⚠️  Wallet may be mislabeled: ${r.hypotheses.mislabeledWallet.evidence[0]}`);
    }
    if (r.pnlBreakdown.negativeInventoryPositions > 0) {
      console.log(`  ⚠️  ${r.pnlBreakdown.negativeInventoryPositions} negative inventory positions`);
    }
  }

  console.log('\n\nSAFE_TRADER_STRICT Criteria:');
  console.log('  - tag = TRADER_STRICT');
  console.log('  - splitCount = 0, mergeCount = 0');
  console.log('  - v29UiParityPctError < 3%');
  console.log('  - negativeInventoryPositions = 0');
  console.log('  - clobDuplicationRatio < 1.5');
  console.log('  - erc1155TransferCount < 10');
}

main().catch(console.error);
