/**
 * Investigate double-counting in f918
 *
 * Hypothesis: The PositionSplit CTF events and the paired CLOB trades
 * are the SAME TRANSACTION. Adding both causes 2x count.
 *
 * The Polymarket UI flow for "split + trade" is:
 * 1. User wants to buy YES at $0.70
 * 2. Exchange atomically: Splits USDC → YES+NO, then sells NO at $0.30
 * 3. This appears as:
 *    - CTF: PositionSplit event
 *    - CLOB: BUY YES (the split's YES leg)
 *    - CLOB: SELL NO (selling the unwanted NO)
 *
 * So the CTF split and CLOB trades are the SAME economic event.
 * We should NOT count both.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';
const UI_PNL = 1.16;

async function main() {
  console.log('Investigating f918 double-counting...\n');

  // Get CLOB trades with tx_hash
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
    SELECT d.*, m.condition_id, m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.trade_time
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobTrades = (await clobResult.json()) as any[];

  // Get CTF Split events
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
      tx_hash
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_hashes)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const splitEvents = (await ctfResult.json()) as any[];

  console.log(`CLOB trades: ${clobTrades.length}`);
  console.log(`Split events: ${splitEvents.length}\n`);

  // Check overlap
  const splitTxHashes = new Set(splitEvents.map((e: any) => e.tx_hash.toLowerCase()));
  const clobInSplitTx = clobTrades.filter((t: any) => splitTxHashes.has(t.tx_hash?.toLowerCase()));

  console.log(`CLOB trades in Split tx: ${clobInSplitTx.length}/${clobTrades.length}`);

  // Group CLOB trades by tx_hash to see pattern
  console.log('\n' + '='.repeat(80));
  console.log('Transactions with BOTH Split and CLOB:');
  console.log('='.repeat(80));

  const clobByTx = new Map<string, any[]>();
  for (const t of clobTrades) {
    if (!t.tx_hash) continue;
    const list = clobByTx.get(t.tx_hash) || [];
    list.push(t);
    clobByTx.set(t.tx_hash, list);
  }

  let txCount = 0;
  for (const split of splitEvents) {
    const txHash = split.tx_hash.toLowerCase();
    const clobsInTx = clobByTx.get(txHash) || [];

    if (clobsInTx.length > 0) {
      txCount++;
      if (txCount <= 3) {
        console.log(`\nTX: ...${txHash.slice(-8)}`);
        console.log(`  Split: ${split.amount.toFixed(2)} tokens @ $0.50 each = $${(split.amount * 0.50 * 2).toFixed(2)} total`);

        for (const clob of clobsInTx) {
          const price = clob.tokens > 0 ? clob.usdc / clob.tokens : 0;
          console.log(`  CLOB ${clob.side.toUpperCase()}: ${clob.tokens.toFixed(2)} tokens @ $${price.toFixed(4)} = $${clob.usdc.toFixed(2)} (outcome ${clob.outcome_index})`);
        }

        // Calculate net effect
        const splitCost = split.amount * 1.0; // $1 for each split unit (creates both outcomes)
        const clobBuyUsdc = clobsInTx.filter((t: any) => t.side === 'buy').reduce((s: number, t: any) => s + t.usdc, 0);
        const clobSellUsdc = clobsInTx.filter((t: any) => t.side === 'sell').reduce((s: number, t: any) => s + t.usdc, 0);

        console.log(`  ---`);
        console.log(`  Split cost: $${splitCost.toFixed(2)}`);
        console.log(`  CLOB buy: $${clobBuyUsdc.toFixed(2)}, CLOB sell: $${clobSellUsdc.toFixed(2)}`);
        console.log(`  If counting both: cost = $${(splitCost + clobBuyUsdc).toFixed(2)} (WRONG - double count!)`);
        console.log(`  If CLOB only: cost = $${(clobBuyUsdc - clobSellUsdc).toFixed(2)} (net cash out)`);
      }
    }
  }

  console.log(`\nTotal transactions with Split+CLOB: ${txCount}`);

  // Calculate PnL with CLOB-only (no CTF)
  console.log('\n' + '='.repeat(80));
  console.log('PnL Formulas (corrected)');
  console.log('='.repeat(80));

  // Get resolutions
  const tokenIds = [...new Set(clobTrades.map((t: any) => t.token_id))];
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

  const resolutions = new Map<string, { payout: number; isResolved: boolean }>();
  for (const row of resRows) {
    let payout = 0.5;
    let isResolved = false;
    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        const outcomeIndex = Number(row.outcome_index);
        const denom = payouts.reduce((a: number, b: number) => a + b, 0);
        payout = denom > 0 ? payouts[outcomeIndex] / denom : 0.5;
        isResolved = true;
      } catch { }
    }
    resolutions.set(row.token_id, { payout, isResolved });
  }

  // Aggregate by token - CLOB only
  const positions = new Map<string, { buyUsdc: number; sellUsdc: number; buyTokens: number; sellTokens: number }>();

  for (const t of clobTrades) {
    const pos = positions.get(t.token_id) || { buyUsdc: 0, sellUsdc: 0, buyTokens: 0, sellTokens: 0 };
    if (t.side === 'buy') {
      pos.buyUsdc += t.usdc;
      pos.buyTokens += t.tokens;
    } else {
      pos.sellUsdc += t.usdc;
      pos.sellTokens += t.tokens;
    }
    positions.set(t.token_id, pos);
  }

  // V17 formula: cash_flow + (final_shares × payout) - ONLY for resolved
  let clobOnlyRealized = 0;
  let clobOnlyUnrealized = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  console.log('\nPosition-level PnL (CLOB only):');
  console.log('Token (last 12) | Cash Flow | Final | Payout | Resolved | PnL');
  console.log('-'.repeat(75));

  for (const [tokenId, pos] of positions) {
    const cashFlow = pos.sellUsdc - pos.buyUsdc;
    const finalShares = pos.buyTokens - pos.sellTokens;
    const res = resolutions.get(tokenId);
    const isResolved = res?.isResolved ?? false;
    const payout = res?.payout ?? 0.5;

    let pnl: number;
    if (isResolved) {
      pnl = cashFlow + (finalShares * payout);
      clobOnlyRealized += pnl;
      resolvedCount++;
    } else {
      pnl = cashFlow + (finalShares * 0.5); // Mark at 0.5 for unresolved
      clobOnlyUnrealized += pnl;
      unresolvedCount++;
    }

    if (Math.abs(pnl) > 0.01 || Math.abs(finalShares) > 0.01) {
      console.log(
        `...${tokenId.slice(-12)} | ${cashFlow.toFixed(2).padStart(9)} | ${finalShares.toFixed(2).padStart(5)} | ${payout.toFixed(2).padStart(6)} | ${(isResolved ? 'YES' : 'NO').padStart(8)} | ${pnl.toFixed(2).padStart(7)}`
      );
    }
  }

  console.log('-'.repeat(75));
  console.log(`Resolved: ${resolvedCount}, Unresolved: ${unresolvedCount}`);

  const totalPnl = clobOnlyRealized + clobOnlyUnrealized;
  const error = ((totalPnl - UI_PNL) / Math.abs(UI_PNL)) * 100;

  console.log(`\nCLOB-only V17 Formula (no CTF events):`);
  console.log(`  Realized: $${clobOnlyRealized.toFixed(2)}`);
  console.log(`  Unrealized: $${clobOnlyUnrealized.toFixed(2)}`);
  console.log(`  Total: $${totalPnl.toFixed(2)}`);
  console.log(`  UI Target: $${UI_PNL}`);
  console.log(`  Error: ${error.toFixed(1)}%`, Math.abs(error) < 10 ? '✅' : '❌');

  // Also show what happens if we only count cash for unresolved
  console.log(`\nCLOB-only V17 (unresolved = 0):`);
  console.log(`  Realized: $${clobOnlyRealized.toFixed(2)}`);
  console.log(`  Unrealized: $0.00`);
  console.log(`  Total: $${clobOnlyRealized.toFixed(2)}`);
  const error2 = ((clobOnlyRealized - UI_PNL) / Math.abs(UI_PNL)) * 100;
  console.log(`  Error: ${error2.toFixed(1)}%`, Math.abs(error2) < 10 ? '✅' : '❌');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
