/**
 * Debug token flow for a specific condition to understand the discrepancy
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { ClobClient } from '@polymarket/clob-client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== DEBUG TOKEN FLOW ===\n');

  const client = new ClobClient('https://clob.polymarket.com', 137);

  // Pick a problematic condition: 3487d414... (where redeemed > CLOB position)
  const conditionId = '3487d414a87c0a7c19221fb63d8ed30c46f9be33f8d36fb47f5d3488f5e6f6dd';

  console.log(`Condition: ${conditionId.slice(0, 20)}...\n`);

  // Get market info from CLOB
  const market = await client.getMarket(`0x${conditionId}`);
  console.log('Market question:', market?.question);
  console.log('Tokens:');
  for (const t of market?.tokens || []) {
    console.log(`  ${t.token_id.slice(0, 30)}... outcome="${t.outcome}" winner=${t.winner}`);
  }

  // Get all CLOB trades for this condition's tokens
  const tokenIds = (market?.tokens || []).map((t) => t.token_id);
  const tokenList = tokenIds.map((t) => `'${t}'`).join(',');

  console.log('\n=== RAW CLOB TRADES (with duplicates) ===');
  const rawQ = `
    SELECT
      event_id,
      token_id,
      side,
      token_amount / 1e6 as tokens,
      usdc_amount / 1e6 as usdc,
      trade_time
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
      AND token_id IN (${tokenList})
    ORDER BY trade_time
  `;
  const rawR = await clickhouse.query({ query: rawQ, format: 'JSONEachRow' });
  const rawTrades = (await rawR.json()) as any[];
  console.log(`Found ${rawTrades.length} raw trades`);

  for (const t of rawTrades) {
    console.log(
      `  ${t.trade_time} ${t.side.padEnd(4)} ${parseFloat(t.tokens).toFixed(2).padStart(8)} tokens @ $${parseFloat(t.usdc).toFixed(2)} | event_id: ${t.event_id.slice(0, 20)}...`
    );
  }

  // Deduplicated trades
  console.log('\n=== DEDUPED CLOB TRADES ===');
  const dedupQ = `
    SELECT
      event_id,
      any(token_id) as token_id,
      any(side) as side,
      any(token_amount) / 1e6 as tokens,
      any(usdc_amount) / 1e6 as usdc
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
      AND token_id IN (${tokenList})
    GROUP BY event_id
  `;
  const dedupR = await clickhouse.query({ query: dedupQ, format: 'JSONEachRow' });
  const dedupTrades = (await dedupR.json()) as any[];
  console.log(`Found ${dedupTrades.length} deduped trades`);

  // Net position per token
  console.log('\n=== NET POSITIONS (deduped) ===');
  for (const tokenId of tokenIds) {
    const tokenTrades = dedupTrades.filter((t) => t.token_id === tokenId);
    let netPos = 0;
    for (const t of tokenTrades) {
      netPos += t.side === 'buy' ? parseFloat(t.tokens) : -parseFloat(t.tokens);
    }
    const info = (market?.tokens || []).find((t) => t.token_id === tokenId);
    console.log(
      `  ${tokenId.slice(0, 30)}... ${info?.outcome.padEnd(6)} net=${netPos.toFixed(2)} winner=${info?.winner}`
    );
  }

  // Redemptions for this condition
  console.log('\n=== REDEMPTIONS FOR THIS CONDITION ===');
  const redQ = `
    SELECT
      event_type,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp,
      tx_hash
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND condition_id = '${conditionId}'
      AND is_deleted = 0
  `;
  const redR = await clickhouse.query({ query: redQ, format: 'JSONEachRow' });
  const redemptions = (await redR.json()) as any[];
  console.log(`Found ${redemptions.length} CTF events for this condition`);
  for (const r of redemptions) {
    console.log(`  ${r.event_timestamp} ${r.event_type} $${parseFloat(r.amount).toFixed(2)}`);
  }

  // Splits for this condition
  console.log('\n=== SPLITS VIA TX_HASH ===');
  const splitQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT
      event_type,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp,
      tx_hash
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND condition_id = '${conditionId}'
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const splitR = await clickhouse.query({ query: splitQ, format: 'JSONEachRow' });
  const splits = (await splitR.json()) as any[];
  console.log(`Found ${splits.length} splits for this condition`);
  for (const s of splits) {
    console.log(`  ${s.event_timestamp} ${s.event_type} $${parseFloat(s.amount).toFixed(2)}`);
  }

  // The key question: how can redemption exceed CLOB position?
  console.log('\n=== ANALYSIS ===');
  const winningToken = (market?.tokens || []).find((t) => t.winner === true);
  if (winningToken) {
    const winTrades = dedupTrades.filter((t) => t.token_id === winningToken.token_id);
    let netWinPos = 0;
    for (const t of winTrades) {
      netWinPos += t.side === 'buy' ? parseFloat(t.tokens) : -parseFloat(t.tokens);
    }
    const totalRedeemed = redemptions
      .filter((r) => r.event_type === 'PayoutRedemption')
      .reduce((sum, r) => sum + parseFloat(r.amount), 0);
    const totalSplit = splits.reduce((sum, s) => sum + parseFloat(s.amount), 0);

    console.log(`Winning token: ${winningToken.outcome}`);
    console.log(`Split amount: $${totalSplit.toFixed(2)} (= ${totalSplit.toFixed(2)} tokens minted)`);
    console.log(`CLOB net position: ${netWinPos.toFixed(2)} tokens`);
    console.log(`Redemption: $${totalRedeemed.toFixed(2)} (= ${totalRedeemed.toFixed(2)} tokens redeemed)`);
    console.log(`Expected actual held: ${(totalSplit + netWinPos - totalRedeemed).toFixed(2)} tokens`);
  }
}

main().catch(console.error);
