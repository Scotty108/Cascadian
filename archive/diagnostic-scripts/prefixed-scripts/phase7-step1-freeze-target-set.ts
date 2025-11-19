import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { mkdirSync, writeFileSync } from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.1: FREEZE TARGET CTF SET (WALLET-SCOPED)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log(`Wallet: ${wallet}\n`);
  console.log('Step 1: Creating phase7_missing_ctf64 table...\n');

  // Drop if exists
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS phase7_missing_ctf64`
  });

  // Create materialized table with exact CTFs blocking burn valuation
  await clickhouse.command({
    query: `
      CREATE TABLE phase7_missing_ctf64
      ENGINE = MergeTree()
      ORDER BY ctf64
      AS
      WITH burns AS (
        SELECT DISTINCT
          lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id,3)))),8))),64,'0') AS ctf64,
          sum(toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) / 1e6) AS total_shares
        FROM erc1155_transfers
        WHERE lower(to_address)='0x0000000000000000000000000000000000000000'
          AND lower(from_address)=lower('${wallet}')
        GROUP BY ctf64
      )
      SELECT
        b.ctf64,
        b.total_shares
      FROM burns b
      LEFT JOIN token_per_share_payout p ON p.condition_id_ctf = b.ctf64
      WHERE p.condition_id_ctf IS NULL OR length(coalesce(p.pps, [])) = 0
    `
  });

  console.log('   ✅ Table created\n');

  // Query the list
  const listQuery = await clickhouse.query({
    query: `
      SELECT
        ctf64,
        total_shares
      FROM phase7_missing_ctf64
      ORDER BY total_shares DESC
    `,
    format: 'JSONEachRow'
  });

  const missing: any[] = await listQuery.json();

  console.log(`   Found ${missing.length} CTF IDs blocking burn valuation:\n`);

  missing.forEach((m, i) => {
    console.log(`   ${(i + 1).toString().padStart(2)}. ${m.ctf64.substring(0, 20)}... (${Number(m.total_shares).toLocaleString()} shares)`);
  });

  console.log('\nStep 2: Exporting to tmp/phase7_missing_ctf64.csv...\n');

  // Create tmp directory
  try {
    mkdirSync('tmp', { recursive: true });
  } catch (e) {
    // Directory exists
  }

  // Export to CSV
  const csv = 'ctf64,total_shares\n' + missing.map(m => `${m.ctf64},${m.total_shares}`).join('\n');
  writeFileSync('tmp/phase7_missing_ctf64.csv', csv);

  console.log(`   ✅ Exported ${missing.length} rows to tmp/phase7_missing_ctf64.csv\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.1 COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Target set frozen: ${missing.length} CTF IDs`);
  console.log(`   Next: Phase 7.2 (on-chain backfill)\n`);
}

main().catch(console.error);
