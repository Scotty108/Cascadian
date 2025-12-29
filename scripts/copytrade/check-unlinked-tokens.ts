/**
 * Check if there are tokens NOT linked via tx_hash to PositionSplit events
 * These would be tokens bought from other traders on CLOB (not via split)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== CHECKING FOR UNLINKED TOKENS ===\n');

  // All unique tokens from CLOB trades
  const allTokensQ = `
    SELECT DISTINCT token_id
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
  `;
  const allR = await clickhouse.query({ query: allTokensQ, format: 'JSONEachRow' });
  const allTokens = new Set((await allR.json() as any[]).map((t) => t.token_id));
  console.log('Total unique tokens from CLOB:', allTokens.size);

  // Tokens linked to conditions via tx_hash (in same tx as PositionSplit)
  const linkedQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    ),
    ctf_conditions AS (
      SELECT tx_hash, condition_id
      FROM pm_ctf_events
      WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
    )
    SELECT DISTINCT t.token_id
    FROM pm_trader_events_v2 t
    JOIN ctf_conditions c ON c.tx_hash = lower(concat('0x', hex(t.transaction_hash)))
    WHERE t.trader_wallet = '${WALLET}' AND t.is_deleted = 0
  `;
  const linkedR = await clickhouse.query({ query: linkedQ, format: 'JSONEachRow' });
  const linkedTokens = new Set((await linkedR.json() as any[]).map((t) => t.token_id));
  console.log('Tokens linked to conditions via tx_hash:', linkedTokens.size);

  // Find unlinked tokens
  const unlinked = [...allTokens].filter((t) => !linkedTokens.has(t));
  console.log('\nUnlinked tokens (not in split tx):', unlinked.length);

  if (unlinked.length > 0) {
    // Check positions of unlinked tokens
    const unlinkedList = unlinked.map((t) => `'${t}'`).join(',');
    const posQ = `
      SELECT
        token_id,
        sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_position,
        sum(if(side = 'buy', usdc_amount, 0)) / 1e6 as total_bought,
        sum(if(side = 'sell', usdc_amount, 0)) / 1e6 as total_sold
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}'
        AND is_deleted = 0
        AND token_id IN (${unlinkedList})
      GROUP BY token_id
    `;
    const posR = await clickhouse.query({ query: posQ, format: 'JSONEachRow' });
    const positions = (await posR.json()) as any[];

    console.log('\nUnlinked token positions:');
    let totalUnlinkedHeld = 0;
    for (const p of positions) {
      const pos = parseFloat(p.net_position);
      console.log(
        `  ${p.token_id.slice(0, 30)}... pos=${pos.toFixed(2)} bought=$${parseFloat(p.total_bought).toFixed(2)} sold=$${parseFloat(p.total_sold).toFixed(2)}`
      );
      if (pos > 0) {
        totalUnlinkedHeld += pos;
      }
    }
    console.log('\nTotal unlinked held tokens:', totalUnlinkedHeld.toFixed(2));
    console.log('If these are winners, potential value: $', totalUnlinkedHeld.toFixed(2));
  } else {
    console.log('All tokens are linked to PositionSplit events via tx_hash');
  }

  // Also check: are there multiple trades per token? Maybe we're missing some
  console.log('\n=== TRADE COUNTS PER TOKEN ===');
  const countQ = `
    SELECT
      token_id,
      count() as trade_count,
      sum(if(side = 'buy', 1, 0)) as buys,
      sum(if(side = 'sell', 1, 0)) as sells
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    GROUP BY token_id
    ORDER BY trade_count DESC
    LIMIT 10
  `;
  const countR = await clickhouse.query({ query: countQ, format: 'JSONEachRow' });
  const counts = (await countR.json()) as any[];
  for (const c of counts) {
    console.log(`  ${c.token_id.slice(0, 30)}... trades=${c.trade_count} buys=${c.buys} sells=${c.sells}`);
  }
}

main().catch(console.error);
