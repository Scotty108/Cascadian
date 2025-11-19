import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ASSET_ID ENCODING CHECK');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get sample raw asset_id values
  const rawQuery = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        any(condition_id) as condition_id,
        any(side) as side,
        count() as trade_count
      FROM clob_fills
      WHERE lower(user_eoa) = lower('${wallet}')
        AND asset_id != 'asset'
      GROUP BY asset_id
      ORDER BY trade_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const raw = await rawQuery.json();

  console.log('Sample asset_id values from clob_fills:\n');

  raw.forEach((r: any, i: number) => {
    console.log(`${i + 1}. asset_id: ${r.asset_id}`);
    console.log(`   condition_id: ${r.condition_id}`);
    console.log(`   side: ${r.side}`);
    console.log(`   trades: ${r.trade_count}\n`);
  });

  // Now decode these asset_ids
  console.log('Decoding asset_ids:\n');

  for (const r of raw.slice(0, 5)) {
    const decodeQuery = await clickhouse.query({
      query: `
        SELECT
          '${r.asset_id}' AS asset_id_orig,
          lower(hex(bitShiftRight(toUInt256('${r.asset_id}'), 8))) AS condition_id_ctf,
          toUInt16(bitAnd(toUInt256('${r.asset_id}'), 255)) AS index_set_mask
      `,
      format: 'JSONEachRow'
    });
    const decoded = await decodeQuery.json();

    console.log(`asset_id: ${r.asset_id}`);
    console.log(`  → condition_id_ctf: ${decoded[0].condition_id_ctf}`);
    console.log(`  → index_set_mask: ${decoded[0].index_set_mask} (binary: ${decoded[0].index_set_mask.toString(2).padStart(8, '0')})`);
    console.log(`  Original condition_id from clob_fills: ${r.condition_id}\n`);
  }

  // Compare Polymarket API token format
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('POLYMARKET TOKEN FORMAT ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Polymarket uses ERC-1155 Conditional Tokens:');
  console.log('  token_id = (condition_id << 8) | index_set_mask\n');
  console.log('For binary markets (2 outcomes):');
  console.log('  Outcome 0 (NO): index_set = 1 (binary 00000001)');
  console.log('  Outcome 1 (YES): index_set = 2 (binary 00000010)\n');
  console.log('But we see masks like 195 (11000011), 239 (11101111), etc.');
  console.log('This suggests the asset_id format in clob_fills is DIFFERENT!\n');

  // Check if asset_id is already the full token_id or something else
  console.log('Hypothesis: asset_id might be the token_id directly, not encoded differently.');
  console.log('Let me check the asset_id format...\n');

  const formatCheckQuery = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        length(asset_id) as len,
        substring(asset_id, 1, 2) as prefix
      FROM clob_fills
      WHERE lower(user_eoa) = lower('${wallet}')
        AND asset_id != 'asset'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const formatCheck = await formatCheckQuery.json();

  console.log('asset_id format:');
  formatCheck.forEach((f: any) => {
    console.log(`  ${f.asset_id} (length: ${f.len}, prefix: "${f.prefix}")`);
  });
  console.log();
}

main().catch(console.error);
