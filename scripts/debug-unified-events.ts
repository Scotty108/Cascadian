/**
 * Debug unified event stream to understand why Lheo's PnL is wrong
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

async function main() {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Get one specific condition_id that has both CTF split and CLOB trades
  const findConditionQuery = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
    ),
    ctf_conditions AS (
      SELECT DISTINCT lower(condition_id) as condition_id
      FROM pm_ctf_events
      WHERE (
        (tx_hash IN (SELECT tx_hash FROM wallet_hashes) AND lower(user_address) IN (${proxyList}))
        OR lower(user_address) = lower('${WALLET}')
      )
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
    )
    SELECT
      m.condition_id,
      m.token_id_dec,
      m.outcome_index
    FROM pm_token_to_condition_map_v5 m
    WHERE lower(m.condition_id) IN (SELECT condition_id FROM ctf_conditions)
    LIMIT 4
  `;

  const condResult = await clickhouse.query({ query: findConditionQuery, format: 'JSONEachRow' });
  const condRows = (await condResult.json()) as any[];

  if (condRows.length === 0) {
    console.log('No matching conditions found');
    return;
  }

  // Group by condition_id
  const conditions = new Map<string, { token_id_0?: string; token_id_1?: string }>();
  for (const r of condRows) {
    const cid = r.condition_id.toLowerCase();
    const entry = conditions.get(cid) || {};
    if (r.outcome_index === 0) entry.token_id_0 = r.token_id_dec;
    else entry.token_id_1 = r.token_id_dec;
    conditions.set(cid, entry);
  }

  // Pick the first complete condition
  let sampleCondition: { cid: string; token_id_0: string; token_id_1: string } | null = null;
  for (const [cid, tokens] of conditions) {
    if (tokens.token_id_0 && tokens.token_id_1) {
      sampleCondition = { cid, token_id_0: tokens.token_id_0, token_id_1: tokens.token_id_1 };
      break;
    }
  }

  if (!sampleCondition) {
    console.log('No complete condition found');
    return;
  }

  console.log('Sample condition:', sampleCondition.cid);
  console.log('Token 0:', sampleCondition.token_id_0.slice(0, 30) + '...');
  console.log('Token 1:', sampleCondition.token_id_1.slice(0, 30) + '...');

  // Get CTF splits for this condition
  const ctfSplitQuery = `
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
    AND lower(condition_id) = '${sampleCondition.cid}'
    AND is_deleted = 0
    ORDER BY event_timestamp
  `;

  const ctfResult = await clickhouse.query({ query: ctfSplitQuery, format: 'JSONEachRow' });
  const ctfRows = (await ctfResult.json()) as any[];

  console.log('\nCTF events for this condition:');
  for (const r of ctfRows) {
    console.log(`  ${r.event_timestamp} | ${r.event_type} | ${r.amount.toFixed(2)} tokens`);
  }

  // Get CLOB trades for token_id_0
  const clobQuery0 = `
    SELECT
      side,
      token_amount / 1e6 as tokens,
      usdc_amount / 1e6 as usdc,
      trade_time
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND token_id = '${sampleCondition.token_id_0}'
      AND is_deleted = 0
    ORDER BY trade_time
  `;

  const clobResult0 = await clickhouse.query({ query: clobQuery0, format: 'JSONEachRow' });
  const clobRows0 = (await clobResult0.json()) as any[];

  console.log('\nCLOB trades for token_id_0:');
  for (const r of clobRows0) {
    console.log(`  ${r.trade_time} | ${r.side} | ${r.tokens.toFixed(2)} tokens @ $${(r.usdc / r.tokens).toFixed(4)}`);
  }

  // Get CLOB trades for token_id_1
  const clobQuery1 = `
    SELECT
      side,
      token_amount / 1e6 as tokens,
      usdc_amount / 1e6 as usdc,
      trade_time
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND token_id = '${sampleCondition.token_id_1}'
      AND is_deleted = 0
    ORDER BY trade_time
  `;

  const clobResult1 = await clickhouse.query({ query: clobQuery1, format: 'JSONEachRow' });
  const clobRows1 = (await clobResult1.json()) as any[];

  console.log('\nCLOB trades for token_id_1:');
  for (const r of clobRows1) {
    console.log(`  ${r.trade_time} | ${r.side} | ${r.tokens.toFixed(2)} tokens @ $${(r.usdc / r.tokens).toFixed(4)}`);
  }

  // Summary
  const totalSplitTokens = ctfRows
    .filter(r => r.event_type === 'PositionSplit')
    .reduce((sum, r) => sum + r.amount, 0);

  const totalSellTokens0 = clobRows0
    .filter(r => r.side === 'sell')
    .reduce((sum, r) => sum + r.tokens, 0);

  const totalSellTokens1 = clobRows1
    .filter(r => r.side === 'sell')
    .reduce((sum, r) => sum + r.tokens, 0);

  console.log('\nSummary:');
  console.log(`  Split tokens (creates ${totalSplitTokens.toFixed(2)} of EACH outcome)`);
  console.log(`  Token_0 sells: ${totalSellTokens0.toFixed(2)}`);
  console.log(`  Token_1 sells: ${totalSellTokens1.toFixed(2)}`);
  console.log(`  Split covers sells? Token_0: ${totalSplitTokens >= totalSellTokens0 ? '✅' : '❌'}, Token_1: ${totalSplitTokens >= totalSellTokens1 ? '✅' : '❌'}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
