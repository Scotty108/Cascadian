/**
 * Debug Trump 2024 Position for W1
 *
 * Deep dive into why there's a gap between our calculation and API
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 300000
});

const W1 = '0x9d36c904930a7d06c5403f9e16996e919f586486';
// Trump 2024 condition (from API)
const TRUMP_CONDITION = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';

async function main() {
  console.log('=== DEEP DIVE: TRUMP 2024 POSITION FOR W1 ===');
  console.log('');
  console.log('API shows: Bought 7,394.86 tokens @ $0.5213, PnL = $3,540.06');
  console.log('');

  // Find the token_id for Trump 2024
  console.log('Step 1: Find token_id for Trump 2024 condition...');
  const tokenResult = await client.query({
    query: `
      SELECT token_id_dec, outcome_index
      FROM pm_token_to_condition_map_v3
      WHERE lower(condition_id) = '${TRUMP_CONDITION}'
    `,
    format: 'JSONEachRow'
  });
  const tokens = await tokenResult.json() as any[];
  console.log('Tokens for Trump 2024:', tokens);
  console.log('');

  if (tokens.length === 0) {
    console.log('No tokens found for this condition!');
    await client.close();
    return;
  }

  // Get trades for YES token only (outcome_index = 0, which is the winning side)
  const yesToken = tokens.find((t: any) => t.outcome_index === 0);
  if (!yesToken) {
    console.log('No YES token found!');
    await client.close();
    return;
  }

  console.log(`YES token_id: ${yesToken.token_id_dec.substring(0, 30)}...`);
  console.log('');

  console.log('Step 2: Get all CLOB trades for this token...');
  const tradesResult = await client.query({
    query: `
      SELECT
        substring(event_id, 1, position(event_id, '_') - 1) AS tx_hash,
        side,
        usdc_amount / 1000000.0 AS usdc,
        token_amount / 1000000.0 AS tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${W1}'
        AND is_deleted = 0
        AND token_id = '${yesToken.token_id_dec}'
      ORDER BY trade_time
    `,
    format: 'JSONEachRow'
  });
  const allTrades = await tradesResult.json() as any[];
  console.log(`Found ${allTrades.length} raw trades`);

  // Manually dedupe by tx_hash
  const dedupedMap = new Map();
  for (const t of allTrades) {
    if (!dedupedMap.has(t.tx_hash)) {
      dedupedMap.set(t.tx_hash, t);
    }
  }
  const deduped = Array.from(dedupedMap.values());
  console.log(`After tx_hash dedup: ${deduped.length} unique trades`);
  console.log('');

  console.log('All unique trades:');
  let totalBought = 0, totalSold = 0, cashSpent = 0, cashReceived = 0;
  for (const t of deduped) {
    console.log(`  TX: ${t.tx_hash.substring(0, 15)}... | ${t.side.padEnd(4)} | ${Number(t.tokens).toFixed(2).padStart(10)} tokens | $${Number(t.usdc).toFixed(2).padStart(10)}`);
    if (t.side === 'buy') {
      totalBought += Number(t.tokens);
      cashSpent += Number(t.usdc);
    } else {
      totalSold += Number(t.tokens);
      cashReceived += Number(t.usdc);
    }
  }

  const netTokens = totalBought - totalSold;
  const netCash = cashReceived - cashSpent;
  const avgBuyPrice = totalBought > 0 ? cashSpent / totalBought : 0;

  console.log('');
  console.log('Step 3: Summary for Trump 2024 YES:');
  console.log(`  Total BOUGHT: ${totalBought.toFixed(2)} tokens for $${cashSpent.toFixed(2)} (avg $${avgBuyPrice.toFixed(4)})`);
  console.log(`  Total SOLD: ${totalSold.toFixed(2)} tokens for $${cashReceived.toFixed(2)}`);
  console.log(`  Net tokens: ${netTokens.toFixed(2)}`);
  console.log(`  Net cash: $${netCash.toFixed(2)}`);
  console.log('');

  console.log('Comparison with API:');
  console.log(`  API totalBought: 7,394.86 | Our totalBought: ${totalBought.toFixed(2)}`);
  console.log(`  API avgPrice: $0.5213 | Our avgPrice: $${avgBuyPrice.toFixed(4)}`);
  console.log(`  Gap in bought: ${(7394.86 - totalBought).toFixed(2)} tokens`);
  console.log('');

  // Get resolution data
  console.log('Step 4: Resolution data...');
  const resResult = await client.query({
    query: `
      SELECT payout_numerators, resolved_at
      FROM pm_condition_resolutions
      WHERE lower(condition_id) = '${TRUMP_CONDITION}'
    `,
    format: 'JSONEachRow'
  });
  const resData = await resResult.json() as any[];
  console.log('Resolution:', resData[0] || 'NOT FOUND');

  if (resData.length > 0 && resData[0].payout_numerators) {
    const payouts = JSON.parse(resData[0].payout_numerators);
    const payoutPrice = payouts[0] || 0; // YES is outcome 0

    const pnl = netCash + (netTokens * payoutPrice);
    console.log('');
    console.log('Step 5: PnL Calculation:');
    console.log(`  Formula: netCash + (netTokens * payoutPrice)`);
    console.log(`  = $${netCash.toFixed(2)} + (${netTokens.toFixed(2)} * ${payoutPrice})`);
    console.log(`  = $${pnl.toFixed(2)}`);
    console.log('');
    console.log('API expected PnL: $3,540.06');
    console.log(`Our calculated PnL: $${pnl.toFixed(2)}`);
    console.log(`Gap: $${(3540.06 - pnl).toFixed(2)}`);
  }

  // Check if there are NO tokens too
  console.log('');
  console.log('=== CHECKING NO TOKEN TOO ===');
  const noToken = tokens.find((t: any) => t.outcome_index === 1);
  if (noToken) {
    const noTradesResult = await client.query({
      query: `
        SELECT
          substring(event_id, 1, position(event_id, '_') - 1) AS tx_hash,
          side,
          usdc_amount / 1000000.0 AS usdc,
          token_amount / 1000000.0 AS tokens
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${W1}'
          AND is_deleted = 0
          AND token_id = '${noToken.token_id_dec}'
      `,
      format: 'JSONEachRow'
    });
    const noTrades = await noTradesResult.json() as any[];
    console.log(`NO token trades: ${noTrades.length} raw rows`);

    // Dedupe
    const noDedup = new Map();
    for (const t of noTrades) {
      if (!noDedup.has(t.tx_hash)) {
        noDedup.set(t.tx_hash, t);
      }
    }
    console.log(`After dedup: ${noDedup.size} unique trades`);
    for (const [tx, t] of noDedup) {
      console.log(`  TX: ${tx.substring(0, 15)}... | ${t.side} | ${Number(t.tokens).toFixed(2)} tokens`);
    }
  }

  await client.close();
}

main().catch(console.error);
