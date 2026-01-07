/**
 * FILL-LEVEL PROOF DEDUPE (Expert-Recommended Correct Strategy)
 *
 * Key insight from experts:
 * - TX-level maker-preferred is a heuristic, NOT proven correct
 * - True duplicates share: (tx_hash, token_id, side, usdc_amount, token_amount, trade_time)
 * - Paired-outcome legs (buy YES + sell NO) are NOT duplicates - different token_ids
 *
 * Rules:
 * 1. Group by fill key: (tx_hash, token_id, side, usdc_raw, tokens_raw, trade_time)
 * 2. If group has maker + taker (both count=1): keep one (prefer maker)
 * 3. If group has only one role: keep all (not a mirror)
 * 4. If group has >1 of either role: ambiguous, keep all and log
 *
 * CRITICAL: Use raw integers for keys, NOT floats!
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Test wallet - can be changed
const WALLET = process.argv[2] || '0xf918977ef9d3f101385eda508621d5f835fa9052';
const UI_PNL = parseFloat(process.argv[3] || '1.16');

interface RawTrade {
  event_id: string;
  token_id: string;
  side: 'buy' | 'sell';
  role: 'maker' | 'taker';
  usdc_raw: string; // Raw integer string, NOT divided
  tokens_raw: string; // Raw integer string, NOT divided
  trade_time: string;
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
}

function fillLevelProofDedupe(trades: RawTrade[]): RawTrade[] {
  // Group by fill key: (tx_hash, token_id, side, usdc_raw, tokens_raw, trade_time)
  // Using raw integers - NO float conversion for keying!
  const groups = new Map<string, RawTrade[]>();

  for (const t of trades) {
    // Build key from RAW values - critical for correct matching
    const key = `${t.tx_hash}|${t.token_id}|${t.side}|${t.usdc_raw}|${t.tokens_raw}|${t.trade_time}`;
    const arr = groups.get(key) || [];
    arr.push(t);
    groups.set(key, arr);
  }

  const out: RawTrade[] = [];
  let mirrorPairsDeduped = 0;
  let singleRoleKept = 0;
  let ambiguousKept = 0;

  for (const [key, group] of groups) {
    const makers = group.filter(t => t.role === 'maker');
    const takers = group.filter(t => t.role === 'taker');

    if (makers.length === 1 && takers.length === 1) {
      // PROVEN MIRROR: exact same fill, both perspectives
      // Keep one (prefer maker)
      out.push(makers[0]);
      mirrorPairsDeduped++;
    } else if (makers.length === 0 || takers.length === 0) {
      // SINGLE ROLE: not a mirror, keep all
      out.push(...group);
      singleRoleKept += group.length;
    } else {
      // AMBIGUOUS: >1 maker or >1 taker with same key
      // This shouldn't happen in clean data, keep all and log
      console.log(`  ⚠️ Ambiguous group: ${makers.length} makers, ${takers.length} takers`);
      console.log(`     Key: ...${key.slice(-80)}`);
      out.push(...group);
      ambiguousKept += group.length;
    }
  }

  console.log(`\n[Fill-Level Proof Dedupe Stats]`);
  console.log(`  Input trades: ${trades.length}`);
  console.log(`  Output trades: ${out.length}`);
  console.log(`  Mirror pairs deduped: ${mirrorPairsDeduped} (removed ${mirrorPairsDeduped} duplicates)`);
  console.log(`  Single-role groups kept: ${singleRoleKept}`);
  console.log(`  Ambiguous groups kept: ${ambiguousKept}`);

  return out;
}

async function main() {
  console.log('Testing FILL-LEVEL PROOF DEDUPE (Expert-Recommended)\n');
  console.log(`Wallet: ${WALLET}`);
  console.log(`Target UI PnL: $${UI_PNL}`);
  console.log('='.repeat(70));

  // Get ALL trades with RAW integer values
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

  console.log(`\nLoaded ${allTrades.length} total trades`);

  // Show breakdown by role
  const makers = allTrades.filter(t => t.role === 'maker');
  const takers = allTrades.filter(t => t.role === 'taker');
  console.log(`  Makers: ${makers.length}, Takers: ${takers.length}`);

  // Show sample fill keys to understand the data
  console.log('\n[Sample Fill Keys - First 5 groups]');
  const sampleGroups = new Map<string, RawTrade[]>();
  for (const t of allTrades) {
    const key = `${t.tx_hash}|${t.token_id}|${t.side}|${t.usdc_raw}|${t.tokens_raw}|${t.trade_time}`;
    const arr = sampleGroups.get(key) || [];
    arr.push(t);
    sampleGroups.set(key, arr);
  }

  let shown = 0;
  for (const [key, group] of sampleGroups) {
    if (shown < 5) {
      const makerCount = group.filter(t => t.role === 'maker').length;
      const takerCount = group.filter(t => t.role === 'taker').length;
      const status = (makerCount === 1 && takerCount === 1) ? '→ MIRROR (dedupe)' :
                     (makerCount > 0 && takerCount === 0) ? '→ MAKER-ONLY' :
                     (makerCount === 0 && takerCount > 0) ? '→ TAKER-ONLY' : '→ MIXED';
      console.log(`  [${makerCount}M/${takerCount}T] ${status}`);
      console.log(`    tx: ...${key.split('|')[0].slice(-12)}, token: ...${key.split('|')[1].slice(-8)}, ${group[0].side}`);
      shown++;
    }
  }

  // Apply fill-level proof dedupe
  const dedupedTrades = fillLevelProofDedupe(allTrades);

  // Aggregate by (condition_id, outcome_index)
  const positions = new Map<string, {
    cash_flow: number;
    final_tokens: number;
    condition_id: string;
    outcome_index: number;
  }>();

  for (const t of dedupedTrades) {
    const key = `${t.condition_id}|${t.outcome_index}`;
    const pos = positions.get(key) || {
      cash_flow: 0,
      final_tokens: 0,
      condition_id: t.condition_id,
      outcome_index: t.outcome_index,
    };

    // Convert to decimals for PnL calculation
    const usdc = Number(t.usdc_raw) / 1e6;
    const tokens = Number(t.tokens_raw) / 1e6;

    if (t.side === 'sell') {
      pos.cash_flow += usdc;
      pos.final_tokens -= tokens;
    } else {
      pos.cash_flow -= usdc;
      pos.final_tokens += tokens;
    }

    positions.set(key, pos);
  }

  // Get resolutions
  const conditionIds = [...new Set([...positions.values()].map(p => p.condition_id))];
  const condList = conditionIds.map(c => `'${c.toLowerCase()}'`).join(',');

  const resQuery = `
    SELECT lower(condition_id) as condition_id, payout_numerators
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

  // Calculate PnL
  console.log('\n\nPosition-level PnL:');
  console.log('Condition (last 12) | Outcome | Cash Flow | Tokens | Payout | PnL');
  console.log('-'.repeat(75));

  let totalPnl = 0;

  for (const [key, pos] of positions) {
    const payouts = resolutions.get(pos.condition_id.toLowerCase());
    if (!payouts) continue;

    const denom = payouts.reduce((a, b) => a + b, 0);
    const payout = denom > 0 ? payouts[pos.outcome_index] / denom : 0.5;

    const pnl = pos.cash_flow + (pos.final_tokens * payout);
    totalPnl += pnl;

    console.log(
      `...${pos.condition_id.slice(-12)} | ${pos.outcome_index.toString().padStart(7)} | ${pos.cash_flow.toFixed(2).padStart(9)} | ${pos.final_tokens.toFixed(2).padStart(6)} | ${payout.toFixed(2).padStart(6)} | ${pnl.toFixed(2).padStart(7)}`
    );
  }

  console.log('-'.repeat(75));
  console.log(`\nRESULTS:`);
  console.log(`  Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`  UI Target: $${UI_PNL}`);
  console.log(`  Error: ${((totalPnl - UI_PNL) / UI_PNL * 100).toFixed(1)}%`);
  console.log(`  Status: ${Math.abs((totalPnl - UI_PNL) / UI_PNL * 100) < 5 ? '✅ PASS' : '❌ FAIL'}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
