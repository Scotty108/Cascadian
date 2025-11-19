import { config } from 'dotenv';
import { getClickHouseClient } from './lib/clickhouse/client';

// Load environment variables
config({ path: '.env.local' });

const client = getClickHouseClient();

async function main() {
  console.log('\n=== FINDING HIGHEST DUPLICATION WALLETS ===\n');

  // Find wallets with duplication > 10x
  console.log('WALLETS WITH DUPLICATION > 10x');
  console.log('-'.repeat(80));
  const highDupQuery = await client.query({
    query: `
      SELECT
        wallet_address,
        count() AS total_rows,
        uniq(transaction_hash) AS unique_txs,
        round(total_rows / unique_txs, 2) AS duplication_factor
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 != ''
      GROUP BY wallet_address
      HAVING duplication_factor > 10
      ORDER BY duplication_factor DESC
      LIMIT 100
    `,
    format: 'JSONEachRow',
  });
  const highDup = await highDupQuery.json();

  console.log(`Found ${highDup.length} wallets with duplication > 10x\n`);

  highDup.forEach((w: any, i: number) => {
    console.log(`${i + 1}. ${w.wallet_address}`);
    console.log(`   Rows: ${w.total_rows.toLocaleString()}, Unique TXs: ${w.unique_txs.toLocaleString()}, Factor: ${w.duplication_factor}x`);
  });

  // Check if XCNStrategy wallet exists
  console.log('\n\nSEARCHING FOR XCNSTRATEGY WALLET');
  console.log('-'.repeat(80));

  const xcnQuery = await client.query({
    query: `
      SELECT
        wallet_address,
        count() AS total_rows,
        uniq(transaction_hash) AS unique_txs,
        round(total_rows / unique_txs, 2) AS duplication_factor
      FROM pm_trades_canonical_v3
      WHERE wallet_address ILIKE '%xcn%'
        AND condition_id_norm_v3 != ''
      GROUP BY wallet_address
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });
  const xcn = await xcnQuery.json();

  if (xcn.length > 0) {
    console.log(`\nFound ${xcn.length} wallet(s) matching 'xcn':\n`);
    xcn.forEach((w: any) => {
      console.log(`${w.wallet_address}`);
      console.log(`   Rows: ${w.total_rows.toLocaleString()}, Unique TXs: ${w.unique_txs.toLocaleString()}, Factor: ${w.duplication_factor}x`);
    });
  } else {
    console.log('No wallets found matching "xcn"');
  }

  await client.close();
}

main().catch(console.error);
