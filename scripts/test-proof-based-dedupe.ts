/**
 * Test proof-based deduplication strategy
 *
 * Strategy:
 * 1. Get ALL trades (both maker and taker) with RAW integer amounts
 * 2. Group by composite key: (tx_hash, token_id, side, usdc_raw, tokens_raw)
 * 3. If group has maker+taker pair → keep only one (they're the same fill)
 * 4. If group has same-role collisions → keep all (not provably duplicates)
 * 5. Apply V17 formula on deduped data
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';
const UI_PNL = 1.16;

interface RawTrade {
  event_id: string;
  token_id: string;
  side: 'buy' | 'sell';
  role: 'maker' | 'taker';
  usdc_raw: string;
  tokens_raw: string;
  trade_time: string;
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
}

/**
 * Proof-based dedupe: only remove rows when we can PROVE they're duplicates
 * (maker+taker pair with identical fill signature)
 */
function proofBasedDedupe(trades: RawTrade[]): RawTrade[] {
  // Group by fill signature (tx + token + side + amounts)
  const groups = new Map<string, RawTrade[]>();

  for (const t of trades) {
    // Key on RAW amounts (strings) to avoid float precision issues
    const key = `${t.tx_hash}|${t.token_id}|${t.side}|${t.usdc_raw}|${t.tokens_raw}`;
    const arr = groups.get(key) || [];
    arr.push(t);
    groups.set(key, arr);
  }

  const out: RawTrade[] = [];
  let duplicatePairsRemoved = 0;
  let sameRoleCollisions = 0;
  let ambiguousCases = 0;

  for (const [key, arr] of groups) {
    if (arr.length === 1) {
      // Single row - definitely keep
      out.push(arr[0]);
      continue;
    }

    const makers = arr.filter(t => t.role === 'maker');
    const takers = arr.filter(t => t.role === 'taker');

    // Case 1: Classic duplicate pair (1 maker, 1 taker) - keep one
    if (makers.length === 1 && takers.length === 1) {
      out.push(takers[0]); // Keep taker consistently (arbitrary choice)
      duplicatePairsRemoved++;
      continue;
    }

    // Case 2: Both roles present but not 1:1 - ambiguous, keep all
    if (makers.length > 0 && takers.length > 0) {
      out.push(...arr);
      ambiguousCases++;
      console.log(`  [WARN] Ambiguous: key=${key.slice(-40)}, makers=${makers.length}, takers=${takers.length}`);
      continue;
    }

    // Case 3: Same-role collisions - NOT provably duplicates, keep all
    // These could be legitimate multi-fills or backfill artifacts
    out.push(...arr);
    sameRoleCollisions++;
  }

  console.log(`\n[Dedupe Stats]`);
  console.log(`  Input trades: ${trades.length}`);
  console.log(`  Output trades: ${out.length}`);
  console.log(`  Duplicate pairs removed: ${duplicatePairsRemoved}`);
  console.log(`  Same-role collisions (kept all): ${sameRoleCollisions}`);
  console.log(`  Ambiguous cases (kept all): ${ambiguousCases}`);

  return out;
}

