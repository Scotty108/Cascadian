import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { readFileSync } from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('INVESTIGATE MISSING CTF IDs');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Read target CTF IDs
  const csv = readFileSync('tmp/phase7_missing_ctf64.csv', 'utf8');
  const lines = csv.split('\n').slice(1).filter(l => l.trim());
  const ctfIds = lines.map(l => l.split(',')[0]);

  console.log(`Target CTF IDs: ${ctfIds.length}\n`);

  for (const ctfId of ctfIds) {
    console.log(`\n═══ ${ctfId.substring(0, 20)}... ═══\n`);

    // 1. Check if it's traded on CLOB
    const clobResult = await clickhouse.query({
      query: `
        SELECT count() AS cnt, sum(toFloat64(size) / 1e6) AS volume
        FROM clob_fills
        WHERE lower(hex(bitShiftRight(toUInt256(asset_id), 8))) = lower('${ctfId}')
          AND asset_id NOT IN ('asset', '')
      `,
      format: 'JSONEachRow'
    });
    const clob: any[] = await clobResult.json();

    if (Number(clob[0].cnt) > 0) {
      console.log(`✅ Traded on CLOB: ${clob[0].cnt} fills, ${Number(clob[0].volume).toLocaleString()} volume`);

      // Get condition_id from CLOB
      const conditionQuery = await clickhouse.query({
        query: `
          SELECT DISTINCT condition_id
          FROM clob_fills
          WHERE lower(hex(bitShiftRight(toUInt256(asset_id), 8))) = lower('${ctfId}')
            AND asset_id NOT IN ('asset', '')
            AND condition_id != ''
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });
      const conditions: any[] = await conditionQuery.json();

      if (conditions.length > 0) {
        const marketId = conditions[0].condition_id.toLowerCase().replace('0x', '');
        console.log(`   Market ID from CLOB: ${marketId.substring(0, 20)}...`);

        // Check if this market ID is resolved
        const resolvedQuery = await clickhouse.query({
          query: `
            SELECT condition_id_norm, payout_numerators, payout_denominator
            FROM market_resolutions_final
            WHERE lower(condition_id_norm) = lower('${marketId}')
            LIMIT 1
          `,
          format: 'JSONEachRow'
        });
        const resolved: any[] = await resolvedQuery.json();

        if (resolved.length > 0) {
          console.log(`   ✅ Market IS resolved: [${resolved[0].payout_numerators.join(', ')}] / ${resolved[0].payout_denominator}`);
          console.log(`   🔧 ACTION: Bridge is broken! CTF ${ctfId.substring(0, 10)}... should map to market ${marketId.substring(0, 10)}...`);
        } else {
          console.log(`   ❌ Market NOT resolved`);
        }
      }
    } else {
      console.log(`❌ Never traded on CLOB`);
    }

    // 2. Check ERC1155 activity
    const erc1155Result = await clickhouse.query({
      query: `
        SELECT
          count() AS transfers,
          sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6) AS volume
        FROM erc1155_transfers
        WHERE lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') = lower('${ctfId}')
      `,
      format: 'JSONEachRow'
    });
    const erc1155: any[] = await erc1155Result.json();

    if (Number(erc1155[0].transfers) > 0) {
      console.log(`✅ ERC1155 activity: ${erc1155[0].transfers} transfers, ${Number(erc1155[0].volume).toLocaleString()} volume`);
    } else {
      console.log(`❌ No ERC1155 activity`);
    }

    // 3. Check bridge
    const bridgeResult = await clickhouse.query({
      query: `
        SELECT ctf_hex64, market_hex64, source
        FROM ctf_to_market_bridge_mat
        WHERE lower(ctf_hex64) = lower('${ctfId}')
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const bridge: any[] = await bridgeResult.json();

    if (bridge.length > 0) {
      console.log(`✅ Bridge exists: ${bridge[0].market_hex64.substring(0, 20)}... (source: ${bridge[0].source})`);

      if (bridge[0].source === 'erc1155_identity') {
        console.log(`   ⚠️  Using identity fallback (market_hex64 = ctf_hex64)`);
      }
    } else {
      console.log(`❌ NOT in bridge!`);
    }
  }
}

main().catch(console.error);
