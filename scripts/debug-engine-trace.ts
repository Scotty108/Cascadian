/**
 * Debug trace through the CCR-v1 engine for Lheo
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

  // Step 1: Get CTF events
  console.log('Step 1: Loading CTF events...');
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
    WHERE (
      (tx_hash IN (SELECT tx_hash FROM wallet_hashes) AND lower(user_address) IN (${proxyList}))
      OR lower(user_address) = lower('${WALLET}')
    )
    AND is_deleted = 0
    ORDER BY event_timestamp
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const rawCTFEvents = (await ctfResult.json()) as any[];
  console.log(`  Found ${rawCTFEvents.length} CTF events`);

  // Step 2: Get unique condition_ids
  const ctfConditionIds = [...new Set(rawCTFEvents.map(e => e.condition_id.toLowerCase()))];
  console.log(`\nStep 2: ${ctfConditionIds.length} unique conditions`);

  // Step 3: Map conditions to token_ids
  console.log('\nStep 3: Mapping conditions to token_ids...');
  const conditionList = ctfConditionIds.slice(0, 10).map(c => `'${c}'`).join(',');
  const tokenMapQuery = `
    SELECT
      lower(condition_id) as condition_id,
      token_id_dec,
      outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) IN (${conditionList})
  `;

  const tokenMapResult = await clickhouse.query({ query: tokenMapQuery, format: 'JSONEachRow' });
  const tokenMapRows = (await tokenMapResult.json()) as any[];
  console.log(`  Found ${tokenMapRows.length} token mappings for first 10 conditions`);

  // Group by condition_id
  const conditionToTokens = new Map<string, { token_id_0?: string; token_id_1?: string }>();
  for (const row of tokenMapRows) {
    const entry = conditionToTokens.get(row.condition_id) || {};
    if (row.outcome_index === 0) entry.token_id_0 = row.token_id_dec;
    else if (row.outcome_index === 1) entry.token_id_1 = row.token_id_dec;
    conditionToTokens.set(row.condition_id, entry);
  }

  console.log(`  Built map with ${conditionToTokens.size} conditions`);

  // Step 4: Check how many conditions have complete mappings
  let completeCount = 0;
  let incompleteCount = 0;
  for (const [cid, tokens] of conditionToTokens) {
    if (tokens.token_id_0 && tokens.token_id_1) {
      completeCount++;
    } else {
      incompleteCount++;
      console.log(`    Incomplete: ${cid} has token_0=${!!tokens.token_id_0} token_1=${!!tokens.token_id_1}`);
    }
  }
  console.log(`  Complete: ${completeCount}, Incomplete: ${incompleteCount}`);

  // Step 5: Sample CTF split conversion
  console.log('\nStep 5: Sample CTF split to unified events...');
  const sampleSplit = rawCTFEvents.find(e => e.event_type === 'PositionSplit');
  if (sampleSplit) {
    console.log(`  CTF split: ${sampleSplit.condition_id.slice(0, 20)}... amount=${sampleSplit.amount}`);
    const tokens = conditionToTokens.get(sampleSplit.condition_id.toLowerCase());
    if (tokens) {
      console.log(`  -> token_0: ${tokens.token_id_0?.slice(0, 20)}...`);
      console.log(`  -> token_1: ${tokens.token_id_1?.slice(0, 20)}...`);
      console.log('  Would create 2 BUY events at $0.50 each');
    } else {
      console.log('  -> NO TOKEN MAPPING FOUND');
    }
  }

  // Step 6: Check if one of those tokens appears in CLOB sells
  if (sampleSplit) {
    const tokens = conditionToTokens.get(sampleSplit.condition_id.toLowerCase());
    if (tokens?.token_id_0) {
      const clobQuery = `
        SELECT side, count() as cnt, sum(token_amount / 1e6) as total_tokens
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${WALLET}')
          AND token_id = '${tokens.token_id_0}'
          AND is_deleted = 0
        GROUP BY side
      `;
      const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
      const clobRows = (await clobResult.json()) as any[];

      console.log('\nStep 6: CLOB trades for token_0:');
      for (const r of clobRows) {
        console.log(`  ${r.side}: ${r.cnt} trades, ${r.total_tokens.toFixed(2)} tokens`);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
