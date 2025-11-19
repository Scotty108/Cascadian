import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const ctfId = '9f37e89c66465d7680ef60341a76ba553bb08437df158e7046b48618c4a822';

  console.log(`Looking for CTF ID: ${ctfId}\n`);

  // Check if exists with LIKE
  const likeQuery = await clickhouse.query({
    query: `
      SELECT condition_id_ctf, condition_id_market
      FROM cid_bridge
      WHERE condition_id_ctf LIKE '9f37e89c6646%'
    `,
    format: 'JSONEachRow'
  });
  const likeResults: any[] = await likeQuery.json();

  console.log(`Found ${likeResults.length} results with LIKE\n`);

  if (likeResults.length > 0) {
    likeResults.forEach((r, i) => {
      console.log(`${i + 1}. CTF: ${r.condition_id_ctf || 'undefined'}`);
      console.log(`   Market: ${r.condition_id_market || 'undefined'}`);
      console.log(`   CTF length: ${(r.condition_id_ctf || '').length}`);
      console.log(`   Market length: ${(r.condition_id_market || '').length}\n`);
    });
  }

  // Also check what asset_id=720165... gives us in clob_fills
  const assetId = '72016524934977102644827669188692754213186711249642025547408896104495709692655';
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Checking clob_fills for this asset_id...\n');

  const clobQuery = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        condition_id,
        lower(hex(bitShiftRight(toUInt256(asset_id), 8))) AS condition_id_ctf,
        replaceAll(lower(condition_id), '0x', '') AS condition_id_market
      FROM clob_fills
      WHERE asset_id = '${assetId}'
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const clob = await clobQuery.json();

  if (clob.length > 0) {
    console.log('From clob_fills:');
    console.log(`   asset_id: ${clob[0].asset_id}`);
    console.log(`   Original condition_id: ${clob[0].condition_id}`);
    console.log(`   Decoded CTF: ${clob[0].condition_id_ctf} (len: ${clob[0].condition_id_ctf.length})`);
    console.log(`   Market: ${clob[0].condition_id_market} (len: ${clob[0].condition_id_market.length})\n`);

    // Now check if THIS specific market ID is in market_resolutions_final
    console.log(`Checking if market ${clob[0].condition_id_market} has resolution...\n`);
    const resQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          payout_numerators,
          winning_index
        FROM market_resolutions_final
        WHERE condition_id_norm = '${clob[0].condition_id_market}'
      `,
      format: 'JSONEachRow'
    });
    const res = await resQuery.json();

    if (res.length > 0) {
      console.log('✅ Found resolution!');
      console.log(`   condition_id_norm: ${res[0].condition_id_norm}`);
      console.log(`   payout_numerators: [${res[0].payout_numerators.join(', ')}]`);
      console.log(`   winning_index: ${res[0].winning_index}\n`);
    } else {
      console.log('❌ No resolution found!\n');
    }
  }
}

main().catch(console.error);
