/**
 * Verify CCR-v1 Engine Against Polymarket UI Data
 *
 * Usage: npx tsx scripts/verify-ccr-v1-vs-ui.ts --user <username> --wallet <wallet_address>
 *
 * Prerequisites:
 *   1. Run ui-scrape-polymarket-profile.ts first to generate UI data
 *   2. Wallet address must be known for the username
 *
 * Checks:
 *   1. Realized PnL parity (closed positions)
 *   2. Unrealized PnL parity (optional, requires mark-to-market)
 *   3. Position-level mapping and diff analysis
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { clickhouse } from '../lib/clickhouse/client';

// Known wallet mappings
const WALLET_MAP: Record<string, string> = {
  'lheo': '0x8cd8cc9a4e40bbbf44b226f98e5f6d2d69bf8fb8',
  'f918': '0xf918977ef9d3f101385eda508621d5f835fa9052',
};

// Parse args
const args = process.argv.slice(2);
const userIdx = args.indexOf('--user');
const walletIdx = args.indexOf('--wallet');

const USER = userIdx >= 0 ? args[userIdx + 1] : 'Lheo';
const WALLET = walletIdx >= 0 ? args[walletIdx + 1] : WALLET_MAP[USER.toLowerCase()];

if (!WALLET) {
  console.error(`No wallet found for user "${USER}". Use --wallet <address>`);
  process.exit(1);
}

interface ScrapedData {
  profileStats: {
    profitLoss: string;
    positionsValue: string;
    predictions: string;
  };
  activePositions: Array<{
    marketTitle: string;
    outcome: string;
    shares: string;
    avgPrice: string;
    currentPrice: string;
    positionValue: string;
    unrealizedPnl: string;
    marketUrl: string;
  }>;
  closedPositions: Array<{
    marketTitle: string;
    outcome: string;
    shares: string;
    avgPrice: string;
    realizedPnl: string;
    won: boolean;
    marketUrl: string;
  }>;
  activity: Array<{
    timestamp: string;
    action: string;
    marketTitle: string;
    outcome: string;
    shares: string;
    price: string;
    amount: string;
    marketUrl: string;
  }>;
}

interface EnginePosition {
  condition_id: string;
  outcome_index: number;
  cash_flow: number;
  final_shares: number;
  resolution_price: number;
  realized_pnl: number;
  is_resolved: boolean;
}

interface RawTrade {
  event_id: string;
  token_id: string;
  side: 'buy' | 'sell';
  role: 'maker' | 'taker';
  usdc: number;
  tokens: number;
  trade_time: string;
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
}

/**
 * Proof-based fill deduplication
 * Key: (tx_hash, token_id, side, usdc_raw, tokens_raw, trade_time)
 * If group has exactly 1 maker + 1 taker → keep maker (deterministic)
 * Otherwise keep all
 */
function proofBasedDedupe(trades: RawTrade[]): RawTrade[] {
  const groups = new Map<string, RawTrade[]>();

  for (const t of trades) {
    // Use rounded values for comparison (6 decimal precision)
    const usdcKey = Math.round(t.usdc * 1e6);
    const tokensKey = Math.round(t.tokens * 1e6);
    const key = `${t.tx_hash}|${t.token_id}|${t.side}|${usdcKey}|${tokensKey}|${t.trade_time}`;
    const arr = groups.get(key) || [];
    arr.push(t);
    groups.set(key, arr);
  }

  const out: RawTrade[] = [];
  let deduped = 0;
  let ambiguous = 0;

  for (const [key, arr] of groups) {
    if (arr.length === 1) {
      out.push(arr[0]);
      continue;
    }

    const makers = arr.filter(t => t.role === 'maker');
    const takers = arr.filter(t => t.role === 'taker');

    // Classic duplicate pair: 1 maker + 1 taker
    if (makers.length === 1 && takers.length === 1) {
      out.push(makers[0]); // Keep maker consistently
      deduped++;
      continue;
    }

    // Ambiguous: keep all and log
    out.push(...arr);
    if (arr.length > 2 || (makers.length > 0 && takers.length > 0)) {
      ambiguous++;
    }
  }

  console.log(`  [Dedupe] Input: ${trades.length}, Output: ${out.length}, Pairs removed: ${deduped}, Ambiguous: ${ambiguous}`);
  return out;
}

