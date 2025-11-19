import { clickhouse } from './lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkFormat() {
  console.log('Checking clob_fills asset ID formats...\n');

  // Sample makerAssetId and takerAssetId
  const result = await clickhouse.query({
    query: `
      SELECT
        maker_asset_id,
        taker_asset_id,
        condition_id,
        transaction_hash
      FROM clob_fills
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const data: any = await result.json();

  console.log('Sample clob_fills records:');
  data.forEach((row: any, i: number) => {
    console.log(`\n${i + 1}.`);
    console.log(`  maker_asset_id: ${row.maker_asset_id} (length: ${row.maker_asset_id?.length || 0})`);
    console.log(`  taker_asset_id: ${row.taker_asset_id} (length: ${row.taker_asset_id?.length || 0})`);
    console.log(`  condition_id: ${row.condition_id} (length: ${row.condition_id?.length || 0})`);
    console.log(`  tx_hash: ${row.transaction_hash}`);
  });

  // Check schema
  console.log('\n\nclob_fills schema:');
  const schema = await clickhouse.query({
    query: 'DESCRIBE clob_fills',
    format: 'JSONEachRow'
  });
  const schemaData: any = await schema.json();
  schemaData.forEach((col: any) => {
    if (col.name.includes('asset') || col.name.includes('condition')) {
      console.log(`  ${col.name}: ${col.type}`);
    }
  });
}

checkFormat().catch(console.error);
