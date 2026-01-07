/**
 * Analyze f918's trading pattern to understand the PnL discrepancy
 *
 * Questions to answer:
 * 1. How many trades come from CLOB vs CTF?
 * 2. For paired-outcome trades, what are the actual cash flows?
 * 3. What would different formulas give?
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';
const UI_PNL = 1.16;

async function main() {
  console.log('='.repeat(80));
  console.log('f918 Trading Pattern Analysis');
  console.log('='.repeat(80));

  // 1. Get CLOB trades
  const clobQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      d.*,
      m.condition_id,
      m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobTrades = (await clobResult.json()) as any[];

  console.log(`\nCLOB Trades: ${clobTrades.length}`);

  // 2. Get CTF events
  const ctfQuery = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
    )
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp,
      tx_hash
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_hashes)
      AND is_deleted = 0
    ORDER BY event_timestamp
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfEvents = (await ctfResult.json()) as any[];

  console.log(`CTF Events: ${ctfEvents.length}`);

  // 3. Categorize CTF events
  const splits = ctfEvents.filter(e => e.event_type === 'PositionSplit');
  const merges = ctfEvents.filter(e => e.event_type === 'PositionsMerge');
  const redemptions = ctfEvents.filter(e => e.event_type === 'PayoutRedemption');

  console.log(`  - PositionSplit: ${splits.length}`);
  console.log(`  - PositionsMerge: ${merges.length}`);
  console.log(`  - PayoutRedemption: ${redemptions.length}`);

  // 4. Analyze CLOB trades by side
  const buys = clobTrades.filter(t => t.side === 'buy');
  const sells = clobTrades.filter(t => t.side === 'sell');

  const totalBuyUsdc = buys.reduce((s, t) => s + t.usdc, 0);
  const totalSellUsdc = sells.reduce((s, t) => s + t.usdc, 0);
  const totalBuyTokens = buys.reduce((s, t) => s + t.tokens, 0);
  const totalSellTokens = sells.reduce((s, t) => s + t.tokens, 0);

  console.log(`\nCLOB Summary:`);
  console.log(`  Buys: ${buys.length} trades, $${totalBuyUsdc.toFixed(2)} USDC, ${totalBuyTokens.toFixed(2)} tokens`);
  console.log(`  Sells: ${sells.length} trades, $${totalSellUsdc.toFixed(2)} USDC, ${totalSellTokens.toFixed(2)} tokens`);
  console.log(`  Net cash: $${(totalSellUsdc - totalBuyUsdc).toFixed(2)}`);
  console.log(`  Net tokens: ${(totalBuyTokens - totalSellTokens).toFixed(2)}`);

  // 5. CTF amounts
  const splitAmount = splits.reduce((s, e) => s + e.amount, 0);
  const mergeAmount = merges.reduce((s, e) => s + e.amount, 0);
  const redemptionAmount = redemptions.reduce((s, e) => s + e.amount, 0);

  console.log(`\nCTF Summary:`);
  console.log(`  Splits: ${splitAmount.toFixed(2)} tokens (cost: $${(splitAmount * 0.50).toFixed(2)} per outcome)`);
  console.log(`  Merges: ${mergeAmount.toFixed(2)} tokens (received: $${(mergeAmount * 0.50).toFixed(2)} per outcome)`);
  console.log(`  Redemptions: ${redemptionAmount.toFixed(2)} tokens`);

  // 6. Match CLOB trades to CTF events by tx_hash
  const ctfTxHashes = new Set(splits.map(e => e.tx_hash.toLowerCase()));
  const clobWithCTF = clobTrades.filter(t => ctfTxHashes.has(t.tx_hash?.toLowerCase()));
  const clobWithoutCTF = clobTrades.filter(t => !ctfTxHashes.has(t.tx_hash?.toLowerCase()));

  console.log(`\nCLOB/CTF Overlap:`);
  console.log(`  CLOB trades with matching Split tx: ${clobWithCTF.length}`);
  console.log(`  CLOB trades without matching Split tx: ${clobWithoutCTF.length}`);

  // 7. Analyze paired-outcome trades (same tx_hash, opposite outcomes)
  console.log(`\n${'='.repeat(80)}`);
  console.log('Paired-Outcome Analysis');
  console.log('='.repeat(80));

  // Group by tx_hash + condition_id
  const groups = new Map<string, any[]>();
  for (const t of clobTrades) {
    if (!t.condition_id || !t.tx_hash) continue;
    const key = `${t.tx_hash}|${t.condition_id}`;
    const list = groups.get(key) || [];
    list.push(t);
    groups.set(key, list);
  }

  let pairedCount = 0;
  let totalBuyInPairs = 0;
  let totalSellInPairs = 0;

  for (const [key, trades] of groups) {
    if (trades.length < 2) continue;

    // Check for buy+sell on opposite outcomes
    const outcomes = new Set(trades.map(t => t.outcome_index));
    const sides = new Set(trades.map(t => t.side));

    if (outcomes.size === 2 && sides.size === 2) {
      pairedCount++;
      const buyTrade = trades.find(t => t.side === 'buy');
      const sellTrade = trades.find(t => t.side === 'sell');

      if (buyTrade && sellTrade) {
        totalBuyInPairs += buyTrade.usdc;
        totalSellInPairs += sellTrade.usdc;

        if (pairedCount <= 3) {
          console.log(`\nPaired Trade #${pairedCount}:`);
          console.log(`  TX: ...${key.split('|')[0].slice(-8)}`);
          console.log(`  BUY outcome ${buyTrade.outcome_index}: ${buyTrade.tokens.toFixed(2)} @ $${(buyTrade.usdc / buyTrade.tokens).toFixed(4)} = $${buyTrade.usdc.toFixed(2)}`);
          console.log(`  SELL outcome ${sellTrade.outcome_index}: ${sellTrade.tokens.toFixed(2)} @ $${(sellTrade.usdc / sellTrade.tokens).toFixed(4)} = $${sellTrade.usdc.toFixed(2)}`);
          console.log(`  Net cash: $${(sellTrade.usdc - buyTrade.usdc).toFixed(2)}`);
          console.log(`  Has Split: ${ctfTxHashes.has(key.split('|')[0].toLowerCase())}`);
        }
      }
    }
  }

  console.log(`\nPaired Trade Summary:`);
  console.log(`  Total paired trades: ${pairedCount}`);
  console.log(`  Total buy USDC in pairs: $${totalBuyInPairs.toFixed(2)}`);
  console.log(`  Total sell USDC in pairs: $${totalSellInPairs.toFixed(2)}`);
  console.log(`  Net sell proceeds captured: $${totalSellInPairs.toFixed(2)}`);

  // 8. Calculate different PnL formulas
  console.log(`\n${'='.repeat(80)}`);
  console.log('PnL Formula Comparison');
  console.log('='.repeat(80));

  // Get resolutions
  const tokenIds = [...new Set(clobTrades.map(t => t.token_id))];
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

  const resolutions = new Map<string, number>();
  for (const row of resRows) {
    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        const outcomeIndex = Number(row.outcome_index);
        const denom = payouts.reduce((a: number, b: number) => a + b, 0);
        const payout = denom > 0 ? payouts[outcomeIndex] / denom : 0.5;
        resolutions.set(row.token_id, payout);
      } catch { }
    }
  }

  // Formula 1: V17 CLOB-only cash flow (no CTF)
  // trade_cash_flow + (final_shares × resolution_price)
  const positionsByToken = new Map<string, { buyUsdc: number; sellUsdc: number; buyTokens: number; sellTokens: number }>();

  for (const t of clobTrades) {
    const pos = positionsByToken.get(t.token_id) || { buyUsdc: 0, sellUsdc: 0, buyTokens: 0, sellTokens: 0 };
    if (t.side === 'buy') {
      pos.buyUsdc += t.usdc;
      pos.buyTokens += t.tokens;
    } else {
      pos.sellUsdc += t.usdc;
      pos.sellTokens += t.tokens;
    }
    positionsByToken.set(t.token_id, pos);
  }

  let v17Pnl = 0;
  for (const [tokenId, pos] of positionsByToken) {
    const cashFlow = pos.sellUsdc - pos.buyUsdc;
    const finalShares = pos.buyTokens - pos.sellTokens;
    const payout = resolutions.get(tokenId) ?? 0.5;
    v17Pnl += cashFlow + (finalShares * payout);
  }

  console.log(`\nFormula 1: V17 CLOB-only cash flow`);
  console.log(`  PnL: $${v17Pnl.toFixed(2)}`);
  console.log(`  Error vs UI: ${((v17Pnl - UI_PNL) / UI_PNL * 100).toFixed(1)}%`);

  // Formula 2: CLOB + CTF Splits/Merges (CCR-v1 style)
  // Add splits as buys at $0.50, merges as sells at $0.50

  // Get token mapping for conditions in CTF events
  const conditionIds = [...new Set(ctfEvents.map(e => e.condition_id.toLowerCase()))];
  const condList = conditionIds.map(c => `'${c}'`).join(',');

  const tokenMapQuery = `
    SELECT
      lower(condition_id) as condition_id,
      token_id_dec,
      outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) IN (${condList || "''"})
  `;

  const tokenMapResult = await clickhouse.query({ query: tokenMapQuery, format: 'JSONEachRow' });
  const tokenMapRows = (await tokenMapResult.json()) as any[];

  const conditionToTokens = new Map<string, { token0: string; token1: string }>();
  for (const row of tokenMapRows) {
    const entry = conditionToTokens.get(row.condition_id) || { token0: '', token1: '' };
    if (row.outcome_index === 0) entry.token0 = row.token_id_dec;
    else if (row.outcome_index === 1) entry.token1 = row.token_id_dec;
    conditionToTokens.set(row.condition_id, entry);
  }

  // Clone positions and add CTF events
  const positionsWithCTF = new Map(positionsByToken);

  for (const e of splits) {
    const tokens = conditionToTokens.get(e.condition_id.toLowerCase());
    if (!tokens) continue;

    // Split creates BOTH outcomes at $0.50
    for (const tokenId of [tokens.token0, tokens.token1]) {
      const pos = positionsWithCTF.get(tokenId) || { buyUsdc: 0, sellUsdc: 0, buyTokens: 0, sellTokens: 0 };
      pos.buyUsdc += e.amount * 0.50;
      pos.buyTokens += e.amount;
      positionsWithCTF.set(tokenId, pos);
    }
  }

  for (const e of merges) {
    const tokens = conditionToTokens.get(e.condition_id.toLowerCase());
    if (!tokens) continue;

    // Merge destroys BOTH outcomes at $0.50
    for (const tokenId of [tokens.token0, tokens.token1]) {
      const pos = positionsWithCTF.get(tokenId) || { buyUsdc: 0, sellUsdc: 0, buyTokens: 0, sellTokens: 0 };
      pos.sellUsdc += e.amount * 0.50;
      pos.sellTokens += e.amount;
      positionsWithCTF.set(tokenId, pos);
    }
  }

  let ccrPnl = 0;
  for (const [tokenId, pos] of positionsWithCTF) {
    const cashFlow = pos.sellUsdc - pos.buyUsdc;
    const finalShares = pos.buyTokens - pos.sellTokens;
    const payout = resolutions.get(tokenId) ?? 0.5;
    ccrPnl += cashFlow + (finalShares * payout);
  }

  console.log(`\nFormula 2: CLOB + CTF splits/merges`);
  console.log(`  PnL: $${ccrPnl.toFixed(2)}`);
  console.log(`  Error vs UI: ${((ccrPnl - UI_PNL) / UI_PNL * 100).toFixed(1)}%`);

  // Formula 3: Subgraph style with synthetic cost adjustment
  // For paired trades, apply sell proceeds as cost reduction
  console.log(`\nFormula 3: Subgraph synthetic cost adjustment`);
  console.log(`  (To be implemented...)`);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`UI PnL Target: $${UI_PNL}`);
  console.log('='.repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