/**
 * TX-level maker-preferred deduplication (alternative strategy)
 * If tx has ANY maker trades → keep ONLY makers
 * If tx has ONLY takers → keep takers
 */
function txLevelMakerPreferred(trades: RawTrade[]): RawTrade[] {
  const txGroups = new Map<string, RawTrade[]>();
  for (const t of trades) {
    const arr = txGroups.get(t.tx_hash) || [];
    arr.push(t);
    txGroups.set(t.tx_hash, arr);
  }

  const out: RawTrade[] = [];
  let takersDropped = 0;
  let takerOnlyTxKept = 0;

  for (const [txHash, txTrades] of txGroups) {
    const makers = txTrades.filter(t => t.role === 'maker');
    const takers = txTrades.filter(t => t.role === 'taker');

    if (makers.length > 0) {
      out.push(...makers);
      takersDropped += takers.length;
    } else {
      out.push(...takers);
      takerOnlyTxKept++;
    }
  }

  console.log(`  [TX-Level Dedupe] Input: ${trades.length}, Output: ${out.length}, Takers dropped: ${takersDropped}, Taker-only txs: ${takerOnlyTxKept}`);
  return out;
}

async function loadAllTrades(wallet: string): Promise<RawTrade[]> {
  const query = `
    SELECT
      event_id,
      token_id,
      side,
      role,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      trade_time,
      lower(concat('0x', hex(transaction_hash))) as tx_hash,
      m.condition_id,
      m.outcome_index
    FROM pm_trader_events_v2 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
      AND m.condition_id IS NOT NULL
    ORDER BY trade_time, event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as RawTrade[];
}

async function loadResolutions(conditionIds: string[]): Promise<Map<string, { payouts: number[], resolved: boolean }>> {
  if (conditionIds.length === 0) return new Map();

  const condList = conditionIds.map(c => `'${c.toLowerCase()}'`).join(',');
  const query = `
    SELECT
      lower(condition_id) as condition_id,
      payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN (${condList})
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const resolutions = new Map<string, { payouts: number[], resolved: boolean }>();
  for (const row of rows) {
    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        resolutions.set(row.condition_id, { payouts, resolved: true });
      } catch {}
    }
  }
  return resolutions;
}

function calculatePositions(trades: RawTrade[], resolutions: Map<string, { payouts: number[], resolved: boolean }>): EnginePosition[] {
  // Aggregate by (condition_id, outcome_index)
  const posMap = new Map<string, { cash_flow: number; tokens: number; condition_id: string; outcome_index: number }>();

  for (const t of trades) {
    const key = `${t.condition_id}|${t.outcome_index}`;
    const pos = posMap.get(key) || {
      cash_flow: 0,
      tokens: 0,
      condition_id: t.condition_id,
      outcome_index: t.outcome_index
    };

    if (t.side === 'sell') {
      pos.cash_flow += t.usdc;
      pos.tokens -= t.tokens;
    } else {
      pos.cash_flow -= t.usdc;
      pos.tokens += t.tokens;
    }
    posMap.set(key, pos);
  }

  // Calculate PnL
  const positions: EnginePosition[] = [];
  for (const [key, pos] of posMap) {
    const res = resolutions.get(pos.condition_id.toLowerCase());
    let resolution_price = 0;
    let is_resolved = false;

    if (res && res.resolved) {
      const denom = res.payouts.reduce((a, b) => a + b, 0);
      resolution_price = denom > 0 ? res.payouts[pos.outcome_index] / denom : 0;
      is_resolved = true;
    }

    const realized_pnl = pos.cash_flow + (pos.tokens * resolution_price);

    positions.push({
      condition_id: pos.condition_id,
      outcome_index: pos.outcome_index,
      cash_flow: pos.cash_flow,
      final_shares: pos.tokens,
      resolution_price,
      realized_pnl: is_resolved ? realized_pnl : 0,
      is_resolved
    });
  }

  return positions;
}

