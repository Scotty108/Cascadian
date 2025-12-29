/**
 * Pure Cash Flow P&L Engine
 *
 * Economic parity approach: only count actual cash flows.
 * No split inference, no cost basis, no heuristics.
 *
 * Formula:
 *   P&L = CashIn - CashOut
 *
 * Where:
 *   CashIn = CLOB Sells + Redemptions + Merges
 *   CashOut = CLOB Buys + Explicit Splits
 *
 * This gives the TRUE economic result: how much USDC did the wallet gain or lose?
 */

import { clickhouse } from '@/lib/clickhouse/client';

export interface PureCashFlowResult {
  wallet: string;
  buys: number;
  sells: number;
  redemptions: number;
  merges: number;
  explicitSplits: number;
  cashIn: number;
  cashOut: number;
  economicPnl: number;
  trades: number;
  tokensBought: number;
  tokensSold: number;
  tokenDeficit: number;
}

export async function computePureCashFlowPnl(wallet: string): Promise<PureCashFlowResult> {
  const w = wallet.toLowerCase();

  // 1) Get CLOB trade totals
  const tradesQ = `
    SELECT
      sum(CASE WHEN side = 'buy' THEN usdc_amount ELSE 0 END)/1e6 as buy_usdc,
      sum(CASE WHEN side = 'sell' THEN usdc_amount ELSE 0 END)/1e6 as sell_usdc,
      sum(CASE WHEN side = 'buy' THEN token_amount ELSE 0 END)/1e6 as buy_tokens,
      sum(CASE WHEN side = 'sell' THEN token_amount ELSE 0 END)/1e6 as sell_tokens,
      count() as trade_count
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${w}'
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const [tradeData] = (await tradesR.json()) as [{
    buy_usdc: number;
    sell_usdc: number;
    buy_tokens: number;
    sell_tokens: number;
    trade_count: number;
  }];

  const buys = tradeData?.buy_usdc || 0;
  const sells = tradeData?.sell_usdc || 0;
  const tokensBought = tradeData?.buy_tokens || 0;
  const tokensSold = tradeData?.sell_tokens || 0;
  const tradeCount = Number(tradeData?.trade_count || 0);

  // 2) Get CTF event totals
  const ctfQ = `
    SELECT
      event_type,
      sum(toFloat64OrZero(amount_or_payout))/1e6 as total_amount
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
      AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
      AND is_deleted = 0
    GROUP BY event_type
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctfEvents = (await ctfR.json()) as Array<{
    event_type: string;
    total_amount: number;
  }>;

  let redemptions = 0;
  let merges = 0;
  let explicitSplits = 0;
  for (const e of ctfEvents) {
    if (e.event_type === 'PayoutRedemption') redemptions = e.total_amount;
    else if (e.event_type === 'PositionsMerge') merges = e.total_amount;
    else if (e.event_type === 'PositionSplit') explicitSplits = e.total_amount;
  }

  // 3) Calculate pure cash flow P&L
  const cashIn = sells + redemptions + merges;
  const cashOut = buys + explicitSplits;
  const economicPnl = cashIn - cashOut;

  const tokenDeficit = Math.max(0, tokensSold - tokensBought);

  return {
    wallet: w,
    buys,
    sells,
    redemptions,
    merges,
    explicitSplits,
    cashIn,
    cashOut,
    economicPnl,
    trades: tradeCount,
    tokensBought,
    tokensSold,
    tokenDeficit,
  };
}
