/**
 * Test V17 cash-flow formula vs CCR-v1 cost-basis for f918
 *
 * V17 Formula: trade_cash_flow + (final_shares × resolution_price)
 *   where: trade_cash_flow = sum(sell_usdc) - sum(buy_usdc)
 *          final_shares = sum(buy_tokens) - sum(sell_tokens)
 *
 * This approach naturally handles paired-outcome trades because:
 * - Buy YES $60 + Sell NO $40 → cash_flow = $40 - $60 = -$20
 * - final_shares = 100 (YES only, NO was sold)
 * - If YES→$1: PnL = -$20 + 100 × $1.00 = $80
 *
 * CCR-v1 (dropping sell leg): PnL = 100 × ($1.00 - $0.60) = $40 (WRONG - loses $40)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';
const UI_PNL = 1.16;

interface RawTrade {
  event_id: string;
  token_id: string;
  side: string;
  usdc: number;
  tokens: number;
  trade_time: string;
  block_number: number;
  tx_hash: string;
  condition_id: string | null;
  outcome_index: number | null;
  role: string;
}

interface PositionAgg {
  buy_tokens: number;
  sell_tokens: number;
  buy_usdc: number;
  sell_usdc: number;
  outcome_index: number | null;
}

async function main() {
  console.log('Testing V17 cash-flow formula on f918\n');

  // Step 1: Load trades with dedup
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        any(block_number) as block_number,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      d.event_id,
      d.token_id,
      d.side,
      d.role,
      d.usdc,
      d.tokens,
      d.trade_time,
      d.block_number,
      d.tx_hash,
      m.condition_id,
      m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.block_number, d.event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rawTrades = (await result.json()) as RawTrade[];

  console.log(`Loaded ${rawTrades.length} trades after event_id dedup`);

  // Step 2: Remove maker/taker duplicates (keep taker)
  const seen = new Map<string, RawTrade>();
  let dupes = 0;

  for (const trade of rawTrades) {
    const key = `${trade.tx_hash}|${trade.token_id}|${trade.side}|${trade.usdc.toFixed(6)}|${trade.tokens.toFixed(6)}|${trade.trade_time}`;
    const existing = seen.get(key);
    if (existing) {
      dupes++;
      if (trade.role === 'taker' && existing.role === 'maker') {
        seen.set(key, trade);
      }
    } else {
      seen.set(key, trade);
    }
  }

  const trades = [...seen.values()];
  console.log(`After maker/taker dedup: ${trades.length} trades (removed ${dupes})`);

  // Step 3: Load resolutions
  const tokenIds = [...new Set(trades.map(t => t.token_id))];
  const tokenList = tokenIds.map(t => `'${t}'`).join(',');

  const resQuery = `
    WITH token_map AS (
      SELECT token_id_dec, condition_id, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (${tokenList})
    )
    SELECT
      m.token_id_dec as token_id,
      r.payout_numerators,
      m.outcome_index
    FROM token_map m
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  const resolutions = new Map<string, { payout: number; is_resolved: boolean }>();
  for (const row of resRows) {
    let payout = 0.5;
    let isResolved = false;

    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        const outcomeIndex = Number(row.outcome_index);
        const payoutDenominator = payouts.reduce((a: number, b: number) => a + b, 0);
        payout = payoutDenominator > 0 ? payouts[outcomeIndex] / payoutDenominator : 0;
        isResolved = true;
      } catch { }
    }

    resolutions.set(row.token_id, { payout, is_resolved: isResolved });
  }

  console.log(`Loaded ${resolutions.size} resolutions`);

  // Step 4: Aggregate by token_id (V17 style - NO paired-outcome filtering)
  const positions = new Map<string, PositionAgg>();

  for (const trade of trades) {
    const pos = positions.get(trade.token_id) || {
      buy_tokens: 0,
      sell_tokens: 0,
      buy_usdc: 0,
      sell_usdc: 0,
      outcome_index: trade.outcome_index,
    };

    if (trade.side === 'buy') {
      pos.buy_tokens += trade.tokens;
      pos.buy_usdc += trade.usdc;
    } else {
      pos.sell_tokens += trade.tokens;
      pos.sell_usdc += trade.usdc;
    }

    positions.set(trade.token_id, pos);
  }

  console.log(`\nAggregated into ${positions.size} positions`);

  // Step 5: Calculate PnL using V17 formula
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  console.log('\n' + '='.repeat(90));
  console.log('Position | Cash Flow | Final Shares | Resolution | Payout | PnL');
  console.log('-'.repeat(90));

  for (const [tokenId, pos] of positions) {
    const resolution = resolutions.get(tokenId);
    const isResolved = resolution?.is_resolved ?? false;
    const payout = resolution?.payout ?? 0.5;

    const cashFlow = pos.sell_usdc - pos.buy_usdc;
    const finalShares = pos.buy_tokens - pos.sell_tokens;

    let positionPnl: number;
    if (isResolved) {
      // V17: cash_flow + (final_shares × resolution_price)
      positionPnl = cashFlow + (finalShares * payout);
      totalRealizedPnl += positionPnl;
      resolvedCount++;
    } else {
      // Unresolved: no PnL (per Polymarket UI behavior)
      positionPnl = 0;
      unresolvedCount++;
    }

    if (Math.abs(positionPnl) > 0.01 || Math.abs(finalShares) > 0.01) {
      console.log(
        `...${tokenId.slice(-12)} | ${cashFlow.toFixed(2).padStart(10)} | ${finalShares.toFixed(2).padStart(12)} | ${isResolved ? 'YES' : 'NO '.padEnd(10)} | ${payout.toFixed(2).padStart(6)} | ${positionPnl.toFixed(2).padStart(8)}`
      );
    }
  }

  console.log('='.repeat(90));

  const totalPnl = totalRealizedPnl + totalUnrealizedPnl;
  const error = UI_PNL !== 0 ? ((totalPnl - UI_PNL) / Math.abs(UI_PNL)) * 100 : 0;

  console.log(`\nV17 Formula Results:`);
  console.log(`  Realized PnL: $${totalRealizedPnl.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${totalUnrealizedPnl.toFixed(2)}`);
  console.log(`  Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`  Resolved: ${resolvedCount}, Unresolved: ${unresolvedCount}`);

  console.log(`\nComparison to UI:`);
  console.log(`  UI PnL: $${UI_PNL}`);
  console.log(`  V17 PnL: $${totalPnl.toFixed(2)}`);
  console.log(`  Error: ${error.toFixed(1)}% ${Math.abs(error) < 10 ? '✅' : '❌'}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  });
