/**
 * Check if any markets are unresolved (could explain missing held value)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { ClobClient } from '@polymarket/clob-client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  const client = new ClobClient('https://clob.polymarket.com', 137);

  // Get all conditions
  const condQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit' AND is_deleted = 0
  `;
  const conditions = (await (await clickhouse.query({ query: condQ, format: 'JSONEachRow' })).json()) as any[];

  let resolved = 0;
  let unresolved = 0;
  let notFound = 0;

  console.log('Checking', conditions.length, 'conditions...\n');

  for (const { condition_id } of conditions) {
    try {
      const m = await client.getMarket('0x' + condition_id);
      if (!m || !m.tokens) {
        notFound++;
        console.log(`NOT FOUND: ${condition_id.slice(0, 20)}...`);
        continue;
      }

      const allResolved = m.tokens.every(
        (t: any) => t.winner === true || t.winner === false
      );
      if (allResolved) {
        resolved++;
      } else {
        unresolved++;
        console.log(
          `UNRESOLVED: ${condition_id.slice(0, 20)}... ${m.question?.slice(0, 40)}...`
        );
        for (const t of m.tokens) {
          console.log(`  - ${t.outcome}: winner=${t.winner} price=${t.price}`);
        }
      }
    } catch {
      notFound++;
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('Resolved:', resolved);
  console.log('Unresolved:', unresolved);
  console.log('Not found:', notFound);

  // Get positions for tokens from not-found markets
  if (notFound > 0) {
    console.log('\n=== CHECKING POSITIONS IN NOT-FOUND MARKETS ===');

    // Get positions per token
    const posQ = `
      SELECT token_id, sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_position
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY token_id
      HAVING net_position > 0
    `;
    const positions = (await (await clickhouse.query({ query: posQ, format: 'JSONEachRow' })).json()) as any[];

    // Check which tokens are mapped
    let mappedValue = 0;
    let unmappedValue = 0;

    for (const p of positions) {
      const pos = parseFloat(p.net_position);
      // Check if this token was in a found market (we'd need to track this)
      // For now, just report totals
    }

    console.log(
      'Total long positions:',
      positions.reduce((s: number, p: any) => s + parseFloat(p.net_position), 0).toFixed(2)
    );
  }
}

main().catch(console.error);
