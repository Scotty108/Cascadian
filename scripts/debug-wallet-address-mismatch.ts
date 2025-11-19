import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function debugWalletMismatch() {
  const sampleTx = '0x407bda518931e05a1e8e901b22e916508bb38f857b1920b0e7ff197be6926dfe';

  console.log('Debugging Wallet Address Mismatch\n');
  console.log('Sample TX:', sampleTx);
  console.log('='.repeat(80) + '\n');

  // Get wallets from orphan table
  console.log('1. Wallets in tmp_v3_orphans_oct2024:');
  const orphanWallets = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet_address
      FROM tmp_v3_orphans_oct2024
      WHERE transaction_hash = '${sampleTx}'
    `,
    format: 'JSONEachRow'
  });
  const orphanWalletsList = await orphanWallets.json();
  console.log(JSON.stringify(orphanWalletsList, null, 2));

  // Get wallets from vw_trades_canonical
  console.log('\n2. Wallets in vw_trades_canonical:');
  const vtcWallets = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet_address_norm
      FROM vw_trades_canonical
      WHERE transaction_hash = '${sampleTx}'
    `,
    format: 'JSONEachRow'
  });
  const vtcWalletsList = await vtcWallets.json();
  console.log(JSON.stringify(vtcWalletsList, null, 2));

  // Get wallets from trades_cid_map_v2_merged
  console.log('\n3. Wallets in trades_cid_map_v2_merged:');
  const tcmWallets = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet_address
      FROM trades_cid_map_v2_merged
      WHERE transaction_hash = '${sampleTx}'
    `,
    format: 'JSONEachRow'
  });
  const tcmWalletsList = await tcmWallets.json();
  console.log(JSON.stringify(tcmWalletsList, null, 2));

  // Get full rows from each table
  console.log('\n4. Full comparison:');
  console.log('\n   tmp_v3_orphans_oct2024:');
  const orphanRows = await clickhouse.query({
    query: `
      SELECT transaction_hash, wallet_address, outcome_index_v2, id_repair_source
      FROM tmp_v3_orphans_oct2024
      WHERE transaction_hash = '${sampleTx}'
    `,
    format: 'JSONEachRow'
  });
  const orphanRowsList = await orphanRows.json();
  console.log(JSON.stringify(orphanRowsList, null, 2));

  console.log('\n   vw_trades_canonical:');
  const vtcRows = await clickhouse.query({
    query: `
      SELECT transaction_hash, wallet_address_norm, outcome_index, condition_id_norm
      FROM vw_trades_canonical
      WHERE transaction_hash = '${sampleTx}'
    `,
    format: 'JSONEachRow'
  });
  const vtcRowsList = await vtcRows.json();
  console.log(JSON.stringify(vtcRowsList, null, 2));

  console.log('\n   trades_cid_map_v2_merged:');
  const tcmRows = await clickhouse.query({
    query: `
      SELECT transaction_hash, wallet_address, outcome_index, condition_id_norm
      FROM trades_cid_map_v2_merged
      WHERE transaction_hash = '${sampleTx}'
    `,
    format: 'JSONEachRow'
  });
  const tcmRowsList = await tcmRows.json();
  console.log(JSON.stringify(tcmRowsList, null, 2));

  // Try a join test with this specific transaction
  console.log('\n5. Testing JOIN with this specific transaction:');
  const joinTest = await clickhouse.query({
    query: `
      SELECT
        o.transaction_hash,
        o.wallet_address as orphan_wallet,
        o.outcome_index_v2 as orphan_outcome,
        vtc.wallet_address_norm as vtc_wallet,
        vtc.outcome_index as vtc_outcome,
        vtc.condition_id_norm as vtc_condition_id,
        o.wallet_address = vtc.wallet_address_norm as wallets_match,
        o.outcome_index_v2 = vtc.outcome_index as outcomes_match
      FROM tmp_v3_orphans_oct2024 o
      LEFT JOIN vw_trades_canonical vtc
        ON o.transaction_hash = vtc.transaction_hash
      WHERE o.transaction_hash = '${sampleTx}'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const joinTestResult = await joinTest.json();
  console.log(JSON.stringify(joinTestResult, null, 2));

  console.log('\n6. Testing JOIN without wallet constraint:');
  const joinTest2 = await clickhouse.query({
    query: `
      SELECT
        count() as total_orphan_rows,
        countIf(vtc.condition_id_norm IS NOT NULL) as joined_rows,
        countIf(vtc.condition_id_norm IS NOT NULL AND length(vtc.condition_id_norm) = 64) as valid_joins
      FROM tmp_v3_orphans_oct2024 o
      LEFT JOIN vw_trades_canonical vtc
        ON o.transaction_hash = vtc.transaction_hash
    `,
    format: 'JSONEachRow'
  });
  const joinTest2Result = await joinTest2.json();
  console.log(JSON.stringify(joinTest2Result, null, 2));
}

debugWalletMismatch()
  .then(() => {
    console.log('\n✓ Debug complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