async function main() {
  console.log('Testing PROOF-BASED DEDUPE with V17 formula\n');
  console.log(`Wallet: ${WALLET}`);
  console.log(`Target UI PnL: $${UI_PNL}`);
  console.log('='.repeat(70));

  // Step 1: Get ALL trades with RAW amounts (no GROUP BY event_id)
  const tradeQuery = `
    SELECT
      event_id,
      token_id,
      side,
      role,
      toString(usdc_amount) as usdc_raw,
      toString(token_amount) as tokens_raw,
      trade_time,
      lower(concat('0x', hex(transaction_hash))) as tx_hash,
      m.condition_id,
      m.outcome_index
    FROM pm_trader_events_v2 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
      AND m.condition_id IS NOT NULL
    ORDER BY trade_time, event_id
  `;

  const tradeResult = await clickhouse.query({ query: tradeQuery, format: 'JSONEachRow' });
  const allTrades = (await tradeResult.json()) as RawTrade[];

  console.log(`\nLoaded ${allTrades.length} total trades (before dedupe)`);

  // Step 2: Apply proof-based dedupe
  const dedupedTrades = proofBasedDedupe(allTrades);

  // Step 3: Aggregate by (condition_id, outcome_index) and calculate PnL
  const positions = new Map<string, {
    cash_flow: number;
    final_tokens: number;
    condition_id: string;
    outcome_index: number;
    trade_count: number;
  }>();

  for (const t of dedupedTrades) {
    const key = `${t.condition_id}|${t.outcome_index}`;
    const pos = positions.get(key) || {
      cash_flow: 0,
      final_tokens: 0,
      condition_id: t.condition_id,
      outcome_index: t.outcome_index,
      trade_count: 0
    };

    const usdc = Number(t.usdc_raw) / 1e6;
    const tokens = Number(t.tokens_raw) / 1e6;

    if (t.side === 'sell') {
      pos.cash_flow += usdc;      // Sell = cash in
      pos.final_tokens -= tokens; // Sell = tokens out
    } else {
      pos.cash_flow -= usdc;      // Buy = cash out
      pos.final_tokens += tokens; // Buy = tokens in
    }
    pos.trade_count++;

    positions.set(key, pos);
  }

  // Step 4: Get resolutions
  const conditionIds = [...new Set([...positions.values()].map(p => p.condition_id))];
  const condList = conditionIds.map(c => `'${c.toLowerCase()}'`).join(',');

  const resQuery = `
    SELECT
      lower(condition_id) as condition_id,
      payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN (${condList || "''"})
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  const resolutions = new Map<string, number[]>();
  for (const row of resRows) {
    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        resolutions.set(row.condition_id, payouts);
      } catch { }
    }
  }

  // Step 5: Calculate PnL
  console.log('\n\nPosition-level PnL (V17 formula):');
  console.log('Condition (last 12) | Outcome | Cash Flow | Tokens | Payout | PnL');
  console.log('-'.repeat(75));

  let totalPnl = 0;
  let unresolvedCount = 0;

  for (const [key, pos] of positions) {
    const payouts = resolutions.get(pos.condition_id.toLowerCase());

    if (!payouts) {
      unresolvedCount++;
      // For unresolved: show position but PnL = 0 (or could estimate at current price)
      console.log(
        `...${pos.condition_id.slice(-12)} | ${pos.outcome_index.toString().padStart(7)} | ${pos.cash_flow.toFixed(2).padStart(9)} | ${pos.final_tokens.toFixed(2).padStart(6)} | UNRES | N/A`
      );
      continue;
    }

    const denom = payouts.reduce((a, b) => a + b, 0);
    const payout = denom > 0 ? payouts[pos.outcome_index] / denom : 0.5;

    // V17 formula: PnL = cash_flow + (final_tokens * resolution_price)
    const pnl = pos.cash_flow + (pos.final_tokens * payout);
    totalPnl += pnl;

    console.log(
      `...${pos.condition_id.slice(-12)} | ${pos.outcome_index.toString().padStart(7)} | ${pos.cash_flow.toFixed(2).padStart(9)} | ${pos.final_tokens.toFixed(2).padStart(6)} | ${payout.toFixed(2).padStart(6)} | ${pnl.toFixed(2).padStart(7)}`
    );
  }

  console.log('-'.repeat(75));
  console.log(`\nRESULTS:`);
  console.log(`  Resolved positions: ${positions.size - unresolvedCount}`);
  console.log(`  Unresolved positions: ${unresolvedCount}`);
  console.log(`  Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`  UI Target: $${UI_PNL}`);
  console.log(`  Error: ${((totalPnl - UI_PNL) / UI_PNL * 100).toFixed(1)}%`);
  console.log(`  Status: ${Math.abs((totalPnl - UI_PNL) / UI_PNL * 100) < 5 ? '✅ PASS' : '❌ FAIL'}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
