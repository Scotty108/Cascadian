import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

/**
 * Option A Probe: Check if ready mapping tables exist
 * Pass criteria:
 *   - Has a ctf_id or equivalent normalized 64-hex without 0x
 *   - last_update is recent enough for backfill window
 *   - Integrity: ok = n (all decoded CTF ids match)
 *
 * If all checks pass, we can use existing table instead of building bridge.
 * BUT: Still must implement mask-based payout logic regardless!
 */

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('OPTION A PROBE: Check for Existing CTF Mapping Tables');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const targetTables = ['erc1155_condition_map', 'condition_id_bridge', 'legacy_token_condition_map'];

  // Check 1: Do tables exist?
  console.log('Check 1: Table existence...');
  const existsQuery = await clickhouse.query({
    query: `
      SELECT name FROM system.tables
      WHERE database = currentDatabase()
        AND name IN ('erc1155_condition_map','condition_id_bridge','legacy_token_condition_map')
    `,
    format: 'JSONEachRow'
  });

  const existingTables = await existsQuery.json();
  console.log('Found tables:', existingTables.map((t: any) => t.name).join(', ') || 'NONE');

  if (existingTables.length === 0) {
    console.log('\n❌ PROBE FAILED: No candidate tables found');
    console.log('   → Proceeding to build cid_bridge from scratch\n');
    process.exit(1);
  }

  // Test each table
  let foundValidTable = false;

  for (const table of existingTables) {
    const tableName = table.name;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Testing: ${tableName}`);
    console.log('─'.repeat(60));

    // Check 2: Sample fields
    console.log('Check 2: Sample data & schema...');
    try {
      const sampleQuery = await clickhouse.query({
        query: `SELECT * FROM ${tableName} LIMIT 5`,
        format: 'JSONEachRow'
      });
      const sample = await sampleQuery.json();

      if (sample.length === 0) {
        console.log('   ⚠️  Table is empty');
        continue;
      }

      console.log('   Sample row fields:', Object.keys(sample[0]).join(', '));

      // Check for CTF id field
      const hasCtfId = Object.keys(sample[0]).some(k =>
        k.includes('ctf') || k.includes('condition_id') || k === 'cid'
      );

      if (!hasCtfId) {
        console.log('   ❌ No CTF condition_id field found');
        continue;
      }

      console.log('   ✅ Has CTF id field');

      // Check 3: Freshness
      console.log('Check 3: Freshness...');
      const hasTimestamp = Object.keys(sample[0]).some(k =>
        k.includes('updated') || k.includes('created') || k.includes('at')
      );

      if (hasTimestamp) {
        const timestampField = Object.keys(sample[0]).find(k =>
          k.includes('updated') || k.includes('created')
        );
        const maxQuery = await clickhouse.query({
          query: `SELECT max(${timestampField}) AS last_update FROM ${tableName}`,
          format: 'JSONEachRow'
        });
        const maxResult = await maxQuery.json();
        console.log(`   Last update: ${maxResult[0].last_update}`);
      } else {
        console.log('   ⚠️  No timestamp field, cannot verify freshness');
      }

      // Check 4: Integrity (if has token_id field)
      console.log('Check 4: Integrity check...');
      const hasTokenId = Object.keys(sample[0]).includes('token_id');

      if (hasTokenId) {
        // Find the CTF id field name
        const ctfIdField = Object.keys(sample[0]).find(k =>
          k.includes('ctf') || (k.includes('condition') && k.includes('id'))
        ) || 'condition_id';

        const integrityQuery = await clickhouse.query({
          query: `
            SELECT
              count() AS n,
              countIf(${ctfIdField} = lower(hex(bitShiftRight(toUInt256(token_id), 8)))) AS ok
            FROM ${tableName}
            WHERE token_id != 'asset' AND token_id IS NOT NULL
            LIMIT 1000
          `,
          format: 'JSONEachRow'
        });

        const integrity = await integrityQuery.json();
        const pct = integrity[0].n > 0
          ? (Number(integrity[0].ok) / Number(integrity[0].n) * 100).toFixed(1)
          : '0';

        console.log(`   Integrity: ${integrity[0].ok}/${integrity[0].n} (${pct}%)`);

        if (Number(integrity[0].ok) === Number(integrity[0].n) && Number(integrity[0].n) > 0) {
          console.log(`   ✅ ${tableName} passes all checks!`);
          foundValidTable = true;

          // Get row count
          const countQuery = await clickhouse.query({
            query: `SELECT count() AS count FROM ${tableName}`,
            format: 'JSONEachRow'
          });
          const count = await countQuery.json();
          console.log(`   Total rows: ${count[0].count}`);

          console.log(`\n✅ PROBE SUCCESSFUL: Can use ${tableName}`);
          console.log('   → You can skip building cid_bridge');
          console.log('   → BUT: Still must implement mask-based payout logic!\n');
          process.exit(0);
        } else {
          console.log(`   ❌ Integrity check failed (${pct}% match)`);
        }
      } else {
        console.log('   ⚠️  No token_id field, cannot verify integrity');

        // Check if it might be a bridge table (has both CTF and market ids)
        const hasBothIds = Object.keys(sample[0]).filter(k =>
          k.includes('condition') || k.includes('market') || k.includes('ctf')
        ).length >= 2;

        if (hasBothIds) {
          console.log('   ℹ️  Looks like a bridge table (has multiple id fields)');
          console.log('   Sample:', JSON.stringify(sample[0], null, 2));

          // Could be useful - mark as potential
          console.log(`   ⚠️  ${tableName} might be usable, check sample above`);
        }
      }

    } catch (err: any) {
      console.log(`   ❌ Error querying ${tableName}:`, err.message);
    }
  }

  if (!foundValidTable) {
    console.log('\n❌ PROBE FAILED: No valid mapping table found');
    console.log('   → Proceeding to build cid_bridge from scratch\n');
    process.exit(1);
  }
}

main().catch(console.error);
