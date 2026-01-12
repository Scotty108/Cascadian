/**
 * PnL V29 Position Tracking
 *
 * The issue: When you use Neg Risk Adapter, you swap positions. But where
 * do those positions come from initially?
 *
 * Key insight: If you have -100 O0 tokens and -50 O1 tokens at the end,
 * you must have MINTED tokens to sell them. The minting has a cost of $1
 * per token pair.
 *
 * Let's track:
 * 1. Net token positions from CLOB trades
 * 2. Infer minting/splitting based on negative positions
 * 3. Calculate the true cost basis
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function fetchApiPnl(wallet: string): Promise<number | null> {
  try {
    const url = `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`;
    const response = await fetch(url);
    if (response.ok) {
      const data = (await response.json()) as Array<{ t: number; p: number }>;
      if (data && data.length > 0) return data[data.length - 1].p;
    }
  } catch {}
  return null;
}

interface Trade {
  time: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  tokens: number;
  usdc: number;
  price: number;
}

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== PNL V29 POSITION TRACKING FOR ${wallet} ===\n`);

  const apiPnl = await fetchApiPnl(wallet);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);

  // Get all trades
  const result = await clickhouse.query({
    query: `
      SELECT
        toString(t.trade_time) as time,
        lower(m.condition_id) as condition_id,
        m.outcome_index,
        t.side,
        max(t.token_amount) / 1e6 as tokens,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.usdc_amount) / max(t.token_amount) as price
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet.toLowerCase()}'
        AND m.condition_id IS NOT NULL
      GROUP BY t.trade_time, m.condition_id, m.outcome_index, t.side
      ORDER BY t.trade_time ASC
    `,
    format: 'JSONEachRow',
  });

  const trades = await result.json() as Trade[];

  // Track positions per condition/outcome
  interface Position {
    tokens: number;
    cashFlow: number;  // positive = received, negative = paid
  }

  const positions = new Map<string, Position>();

  // Process all trades
  for (const trade of trades) {
    const key = `${trade.condition_id}_${trade.outcome_index}`;
    let pos = positions.get(key);
    if (!pos) {
      pos = { tokens: 0, cashFlow: 0 };
      positions.set(key, pos);
    }

    if (trade.side === 'buy') {
      pos.tokens += trade.tokens;
      pos.cashFlow -= trade.usdc;  // paid cash
    } else {
      pos.tokens -= trade.tokens;
      pos.cashFlow += trade.usdc;  // received cash
    }
  }

  // Get redemptions
  const redemptionResult = await clickhouse.query({
    query: `
      SELECT
        lower(cid) as condition_id,
        sum(toFloat64OrZero(amount_or_payout))/1e6 as payout_amount
      FROM (
        SELECT lower(condition_id) as cid, amount_or_payout
        FROM pm_ctf_events
        WHERE lower(user_address) = '${wallet.toLowerCase()}'
          AND event_type = 'PayoutRedemption'
          AND is_deleted = 0
      )
      GROUP BY cid
    `,
    format: 'JSONEachRow',
  });

  const redemptions = await redemptionResult.json() as any[];
  const redemptionByCondition = new Map<string, number>();
  let totalRedemptions = 0;
  for (const r of redemptions) {
    redemptionByCondition.set(r.condition_id, r.payout_amount);
    totalRedemptions += r.payout_amount;
  }

  // Group positions by condition
  const byCondition = new Map<string, { o0: Position | null; o1: Position | null }>();
  for (const [key, pos] of positions) {
    const [conditionId, outcomeStr] = key.split('_');
    const outcome = parseInt(outcomeStr);
    if (!byCondition.has(conditionId)) {
      byCondition.set(conditionId, { o0: null, o1: null });
    }
    const entry = byCondition.get(conditionId)!;
    if (outcome === 0) entry.o0 = pos;
    else entry.o1 = pos;
  }

  console.log(`\n=== CONDITION ANALYSIS ===`);
  console.log('condition_id         | O0 tkn | O1 tkn | O0 cash | O1 cash | redemp | split?');
  console.log('-'.repeat(95));

  let totalCashFlow = 0;
  let totalInferredSplitCost = 0;

  for (const [conditionId, { o0, o1 }] of byCondition) {
    const o0Tokens = o0?.tokens ?? 0;
    const o1Tokens = o1?.tokens ?? 0;
    const o0Cash = o0?.cashFlow ?? 0;
    const o1Cash = o1?.cashFlow ?? 0;
    const redemption = redemptionByCondition.get(conditionId) ?? 0;

    totalCashFlow += o0Cash + o1Cash;

    // Infer split: If both positions are negative, tokens came from splits
    // The min of the two negative amounts tells us how many pairs were split
    let inferredSplitAmount = 0;
    let splitIndicator = '';

    if (o0Tokens < -0.01 && o1Tokens < -0.01) {
      inferredSplitAmount = Math.min(Math.abs(o0Tokens), Math.abs(o1Tokens));
      splitIndicator = `YES(${inferredSplitAmount.toFixed(1)})`;
      totalInferredSplitCost += inferredSplitAmount;  // $1 per split
    } else if (o0Tokens < -0.01 || o1Tokens < -0.01) {
      // One side negative means partial split or Neg Risk swap
      const negSide = o0Tokens < 0 ? 0 : 1;
      const negAmount = o0Tokens < 0 ? Math.abs(o0Tokens) : Math.abs(o1Tokens);
      splitIndicator = `PART(O${negSide}:${negAmount.toFixed(1)})`;
    }

    if (Math.abs(o0Tokens) > 0.1 || Math.abs(o1Tokens) > 0.1 || redemption > 0) {
      console.log(
        `${conditionId.substring(0, 20)}... | ` +
        `${o0Tokens.toFixed(1).padStart(6)} | ` +
        `${o1Tokens.toFixed(1).padStart(6)} | ` +
        `$${o0Cash.toFixed(2).padStart(6)} | ` +
        `$${o1Cash.toFixed(2).padStart(6)} | ` +
        `$${redemption.toFixed(2).padStart(5)} | ` +
        `${splitIndicator}`
      );
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total CLOB cash flow: $${totalCashFlow.toFixed(2)}`);
  console.log(`Total redemptions: $${totalRedemptions.toFixed(2)}`);
  console.log(`Inferred split cost: $${totalInferredSplitCost.toFixed(2)}`);

  // Calculate PnL with split cost adjustment
  const naivePnl = totalCashFlow + totalRedemptions;
  const adjustedPnl = totalCashFlow + totalRedemptions - totalInferredSplitCost;

  console.log(`\n=== PNL CALCULATIONS ===`);
  console.log(`Naive PnL (cash + redemp): $${naivePnl.toFixed(2)}`);
  console.log(`Adjusted PnL (- split cost): $${adjustedPnl.toFixed(2)}`);
  console.log(`API PnL: $${apiPnl?.toFixed(2) ?? 'N/A'}`);
  console.log(`Naive diff: $${apiPnl !== null ? (naivePnl - apiPnl).toFixed(2) : 'N/A'}`);
  console.log(`Adjusted diff: $${apiPnl !== null ? (adjustedPnl - apiPnl).toFixed(2) : 'N/A'}`);

  // What adjustment would we need?
  if (apiPnl !== null) {
    const needed = naivePnl - apiPnl;
    console.log(`\nTo match API, subtract: $${needed.toFixed(2)}`);
    console.log(`Inferred split gives: $${totalInferredSplitCost.toFixed(2)}`);
    console.log(`Remaining unexplained: $${(needed - totalInferredSplitCost).toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
