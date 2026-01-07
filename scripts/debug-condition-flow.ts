/**
 * Trace all events for a specific condition to understand the merge issue
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61';
const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
];

// Token that had external merge: ...473883582772 -> condition 968d3276c9394b83
const TARGET_CONDITION = '968d3276c9394b83';

async function main() {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Get full condition_id
  console.log('Finding full condition_id...');
  const condQuery = `
    SELECT condition_id
    FROM pm_token_to_condition_map_v5
    WHERE condition_id LIKE '%${TARGET_CONDITION}%'
    LIMIT 1
  `;
  const condResult = await clickhouse.query({ query: condQuery, format: 'JSONEachRow' });
  const condRows = (await condResult.json()) as any[];

  if (condRows.length === 0) {
    console.log('Condition not found');
    return;
  }

  const fullConditionId = condRows[0].condition_id.toLowerCase();
  console.log(`Full condition_id: ${fullConditionId}`);

  // Get token_ids for this condition
  const tokenQuery = `
    SELECT token_id_dec, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) = '${fullConditionId}'
  `;
  const tokenResult = await clickhouse.query({ query: tokenQuery, format: 'JSONEachRow' });
  const tokenRows = (await tokenResult.json()) as any[];

  let token_id_0 = '';
  let token_id_1 = '';
  for (const r of tokenRows) {
    if (r.outcome_index === 0) token_id_0 = r.token_id_dec;
    else token_id_1 = r.token_id_dec;
  }

  console.log(`\nToken 0: ${token_id_0}`);
  console.log(`Token 1: ${token_id_1}`);

  // Get all CTF events for this condition
  console.log('\n=== CTF Events for this condition ===');
  const ctfQuery = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
    )
    SELECT
      event_type,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp,
      tx_hash
    FROM pm_ctf_events
    WHERE (
      (tx_hash IN (SELECT tx_hash FROM wallet_hashes) AND lower(user_address) IN (${proxyList}))
      OR lower(user_address) = lower('${WALLET}')
    )
    AND lower(condition_id) = '${fullConditionId}'
    AND is_deleted = 0
    ORDER BY event_timestamp
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = (await ctfResult.json()) as any[];

  console.log('Timestamp | Type | Amount | TX (last 8)');
  console.log('-'.repeat(70));
  let splitTotal = 0;
  let mergeTotal = 0;
  for (const r of ctfRows) {
    console.log(`${r.event_timestamp} | ${r.event_type.padEnd(16)} | ${r.amount.toFixed(2).padStart(10)} | ...${r.tx_hash.slice(-8)}`);
    if (r.event_type === 'PositionSplit') splitTotal += r.amount;
    if (r.event_type === 'PositionsMerge') mergeTotal += r.amount;
  }
  console.log(`\nSplit total: ${splitTotal.toFixed(2)} | Merge total: ${mergeTotal.toFixed(2)}`);

  // Get CLOB trades for token_0
  console.log('\n=== CLOB Trades for Token 0 ===');
  const clob0Query = `
    SELECT
      side,
      token_amount / 1e6 as amount,
      trade_time,
      lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND token_id = '${token_id_0}'
      AND is_deleted = 0
    ORDER BY trade_time
  `;

  const clob0Result = await clickhouse.query({ query: clob0Query, format: 'JSONEachRow' });
  const clob0Rows = (await clob0Result.json()) as any[];

  console.log('Timestamp | Side | Amount | TX (last 8)');
  console.log('-'.repeat(70));
  let buy0 = 0, sell0 = 0;
  for (const r of clob0Rows) {
    console.log(`${r.trade_time} | ${r.side.padEnd(4)} | ${r.amount.toFixed(2).padStart(10)} | ...${r.tx_hash.slice(-8)}`);
    if (r.side === 'buy') buy0 += r.amount;
    else sell0 += r.amount;
  }
  console.log(`\nToken 0: Buy ${buy0.toFixed(2)} | Sell ${sell0.toFixed(2)}`);

  // Get CLOB trades for token_1
  console.log('\n=== CLOB Trades for Token 1 ===');
  const clob1Query = `
    SELECT
      side,
      token_amount / 1e6 as amount,
      trade_time,
      lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND token_id = '${token_id_1}'
      AND is_deleted = 0
    ORDER BY trade_time
  `;

  const clob1Result = await clickhouse.query({ query: clob1Query, format: 'JSONEachRow' });
  const clob1Rows = (await clob1Result.json()) as any[];

  console.log('Timestamp | Side | Amount | TX (last 8)');
  console.log('-'.repeat(70));
  let buy1 = 0, sell1 = 0;
  for (const r of clob1Rows) {
    console.log(`${r.trade_time} | ${r.side.padEnd(4)} | ${r.amount.toFixed(2).padStart(10)} | ...${r.tx_hash.slice(-8)}`);
    if (r.side === 'buy') buy1 += r.amount;
    else sell1 += r.amount;
  }
  console.log(`\nToken 1: Buy ${buy1.toFixed(2)} | Sell ${sell1.toFixed(2)}`);

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('INVENTORY ANALYSIS');
  console.log('='.repeat(70));
  console.log(`CTF Splits create: ${splitTotal.toFixed(2)} of EACH token`);
  console.log(`CTF Merges destroy: ${mergeTotal.toFixed(2)} of EACH token`);
  console.log(`Token 0: Split=${splitTotal.toFixed(2)} + Buy=${buy0.toFixed(2)} - Sell=${sell0.toFixed(2)} - Merge=${mergeTotal.toFixed(2)} = ${(splitTotal + buy0 - sell0 - mergeTotal).toFixed(2)}`);
  console.log(`Token 1: Split=${splitTotal.toFixed(2)} + Buy=${buy1.toFixed(2)} - Sell=${sell1.toFixed(2)} - Merge=${mergeTotal.toFixed(2)} = ${(splitTotal + buy1 - sell1 - mergeTotal).toFixed(2)}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
