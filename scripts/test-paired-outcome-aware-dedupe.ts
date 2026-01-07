/**
 * Test PAIRED-OUTCOME-AWARE deduplication
 *
 * Key insight: Split transactions create paired-outcome trades:
 * - Buy YES (maker) + Sell NO (taker) in SAME transaction
 * - Both represent the SAME economic event
 * - Counting both would double-count PnL
 *
 * Strategy:
 * 1. Group trades by transaction hash
 * 2. For each tx:
 *    a. If it has Buy outcome_i + Sell outcome_j (i≠j, same condition):
 *       → This is a paired-outcome trade (split/merge)
 *       → Keep only ONE side (the buy side, which represents acquisition intent)
 *    b. If it has maker+taker for SAME outcome with identical amounts:
 *       → This is a true duplicate (same fill, two perspectives)
 *       → Keep only one
 *    c. Otherwise: keep all trades
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
 * Paired-outcome-aware deduplication
 */
function pairedOutcomeAwareDedupe(trades: RawTrade[]): RawTrade[] {
  // Group by transaction
  const txGroups = new Map<string, RawTrade[]>();
  for (const t of trades) {
    const arr = txGroups.get(t.tx_hash) || [];
    arr.push(t);
    txGroups.set(t.tx_hash, arr);
  }

  const out: RawTrade[] = [];
  let pairedOutcomesRemoved = 0;
  let duplicatePairsRemoved = 0;

  for (const [txHash, txTrades] of txGroups) {
    // Group by condition within this tx
    const conditionGroups = new Map<string, RawTrade[]>();
    for (const t of txTrades) {
      const arr = conditionGroups.get(t.condition_id) || [];
      arr.push(t);
      conditionGroups.set(t.condition_id, arr);
    }

    for (const [condId, condTrades] of conditionGroups) {
      // Check for paired-outcome pattern: Buy one outcome + Sell another in same condition
      const buys = condTrades.filter(t => t.side === 'buy');
      const sells = condTrades.filter(t => t.side === 'sell');

      // Check for paired-outcome (different outcomes, buy+sell)
      const buyOutcomes = new Set(buys.map(t => t.outcome_index));
      const sellOutcomes = new Set(sells.map(t => t.outcome_index));

      // If buys and sells target DIFFERENT outcomes, it's a paired-outcome trade
      const hasPairedOutcome = buys.length > 0 && sells.length > 0 &&
        [...buyOutcomes].some(o => !sellOutcomes.has(o)) &&
        [...sellOutcomes].some(o => !buyOutcomes.has(o));

      if (hasPairedOutcome) {
        // Keep only the BUY side (represents acquisition intent)
        out.push(...buys);
        pairedOutcomesRemoved += sells.length;
        continue;
      }

      // Check for same-outcome duplicates (maker+taker for same fill)
      // Group by outcome within this condition
      const outcomeGroups = new Map<number, RawTrade[]>();
      for (const t of condTrades) {
        const arr = outcomeGroups.get(t.outcome_index) || [];
        arr.push(t);
        outcomeGroups.set(t.outcome_index, arr);
      }

      for (const [outcome, outcomeTrades] of outcomeGroups) {
        // Further group by fill signature (side, amounts)
        const fillGroups = new Map<string, RawTrade[]>();
        for (const t of outcomeTrades) {
          const key = `${t.side}|${t.usdc_raw}|${t.tokens_raw}`;
          const arr = fillGroups.get(key) || [];
          arr.push(t);
          fillGroups.set(key, arr);
        }

        for (const [fillKey, fillTrades] of fillGroups) {
          if (fillTrades.length === 1) {
            out.push(fillTrades[0]);
            continue;
          }

          const makers = fillTrades.filter(t => t.role === 'maker');
          const takers = fillTrades.filter(t => t.role === 'taker');

          // Classic duplicate pair
          if (makers.length === 1 && takers.length === 1) {
            out.push(makers[0]); // Keep maker consistently
            duplicatePairsRemoved++;
            continue;
          }

          // Ambiguous: keep all
          out.push(...fillTrades);
        }
      }
    }
  }

  console.log(`\n[Paired-Outcome Dedupe Stats]`);
  console.log(`  Input trades: ${trades.length}`);
  console.log(`  Output trades: ${out.length}`);
  console.log(`  Paired-outcome sells removed: ${pairedOutcomesRemoved}`);
  console.log(`  Duplicate pairs removed: ${duplicatePairsRemoved}`);

  return out;
}

async function main() {
  console.log('Testing PAIRED-OUTCOME-AWARE DEDUPE with V17 formula\n');
  console.log(`Wallet: ${WALLET}`);
  console.log(`Target UI PnL: $${UI_PNL}`);
  console.log('='.repeat(70));

  // Step 1: Get ALL trades with RAW amounts
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

  // Show transaction breakdown
  const txGroups = new Map<string, RawTrade[]>();
  for (const t of allTrades) {
    const arr = txGroups.get(t.tx_hash) || [];
    arr.push(t);
    txGroups.set(t.tx_hash, arr);
  }

  console.log(`\nTransactions with paired outcomes:`);
  for (const [tx, trades] of txGroups) {
    const outcomes = new Set(trades.map(t => t.outcome_index));
    const sides = new Set(trades.map(t => t.side));
    if (outcomes.size > 1 || trades.length > 1) {
      console.log(`  ...${tx.slice(-8)}: ${trades.length} trades, outcomes=[${[...outcomes].join(',')}], sides=[${[...sides].join(',')}]`);
    }
  }

  // Step 2: Apply paired-outcome-aware dedupe
  const dedupedTrades = pairedOutcomeAwareDedupe(allTrades);

  // Step 3: Aggregate by (condition_id, outcome_index)
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
      pos.cash_flow += usdc;
      pos.final_tokens -= tokens;
    } else {
      pos.cash_flow -= usdc;
      pos.final_tokens += tokens;
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
