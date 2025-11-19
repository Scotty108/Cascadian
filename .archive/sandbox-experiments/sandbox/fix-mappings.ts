import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function createFixedMappingTable(): Promise<void> {
  console.log('🔄 Fixing token mapping by adding decimal→hex conversions...');

  try {
    // Create a mapping table that handles the conversion
    await clickhouse.query({
      query: `
        CREATE TABLE IF NOT EXISTS sandbox.token_cid_map_fixed (
          token_hex String,
          condition_id_64 String,
          outcome_idx Int32,
          key_type LowCardinality(String)
        )
        ENGINE = ReplacingMergeTree()
        ORDER BY token_hex
        SETTINGS index_granularity = 8192
      `,
      format: 'JSONEachRow'
    });

    // Copy existing mappings
    await clickhouse.query({
      query: `
        INSERT INTO sandbox.token_cid_map_fixed
        SELECT token_hex, condition_id_64, outcome_idx, 'hex'
        FROM sandbox.token_cid_map
      `,
      format: 'JSONEachRow'
    });

    // Calculate missing mappings from asset_ids by manual approach
    let successfulConversions = 0;

    // Get distinct asset_ids for wallet
    const assetIds = await clickhouse.query({
      query: `
        SELECT DISTINCT asset_id
        FROM default.clob_fills
        WHERE lower(proxy_wallet) = lower('${WALLET}')
           OR lower(user_eoa) = lower('${WALLET}')
        ORDER BY asset_id
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });
    const assetData = await assetIds.json();

    console.log(`Processing ${assetData.length} asset_ids for conversion...`);

    for (const row of assetData) {
      try {
        // Convert decimal to hex string
        const bigIntValue = BigInt(row.asset_id);
        const hexValue = bigIntValue.toString(16);
        console.log(`${row.asset_id.slice(0, 20)}... → 0x${hexValue}`);

        // Check if this hex value exists in token_cid_map
        const existing = await clickhouse.query({
          query: `SELECT token_hex, condition_id_64, outcome_idx FROM sandbox.token_cid_map WHERE token_hex = '${hexValue}'`,
          format: 'JSONEachRow'
        });
        const existingData = await existing.json();

        if (existingData.length > 0) {
          console.log(`  ✅ Found mapping: ${existingData[0].condition_id_64.slice(0, 20)}...:${existingData[0].outcome_idx}`);
          successfulConversions++;

          // Insert the hex mapping
          await clickhouse.query({
            query: `INSERT INTO sandbox.token_cid_map_fixed VALUES ('${hexValue}', '${existingData[0].condition_id_64}', ${existingData[0].outcome_idx}, 'hex')`,
            format: 'JSONEachRow'
          });
        } else {
          console.log(`  ❌ No mapping found for ${hexValue.slice(0, 20)}...`);

          // TODO: Try to find mapping via ERC-1155 lookup or manual resolution
          // For now, we'll leave these as unmapped
        }

      } catch (e) {
        console.log(`  ❌ Conversion error for ${row.asset_id}: ${e}`);
      }
    }

    console.log(`\n🎯 Conversion complete: ${successfulConversions}/${assetData.length} successful`);

    // Check final stats
    const finalStats = await clickhouse.query({
      query: 'SELECT count() as total, countDistinct(token_hex) as unique_tokens FROM sandbox.token_cid_map_fixed',
      format: 'JSONEachRow'
    });
    const stats = await finalStats.json();
    console.log(`Total mappings in fixed table: ${stats[0].total} rows, ${stats[0].unique_tokens} unique tokens`);

  } catch (error) {
    console.error('❌ Fixed mapping creation failed:', error);
    throw error;
  }
}

createFixedMappingTable().catch(console.error);