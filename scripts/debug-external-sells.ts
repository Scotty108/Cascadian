/**
 * Debug which tokens have external sells (sells without sufficient inventory)
 * This will help identify why Lheo has 6,265 external sell tokens
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

  // Step 1: Get ALL CLOB trades grouped by token
  console.log('Step 1: Getting CLOB trade totals by token...');
  const clobQuery = `
    SELECT
      token_id,
      side,
      count() as trade_count,
      sum(token_amount / 1e6) as total_tokens
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
    GROUP BY token_id, side
    ORDER BY token_id, side
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobRows = (await clobResult.json()) as any[];

  // Build a map of token -> { buys, sells }
  const tokenTrades = new Map<string, { buys: number; sells: number; buyCount: number; sellCount: number }>();
  for (const r of clobRows) {
    const entry = tokenTrades.get(r.token_id) || { buys: 0, sells: 0, buyCount: 0, sellCount: 0 };
    if (r.side === 'buy') {
      entry.buys += r.total_tokens;
      entry.buyCount += r.trade_count;
    } else {
      entry.sells += r.total_tokens;
      entry.sellCount += r.trade_count;
    }
    tokenTrades.set(r.token_id, entry);
  }

  console.log(`  Found ${tokenTrades.size} unique tokens with CLOB activity`);

  // Step 2: Get all CTF events and map condition_id to token_ids
  console.log('\nStep 2: Getting CTF events...');
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
      sum(toFloat64OrZero(amount_or_payout) / 1e6) as total_amount
    FROM pm_ctf_events
    WHERE (
      (tx_hash IN (SELECT tx_hash FROM wallet_hashes) AND lower(user_address) IN (${proxyList}))
      OR lower(user_address) = lower('${WALLET}')
    )
    AND is_deleted = 0
    GROUP BY event_type, condition_id
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfRows = (await ctfResult.json()) as any[];

  // Build condition -> splits/merges/redemptions
  const conditionEvents = new Map<string, { splits: number; merges: number; redemptions: number }>();
  for (const r of ctfRows) {
    const cid = r.condition_id.toLowerCase();
    const entry = conditionEvents.get(cid) || { splits: 0, merges: 0, redemptions: 0 };
    if (r.event_type === 'PositionSplit') entry.splits += r.total_amount;
    else if (r.event_type === 'PositionsMerge') entry.merges += r.total_amount;
    else if (r.event_type === 'PayoutRedemption') entry.redemptions += r.total_amount;
    conditionEvents.set(cid, entry);
  }

  console.log(`  Found ${conditionEvents.size} unique conditions with CTF events`);

  // Step 3: Map condition_ids to token_ids
  console.log('\nStep 3: Mapping conditions to tokens...');
  const conditionList = [...conditionEvents.keys()].map(c => `'${c}'`).join(',');

  let conditionToTokens = new Map<string, { token_id_0: string; token_id_1: string }>();

  if (conditionList.length > 0) {
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

    for (const row of tokenMapRows) {
      const entry = conditionToTokens.get(row.condition_id) || { token_id_0: '', token_id_1: '' };
      if (row.outcome_index === 0) entry.token_id_0 = row.token_id_dec;
      else if (row.outcome_index === 1) entry.token_id_1 = row.token_id_dec;
      conditionToTokens.set(row.condition_id, entry);
    }
  }

  console.log(`  Mapped ${conditionToTokens.size} conditions to tokens`);

  // Build token -> CTF inventory (splits add, merges subtract)
  const tokenCTFInventory = new Map<string, number>();
  for (const [cid, events] of conditionEvents) {
    const tokens = conditionToTokens.get(cid);
    if (tokens) {
      if (tokens.token_id_0) {
        const current = tokenCTFInventory.get(tokens.token_id_0) || 0;
        tokenCTFInventory.set(tokens.token_id_0, current + events.splits - events.merges);
      }
      if (tokens.token_id_1) {
        const current = tokenCTFInventory.get(tokens.token_id_1) || 0;
        tokenCTFInventory.set(tokens.token_id_1, current + events.splits - events.merges);
      }
    }
  }

  console.log(`  Built CTF inventory for ${tokenCTFInventory.size} tokens`);

  // Step 4: Find tokens with sells > (buys + CTF inventory)
  console.log('\nStep 4: Analyzing inventory gaps...');

  let tokensWithExternalSells = 0;
  let totalExternalSellTokens = 0;
  const externalSellDetails: { token_id: string; sells: number; buys: number; ctfInventory: number; external: number }[] = [];

  for (const [tokenId, trades] of tokenTrades) {
    const ctfInventory = tokenCTFInventory.get(tokenId) || 0;
    const totalAvailable = trades.buys + ctfInventory;

    if (trades.sells > totalAvailable + 0.01) { // Small tolerance for rounding
      const external = trades.sells - totalAvailable;
      tokensWithExternalSells++;
      totalExternalSellTokens += external;
      externalSellDetails.push({
        token_id: tokenId,
        sells: trades.sells,
        buys: trades.buys,
        ctfInventory,
        external,
      });
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('RESULTS');
  console.log('='.repeat(80));
  console.log(`Tokens with external sells: ${tokensWithExternalSells} / ${tokenTrades.size}`);
  console.log(`Total external sell tokens: ${totalExternalSellTokens.toFixed(2)}`);

  // Show top 10 tokens by external sells
  externalSellDetails.sort((a, b) => b.external - a.external);
  console.log('\nTop 10 tokens by external sells:');
  console.log('Token ID (last 12) | Sells | Buys | CTF | External');
  console.log('-'.repeat(70));
  for (const d of externalSellDetails.slice(0, 10)) {
    console.log(`...${d.token_id.slice(-12)} | ${d.sells.toFixed(2).padStart(8)} | ${d.buys.toFixed(2).padStart(8)} | ${d.ctfInventory.toFixed(2).padStart(8)} | ${d.external.toFixed(2).padStart(8)}`);
  }

  // Step 5: Check if any external sell tokens have CTF events we're missing
  console.log('\n\nStep 5: Checking if external sell tokens have unmapped conditions...');

  if (externalSellDetails.length > 0) {
    // Get the condition_ids for the top external sell tokens
    const topTokenIds = externalSellDetails.slice(0, 10).map(d => `'${d.token_id}'`).join(',');
    const reverseMapQuery = `
      SELECT
        token_id_dec,
        condition_id,
        outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (${topTokenIds})
    `;

    const reverseMapResult = await clickhouse.query({ query: reverseMapQuery, format: 'JSONEachRow' });
    const reverseMapRows = (await reverseMapResult.json()) as any[];

    console.log('\nCondition mapping for top external sell tokens:');
    for (const r of reverseMapRows) {
      const hasCTF = conditionEvents.has(r.condition_id.toLowerCase());
      console.log(`  Token ...${r.token_id_dec.slice(-12)} -> Condition ${r.condition_id.slice(0, 12)}... outcome=${r.outcome_index} | CTF events: ${hasCTF ? '✅' : '❌ MISSING'}`);
    }

    // Check for tokens with no mapping at all
    const mappedTokens = new Set(reverseMapRows.map(r => r.token_id_dec));
    for (const d of externalSellDetails.slice(0, 10)) {
      if (!mappedTokens.has(d.token_id)) {
        console.log(`  Token ...${d.token_id.slice(-12)} -> NO CONDITION MAPPING AT ALL ❌`);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total CLOB tokens: ${tokenTrades.size}`);
  console.log(`Total CTF conditions: ${conditionEvents.size}`);
  console.log(`Mapped to ${tokenCTFInventory.size} unique token_ids`);
  console.log(`Tokens with external sells: ${tokensWithExternalSells}`);
  console.log(`Total external tokens: ${totalExternalSellTokens.toFixed(2)}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
