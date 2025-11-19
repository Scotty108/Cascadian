import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Debugging decode integrity failure...\n');

  // Get sample tokens and show what we're actually computing
  const query = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        lower(hex(toUInt256(asset_id))) AS token_hex,
        lower(concat(repeat('0',64-length(hex(bitShiftRight(toUInt256(asset_id),8)))),
                     hex(bitShiftRight(toUInt256(asset_id),8)))) AS ctf_hex,
        lpad(lower(hex(bitAnd(toUInt256(asset_id),255))),2,'0') AS mask_hex,
        concat(
          lower(concat(repeat('0',64-length(hex(bitShiftRight(toUInt256(asset_id),8)))),
                       hex(bitShiftRight(toUInt256(asset_id),8)))),
          lpad(lower(hex(bitAnd(toUInt256(asset_id),255))),2,'0')
        ) AS reconstructed,
        token_hex = reconstructed AS matches
      FROM clob_fills
      WHERE asset_id NOT IN ('asset','')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const results: any[] = await query.json();

  results.forEach((r, i) => {
    console.log(`${i + 1}. asset_id: ${r.asset_id}`);
    console.log(`   token_hex (actual):       ${r.token_hex}`);
    console.log(`   token_hex length:         ${r.token_hex.length}`);
    console.log(`   ctf_hex:                  ${r.ctf_hex}`);
    console.log(`   ctf_hex length:           ${r.ctf_hex.length}`);
    console.log(`   mask_hex:                 ${r.mask_hex}`);
    console.log(`   mask_hex length:          ${r.mask_hex.length}`);
    console.log(`   reconstructed:            ${r.reconstructed}`);
    console.log(`   reconstructed length:     ${r.reconstructed.length}`);
    console.log(`   Match: ${r.matches ? '✅' : '❌'}`);
    console.log();
  });

  // Show the length distribution
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Length Distribution Analysis');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const lengthQuery = await clickhouse.query({
    query: `
      SELECT
        length(lower(hex(toUInt256(asset_id)))) AS token_len,
        count() AS cnt
      FROM clob_fills
      WHERE asset_id NOT IN ('asset','')
      GROUP BY token_len
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  });

  const lengths = await lengthQuery.json();
  console.log('Token hex length distribution:');
  lengths.forEach((l: any) => {
    console.log(`   Length ${l.token_len}: ${l.cnt} tokens`);
  });
}

main().catch(console.error);
