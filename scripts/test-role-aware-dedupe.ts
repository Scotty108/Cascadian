/**
 * Test ROLE-AWARE deduplication (Universal Strategy)
 *
 * Key insight: The ROLE field tells us if a trade is "primary" vs "byproduct":
 * - MAKER trades = intentional orders placed by the wallet
 * - TAKER trades = either (a) hitting existing orders, or (b) byproducts from splits
 *
 * For paired-outcome transactions (Buy A + Sell B):
 * - MAKER is always the primary (intentional) trade
 * - TAKER is always the byproduct (unwanted token being sold)
 *
 * Strategy per transaction:
 * 1. If has MAKER + TAKER on DIFFERENT outcomes → Keep only MAKER (taker is byproduct)
 * 2. If has MAKER + TAKER on SAME outcome with same amounts → Keep one (true duplicate)
 * 3. If has only TAKER (no maker in tx) → Keep (primary trade for taker-heavy wallets)
 * 4. If has only MAKER → Keep
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

function roleAwareDedupe(trades: RawTrade[]): RawTrade[] {
  // Group by transaction
  const txGroups = new Map<string, RawTrade[]>();
  for (const t of trades) {
    const arr = txGroups.get(t.tx_hash) || [];
    arr.push(t);
    txGroups.set(t.tx_hash, arr);
  }

  const out: RawTrade[] = [];
  let byproductsRemoved = 0;
  let duplicatesRemoved = 0;

  for (const [txHash, txTrades] of txGroups) {
    const makers = txTrades.filter(t => t.role === 'maker');
    const takers = txTrades.filter(t => t.role === 'taker');

    const makerOutcomes = new Set(makers.map(t => t.outcome_index));
    const takerOutcomes = new Set(takers.map(t => t.outcome_index));

    // Case 1: Has both makers and takers on DIFFERENT outcomes → paired-outcome trade
    const hasOnlyMakerOutcomes = [...makerOutcomes].some(o => !takerOutcomes.has(o));
    const hasOnlyTakerOutcomes = [...takerOutcomes].some(o => !makerOutcomes.has(o));

    if (makers.length > 0 && takers.length > 0 && (hasOnlyMakerOutcomes || hasOnlyTakerOutcomes)) {
      // This is a paired-outcome transaction
      // Keep only MAKER trades (takers are byproducts)
      out.push(...makers);
      byproductsRemoved += takers.length;
      continue;
    }

    // Case 2: Same-outcome duplicates (maker + taker on same outcome with same amounts)
    if (makers.length > 0 && takers.length > 0) {
      // Group by (outcome, side, amounts)
      const groups = new Map<string, RawTrade[]>();
      for (const t of txTrades) {
        const key = `${t.outcome_index}|${t.side}|${t.usdc_raw}|${t.tokens_raw}`;
        const arr = groups.get(key) || [];
        arr.push(t);
        groups.set(key, arr);
      }

      for (const [key, group] of groups) {
        if (group.length === 1) {
          out.push(group[0]);
        } else {
          // Multiple trades with same signature - keep one
          out.push(group[0]);
          duplicatesRemoved += group.length - 1;
        }
      }
      continue;
    }

    // Case 3: Only takers (no makers) → these are primary trades, keep all
    if (makers.length === 0) {
      out.push(...takers);
      continue;
    }

    // Case 4: Only makers (no takers) → keep all
    out.push(...makers);
  }

  console.log(`\n[Role-Aware Dedupe Stats]`);
  console.log(`  Input trades: ${trades.length}`);
  console.log(`  Output trades: ${out.length}`);
  console.log(`  Byproducts removed: ${byproductsRemoved}`);
  console.log(`  Duplicates removed: ${duplicatesRemoved}`);

  return out;
}

async function main() {
  console.log('Testing ROLE-AWARE DEDUPE (Universal Strategy)\n');
  console.log(`Wallet: ${WALLET}`);
  console.log(`Target UI PnL: $${UI_PNL}`);
  console.log('='.repeat(70));

  // Get ALL trades
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

  // Apply role-aware dedupe
  const dedupedTrades = roleAwareDedupe(allTrades);

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
