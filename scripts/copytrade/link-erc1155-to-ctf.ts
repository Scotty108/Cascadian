/**
 * Link ERC1155 token_ids to CTF condition_ids via tx_hash
 *
 * Theory: When PositionSplit happens, ERC1155 tokens are minted/transferred
 * in the same transaction. The ERC1155 transfer has token_id, CTF has condition_id.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== LINKING ERC1155 TOKEN IDS TO CTF CONDITION IDS ===\n');

  // Get a PositionSplit tx_hash for our wallet
  const splitQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT tx_hash, condition_id, partition_index_sets
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit'
      AND is_deleted = 0
    LIMIT 3
  `;
  const splitR = await clickhouse.query({ query: splitQ, format: 'JSONEachRow' });
  const splits = (await splitR.json()) as any[];

  console.log('Found', splits.length, 'PositionSplit events\n');

  for (const split of splits) {
    console.log('=== TX:', split.tx_hash.slice(0, 20) + '... ===');
    console.log('Condition:', split.condition_id);
    console.log('Partition:', split.partition_index_sets);

    // Find ERC1155 transfers in same tx
    const erc1155Q = `
      SELECT token_id, from_address, to_address, value
      FROM pm_erc1155_transfers
      WHERE lower(tx_hash) = '${split.tx_hash}'
        AND is_deleted = 0
    `;
    const erc1155R = await clickhouse.query({ query: erc1155Q, format: 'JSONEachRow' });
    const transfers = (await erc1155R.json()) as any[];

    console.log('ERC1155 transfers in same tx:', transfers.length);
    for (const t of transfers) {
      console.log(
        `  Token: ${t.token_id.slice(0, 30)}... from=${t.from_address.slice(0, 10)}... to=${t.to_address.slice(0, 10)}...`
      );
    }

    // Find CLOB trades in same tx
    const clobQ = `
      SELECT token_id, side, token_amount / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(concat('0x', hex(transaction_hash))) = '${split.tx_hash}'
        AND trader_wallet = '${WALLET}'
        AND is_deleted = 0
    `;
    const clobR = await clickhouse.query({ query: clobQ, format: 'JSONEachRow' });
    const clobs = (await clobR.json()) as any[];

    console.log('CLOB trades in same tx:', clobs.length);
    for (const c of clobs) {
      console.log(`  Token: ${c.token_id.slice(0, 30)}... ${c.side} ${c.tokens}`);
    }

    console.log('');
  }

  // Check if ERC1155 data is available for recent transactions
  console.log('=== ERC1155 DATA AVAILABILITY ===');
  const rangeQ = `
    SELECT
      min(block_timestamp) as earliest,
      max(block_timestamp) as latest,
      count() as total
    FROM pm_erc1155_transfers
    WHERE is_deleted = 0
  `;
  const rangeR = await clickhouse.query({ query: rangeQ, format: 'JSONEachRow' });
  const range = (await rangeR.json() as any[])[0];
  console.log('ERC1155 data range:', range.earliest, 'to', range.latest);
  console.log('Total transfers:', range.total);

  // Check if wallet's trades fall within ERC1155 range
  const walletRangeQ = `
    SELECT
      min(trade_time) as earliest,
      max(trade_time) as latest
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
  `;
  const walletRangeR = await clickhouse.query({ query: walletRangeQ, format: 'JSONEachRow' });
  const walletRange = (await walletRangeR.json() as any[])[0];
  console.log('\nWallet trade range:', walletRange.earliest, 'to', walletRange.latest);

  // If ERC1155 pipeline stopped before wallet's trades, that's our blocker
  console.log('\n=== ALTERNATIVE: MATCH VIA CLOB TOKEN ID ===');
  console.log('Since tx_hash links CLOB (token_id) to CTF (condition_id),');
  console.log('we can derive the mapping without ERC1155 data.');
  console.log('The remaining question is: which token is outcome 0 vs 1?');

  // Check if any trades are KNOWN mapped tokens
  const mappedQ = `
    SELECT COUNT(DISTINCT t.token_id) as mapped
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v5 m ON m.token_id_dec = t.token_id
    WHERE t.trader_wallet = '${WALLET}' AND t.is_deleted = 0
  `;
  const mappedR = await clickhouse.query({ query: mappedQ, format: 'JSONEachRow' });
  const mapped = (await mappedR.json() as any[])[0];
  console.log('\nWallet tokens in pm_token_to_condition_map_v5:', mapped.mapped);

  // Check total unique tokens for this wallet
  const totalQ = `
    SELECT COUNT(DISTINCT token_id) as total
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
  `;
  const totalR = await clickhouse.query({ query: totalQ, format: 'JSONEachRow' });
  const total = (await totalR.json() as any[])[0];
  console.log('Wallet total unique tokens:', total.total);
  console.log('Coverage:', ((parseInt(mapped.mapped) / parseInt(total.total)) * 100).toFixed(1) + '%');
}

main().catch(console.error);
