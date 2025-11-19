import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkDuplication() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET DUPLICATION CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check for transaction hash duplication
  console.log('Checking for duplicate transaction hashes...\n');

  const dupCheckQuery = `
    SELECT
      transaction_hash,
      count() AS row_count,
      uniq(trade_id) AS unique_trade_ids,
      uniq(source) AS sources,
      groupArray(source) AS source_list
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_WALLET}'
    GROUP BY transaction_hash
    HAVING row_count > 1
    ORDER BY row_count DESC
    LIMIT 10
  `;

  const dupResult = await clickhouse.query({ query: dupCheckQuery, format: 'JSONEachRow' });
  const dupData = await dupResult.json();

  if (dupData.length > 0) {
    console.log(`Found ${dupData.length} transaction hashes with duplicates:\n`);
    for (const row of dupData) {
      console.log(`  TX ${row.transaction_hash.substring(0, 20)}...`);
      console.log(`    Row count: ${row.row_count}`);
      console.log(`    Unique trade IDs: ${row.unique_trade_ids}`);
      console.log(`    Sources: ${row.source_list.join(', ')}\n`);
    }
  } else {
    console.log('✅ No duplicate transaction hashes found\n');
  }

  // Check for overall duplication rate
  console.log('Checking overall duplication metrics...\n');

  const overallQuery = `
    SELECT
      count() AS total_rows,
      uniq(transaction_hash) AS unique_txs,
      uniq(trade_id) AS unique_trade_ids,
      uniq(transaction_hash, wallet_address, condition_id_norm_v3, outcome_index_v3) AS unique_trades_logical,
      total_rows - unique_trades_logical AS potential_duplicates
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_WALLET}'
  `;

  const overallResult = await clickhouse.query({ query: overallQuery, format: 'JSONEachRow' });
  const overallData = await overallResult.json();

  if (overallData.length > 0) {
    const o = overallData[0];
    console.log(`  Total rows:            ${o.total_rows.toLocaleString()}`);
    console.log(`  Unique transactions:   ${o.unique_txs.toLocaleString()}`);
    console.log(`  Unique trade IDs:      ${o.unique_trade_ids.toLocaleString()}`);
    console.log(`  Unique logical trades: ${o.unique_trades_logical.toLocaleString()}`);
    console.log(`  Potential duplicates:  ${o.potential_duplicates.toLocaleString()} (${((o.potential_duplicates / o.total_rows) * 100).toFixed(2)}%)\n`);
  }

  // Sample some trades to see if amounts look reasonable
  console.log('Sampling recent trades...\n');

  const sampleQuery = `
    SELECT
      transaction_hash,
      trade_direction,
      usd_value,
      shares,
      price,
      timestamp,
      source
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_WALLET}'
    ORDER BY timestamp DESC
    LIMIT 10
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json();

  for (const row of sampleData) {
    console.log(`  ${row.timestamp} | ${row.trade_direction} | $${parseFloat(row.usd_value).toFixed(2)} | ${parseFloat(row.shares).toFixed(2)} shares @ $${parseFloat(row.price).toFixed(4)} | ${row.source}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
}

checkDuplication()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
