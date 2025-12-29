/**
 * Fetch token metadata from CLOB API for condition_ids
 *
 * The CLOB getMarket(conditionId) returns tokens[] with:
 * - token_id
 * - outcome (label)
 * - price
 * - winner (boolean, when resolved)
 *
 * This eliminates the need for greedy optimization!
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { ClobClient } from '@polymarket/clob-client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== FETCHING TOKEN METADATA FROM CLOB API ===\n');

  // Initialize CLOB client
  const client = new ClobClient('https://clob.polymarket.com', 137);

  // Get condition_ids from our wallet via tx_hash correlation
  const condQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
  `;
  const condR = await clickhouse.query({ query: condQ, format: 'JSONEachRow' });
  const conditions = (await condR.json()) as { condition_id: string }[];

  console.log(`Found ${conditions.length} condition_ids to look up\n`);

  // Fetch market metadata for each condition
  let successCount = 0;
  let failCount = 0;
  const tokenMappings: {
    token_id: string;
    condition_id: string;
    outcome: string;
    winner: boolean | null;
    price: number;
  }[] = [];

  for (const { condition_id } of conditions.slice(0, 5)) {
    // Test first 5
    try {
      console.log(`Fetching condition: ${condition_id.slice(0, 20)}...`);

      // Need to format condition_id with 0x prefix
      const formattedCondId = condition_id.startsWith('0x') ? condition_id : `0x${condition_id}`;

      const market = await client.getMarket(formattedCondId);

      if (market && market.tokens) {
        console.log(`  Question: ${market.question?.slice(0, 60)}...`);
        console.log(`  Tokens: ${market.tokens.length}`);

        for (const t of market.tokens) {
          console.log(`    - ${t.token_id.slice(0, 30)}... outcome="${t.outcome}" winner=${t.winner} price=${t.price}`);
          tokenMappings.push({
            token_id: t.token_id,
            condition_id,
            outcome: t.outcome,
            winner: t.winner ?? null,
            price: parseFloat(t.price || '0'),
          });
        }
        successCount++;
      } else {
        console.log(`  No market data returned`);
        failCount++;
      }
    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
      failCount++;
    }
    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`Success: ${successCount}/${conditions.slice(0, 5).length}`);
  console.log(`Failed: ${failCount}/${conditions.slice(0, 5).length}`);
  console.log(`Token mappings derived: ${tokenMappings.length}`);

  if (tokenMappings.length > 0) {
    console.log('\n=== SAMPLE MAPPINGS ===');
    for (const m of tokenMappings.slice(0, 6)) {
      console.log(`  ${m.token_id.slice(0, 25)}... → outcome="${m.outcome}" winner=${m.winner}`);
    }

    // Calculate held value using winner flag
    console.log('\n=== CALCULATING HELD VALUE FROM WINNER FLAGS ===');

    // Get token positions
    const posQ = `
      SELECT
        token_id,
        sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_position
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY token_id
      HAVING net_position > 0
    `;
    const posR = await clickhouse.query({ query: posQ, format: 'JSONEachRow' });
    const positions = (await posR.json()) as { token_id: string; net_position: string }[];

    // Build token → winner map
    const winnerMap = new Map<string, boolean | null>();
    const priceMap = new Map<string, number>();
    for (const m of tokenMappings) {
      winnerMap.set(m.token_id, m.winner);
      priceMap.set(m.token_id, m.price);
    }

    let heldValue = 0;
    let matchedTokens = 0;
    for (const p of positions) {
      const winner = winnerMap.get(p.token_id);
      const price = priceMap.get(p.token_id);
      const pos = parseFloat(p.net_position);

      if (winner !== undefined) {
        matchedTokens++;
        if (winner === true) {
          heldValue += pos * 1; // Winner gets $1
        } else if (winner === false) {
          heldValue += pos * 0; // Loser gets $0
        } else if (price !== undefined) {
          heldValue += pos * price; // Unresolved - use price
        }
      }
    }

    console.log(`Matched ${matchedTokens}/${positions.length} held tokens`);
    console.log(`Held value from CLOB metadata: $${heldValue.toFixed(2)}`);
  }
}

main().catch(console.error);