async function main() {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`CCR-v1 vs UI Verification`);
  console.log(`${'='.repeat(70)}`);
  console.log(`User: ${USER}`);
  console.log(`Wallet: ${WALLET}`);

  // Load scraped UI data
  const uiDataPath = path.join(process.cwd(), 'tmp', `polymarket_ui_${USER.toLowerCase()}.json`);
  if (!fs.existsSync(uiDataPath)) {
    console.error(`\nUI data not found at ${uiDataPath}`);
    console.error(`Run first: npx tsx scripts/ui-scrape-polymarket-profile.ts ${USER}`);
    process.exit(1);
  }

  const uiData: ScrapedData = JSON.parse(fs.readFileSync(uiDataPath, 'utf-8'));
  console.log(`\n[UI Data Loaded]`);
  console.log(`  Profile P/L: $${uiData.profileStats.profitLoss}`);
  console.log(`  Active Positions: ${uiData.activePositions.length}`);
  console.log(`  Closed Positions: ${uiData.closedPositions.length}`);
  console.log(`  Activity Items: ${uiData.activity.length}`);

  // Calculate UI totals
  const uiClosedPnl = uiData.closedPositions.reduce((sum, p) => sum + (parseFloat(p.realizedPnl) || 0), 0);
  const uiActivePnl = uiData.activePositions.reduce((sum, p) => sum + (parseFloat(p.unrealizedPnl) || 0), 0);
  const uiTotalPnl = parseFloat(uiData.profileStats.profitLoss) || 0;

  console.log(`\n[UI PnL Breakdown]`);
  console.log(`  Closed (Realized): $${uiClosedPnl.toFixed(2)}`);
  console.log(`  Active (Unrealized): $${uiActivePnl.toFixed(2)}`);
  console.log(`  Profile Total: $${uiTotalPnl.toFixed(2)}`);
  console.log(`  Computed Total: $${(uiClosedPnl + uiActivePnl).toFixed(2)}`);

  // Load trades from ClickHouse
  console.log(`\n[Loading Trades from ClickHouse]`);
  const allTrades = await loadAllTrades(WALLET);
  console.log(`  Total trades: ${allTrades.length}`);

  // Test both dedupe strategies
  console.log(`\n[Testing Dedupe Strategies]`);

  // Strategy 1: Proof-based
  console.log(`\nStrategy 1: Proof-based dedupe`);
  const proofDeduped = proofBasedDedupe(allTrades);

  // Strategy 2: TX-level maker-preferred
  console.log(`\nStrategy 2: TX-level maker-preferred`);
  const txDeduped = txLevelMakerPreferred(allTrades);

  // Get condition IDs
  const conditionIds = [...new Set(allTrades.map(t => t.condition_id))];
  console.log(`\n[Loading Resolutions for ${conditionIds.length} conditions]`);
  const resolutions = await loadResolutions(conditionIds);
  console.log(`  Resolved: ${resolutions.size}`);

  // Calculate positions for each strategy
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[Proof-Based Dedupe Results]`);
  console.log(`${'='.repeat(70)}`);
  const proofPositions = calculatePositions(proofDeduped, resolutions);
  const proofResolved = proofPositions.filter(p => p.is_resolved);
  const proofUnresolved = proofPositions.filter(p => !p.is_resolved);
  const proofRealizedPnl = proofResolved.reduce((sum, p) => sum + p.realized_pnl, 0);

  console.log(`  Resolved positions: ${proofResolved.length}`);
  console.log(`  Unresolved positions: ${proofUnresolved.length}`);
  console.log(`  Engine Realized PnL: $${proofRealizedPnl.toFixed(2)}`);
  console.log(`  UI Closed PnL: $${uiClosedPnl.toFixed(2)}`);
  const proofError = uiClosedPnl !== 0 ? ((proofRealizedPnl - uiClosedPnl) / Math.abs(uiClosedPnl)) * 100 : 0;
  console.log(`  Error: ${proofError.toFixed(1)}%`);
  console.log(`  Status: ${Math.abs(proofError) < 5 ? '✅ PASS' : '❌ FAIL'}`);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[TX-Level Maker-Preferred Results]`);
  console.log(`${'='.repeat(70)}`);
  const txPositions = calculatePositions(txDeduped, resolutions);
  const txResolved = txPositions.filter(p => p.is_resolved);
  const txUnresolved = txPositions.filter(p => !p.is_resolved);
  const txRealizedPnl = txResolved.reduce((sum, p) => sum + p.realized_pnl, 0);

  console.log(`  Resolved positions: ${txResolved.length}`);
  console.log(`  Unresolved positions: ${txUnresolved.length}`);
  console.log(`  Engine Realized PnL: $${txRealizedPnl.toFixed(2)}`);
  console.log(`  UI Closed PnL: $${uiClosedPnl.toFixed(2)}`);
  const txError = uiClosedPnl !== 0 ? ((txRealizedPnl - uiClosedPnl) / Math.abs(uiClosedPnl)) * 100 : 0;
  console.log(`  Error: ${txError.toFixed(1)}%`);
  console.log(`  Status: ${Math.abs(txError) < 5 ? '✅ PASS' : '❌ FAIL'}`);

  // Show top position diffs
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[Top Position Details - TX-Level Strategy]`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\nResolved positions (sorted by absolute PnL):`);
  console.log(`${'Condition (last 12)'.padEnd(20)} | ${'Outcome'.padEnd(8)} | ${'Cash Flow'.padEnd(12)} | ${'Shares'.padEnd(10)} | ${'Price'.padEnd(8)} | ${'PnL'.padEnd(10)}`);
  console.log('-'.repeat(80));

  const sortedResolved = [...txResolved].sort((a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl));
  for (const pos of sortedResolved.slice(0, 15)) {
    console.log(
      `...${pos.condition_id.slice(-12).padEnd(17)} | ` +
      `${pos.outcome_index.toString().padEnd(8)} | ` +
      `$${pos.cash_flow.toFixed(2).padStart(10)} | ` +
      `${pos.final_shares.toFixed(2).padStart(9)} | ` +
      `${pos.resolution_price.toFixed(2).padStart(7)} | ` +
      `$${pos.realized_pnl.toFixed(2).padStart(8)}`
    );
  }

  // Show unresolved positions
  if (txUnresolved.length > 0) {
    console.log(`\nUnresolved positions (${txUnresolved.length}):`);
    console.log(`${'Condition (last 12)'.padEnd(20)} | ${'Outcome'.padEnd(8)} | ${'Cash Flow'.padEnd(12)} | ${'Shares'.padEnd(10)}`);
    console.log('-'.repeat(60));
    const sortedUnresolved = [...txUnresolved].sort((a, b) => Math.abs(b.cash_flow) - Math.abs(a.cash_flow));
    for (const pos of sortedUnresolved.slice(0, 10)) {
      console.log(
        `...${pos.condition_id.slice(-12).padEnd(17)} | ` +
        `${pos.outcome_index.toString().padEnd(8)} | ` +
        `$${pos.cash_flow.toFixed(2).padStart(10)} | ` +
        `${pos.final_shares.toFixed(2).padStart(9)}`
      );
    }
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log(`[VERIFICATION SUMMARY]`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\nUI Data:`);
  console.log(`  Profile Total P/L: $${uiTotalPnl.toFixed(2)}`);
  console.log(`  Closed (Realized): $${uiClosedPnl.toFixed(2)}`);
  console.log(`  Active (Unrealized): $${uiActivePnl.toFixed(2)}`);
  console.log(`\nEngine Results (TX-Level Maker-Preferred):`);
  console.log(`  Realized PnL: $${txRealizedPnl.toFixed(2)}`);
  console.log(`  Error vs UI Closed: ${txError.toFixed(1)}%`);
  console.log(`\nNote: Engine calculates realized-only. UI total includes unrealized.`);
  console.log(`To match UI total, implement mark-to-market for active positions.`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
