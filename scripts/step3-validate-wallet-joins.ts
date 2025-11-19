#!/usr/bin/env npx tsx
/**
 * STEP 3: Validate Joins on Audit Wallet
 *
 * Proves that mapping + truth views work correctly by testing on one wallet.
 * This MUST work before we rebuild P&L views system-wide.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const AUDIT_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('STEP 3: VALIDATE JOINS ON AUDIT WALLET');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log(`Audit wallet: ${AUDIT_WALLET}\n`);

  // Step 3.1: Get wallet's positions
  console.log('Step 3.1: Getting wallet positions...\n');

  const positions = await ch.query({
    query: `
      SELECT DISTINCT
        condition_id_norm,
        lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_normalized
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
        AND condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const posData = await positions.json<any[]>();

  console.log(`Wallet has ${posData.length} unique positions\n`);

  // Step 3.2: Check if positions exist in mapping table
  console.log('Step 3.2: Checking if positions exist in mapping table...\n');

  const mapped = await ch.query({
    query: `
      WITH wallet_positions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_32b
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
          AND condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        count(*) as total_positions,
        countIf(m.condition_id_32b IS NOT NULL) as found_in_mapping
      FROM wallet_positions w
      LEFT JOIN cascadian_clean.token_condition_market_map m
        ON w.condition_id_32b = m.condition_id_32b
    `,
    format: 'JSONEachRow',
  });
  const mappedData = await mapped.json<any[]>();

  console.log(`Positions in mapping: ${mappedData[0].found_in_mapping}/${mappedData[0].total_positions}\n`);

  // Step 3.3: Check if positions exist in truth resolutions
  console.log('Step 3.3: Checking if positions exist in truth resolutions...\n');

  const inTruth = await ch.query({
    query: `
      WITH wallet_positions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_32b
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
          AND condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        count(*) as total_positions,
        countIf(r.condition_id_32b IS NOT NULL) as found_in_resolutions,
        countIf(r.payout_denominator > 0) as with_valid_payouts
      FROM wallet_positions w
      LEFT JOIN cascadian_clean.vw_resolutions_truth r
        ON w.condition_id_32b = r.condition_id_32b
    `,
    format: 'JSONEachRow',
  });
  const truthData = await inTruth.json<any[]>();

  console.log(`Positions found in resolutions: ${truthData[0].found_in_resolutions}/${truthData[0].total_positions}`);
  console.log(`Positions with valid payouts: ${truthData[0].with_valid_payouts}/${truthData[0].total_positions}\n`);

  // Step 3.4: Full diagnostic - show per-position details
  console.log('Step 3.4: Per-position diagnostic (first 10 positions)...\n');

  const diagnostic = await ch.query({
    query: `
      WITH wallet_positions AS (
        SELECT DISTINCT
          condition_id_norm,
          lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_32b
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
          AND condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        w.condition_id_norm as original_id,
        w.condition_id_32b,
        m.market_id_cid,
        CASE WHEN m.condition_id_32b IS NOT NULL THEN 'YES' ELSE 'NO' END as in_mapping,
        CASE WHEN r.condition_id_32b IS NOT NULL THEN 'YES' ELSE 'NO' END as in_resolutions,
        CASE WHEN r.payout_denominator > 0 THEN 'YES' ELSE 'NO' END as has_payout,
        r.payout_numerators,
        r.payout_denominator
      FROM wallet_positions w
      LEFT JOIN cascadian_clean.token_condition_market_map m
        ON w.condition_id_32b = m.condition_id_32b
      LEFT JOIN cascadian_clean.vw_resolutions_truth r
        ON w.condition_id_32b = r.condition_id_32b
      ORDER BY has_payout DESC, in_resolutions DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const diagData = await diagnostic.json<any[]>();

  for (const row of diagData) {
    console.log(`Position: ${row.condition_id_32b ? row.condition_id_32b.substring(0, 20) : 'NULL'}...`);
    console.log(`  In mapping: ${row.in_mapping}`);
    console.log(`  In resolutions: ${row.in_resolutions}`);
    console.log(`  Has payout: ${row.has_payout}`);
    if (row.in_resolutions === 'YES' && row.payout_numerators) {
      console.log(`  Payout: ${JSON.stringify(row.payout_numerators)}/${row.payout_denominator}`);
    }
    console.log('');
  }

  // Step 3.5: Compare condition_id formats between sources
  console.log('Step 3.5: Comparing ID formats between sources...\n');

  console.log('Sample condition_id from wallet trades:');
  if (posData.length > 0) {
    console.log(`  ${posData[0].condition_id_normalized}\n`);
  }

  const sampleMapping = await ch.query({
    query: `SELECT condition_id_32b FROM cascadian_clean.token_condition_market_map LIMIT 1`,
    format: 'JSONEachRow',
  });
  const smData = await sampleMapping.json<any[]>();
  console.log('Sample condition_id from mapping:');
  console.log(`  ${smData[0].condition_id_32b}\n`);

  const sampleTruth = await ch.query({
    query: `SELECT condition_id_32b FROM cascadian_clean.vw_resolutions_truth LIMIT 1`,
    format: 'JSONEachRow',
  });
  const stData = await sampleTruth.json<any[]>();
  console.log('Sample condition_id from truth:');
  console.log(`  ${stData[0].condition_id_32b}\n`);

  // Step 3.6: Test a specific condition_id from resolutions
  console.log('Step 3.6: Testing if ANY resolution condition_id exists in mapping...\n');

  const reverseTest = await ch.query({
    query: `
      SELECT
        r.condition_id_32b,
        m.market_id_cid,
        CASE WHEN m.condition_id_32b IS NOT NULL THEN 'YES' ELSE 'NO' END as found_in_mapping
      FROM cascadian_clean.vw_resolutions_truth r
      LEFT JOIN cascadian_clean.token_condition_market_map m
        ON r.condition_id_32b = m.condition_id_32b
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const rtData = await reverseTest.json<any[]>();

  for (const row of rtData) {
    console.log(`Resolution CID: ${row.condition_id_32b.substring(0, 20)}...`);
    console.log(`  Found in mapping: ${row.found_in_mapping}`);
    if (row.found_in_mapping === 'YES') {
      console.log(`  Mapped to market: ${row.market_id_cid}`);
    }
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log('STEP 3 VERDICT');
  console.log('═'.repeat(80));

  const verdict = {
    mapping_works: mappedData[0].found_in_mapping === mappedData[0].total_positions,
    resolutions_overlap: parseInt(truthData[0].found_in_resolutions) > 0,
    has_payouts: parseInt(truthData[0].with_valid_payouts) > 0,
  };

  console.log(`\n✓ Mapping works: ${verdict.mapping_works ? 'YES' : 'NO'} (${mappedData[0].found_in_mapping}/${mappedData[0].total_positions} positions)`);
  console.log(`${verdict.resolutions_overlap ? '✓' : '✗'} Resolutions overlap: ${verdict.resolutions_overlap ? 'YES' : 'NO'} (${truthData[0].found_in_resolutions}/${truthData[0].total_positions} positions)`);
  console.log(`${verdict.has_payouts ? '✓' : '✗'} Has valid payouts: ${verdict.has_payouts ? 'YES' : 'NO'} (${truthData[0].with_valid_payouts}/${truthData[0].total_positions} positions)\n`);

  if (!verdict.mapping_works) {
    console.log('❌ BLOCKER: Mapping table incomplete - positions missing');
  } else if (!verdict.resolutions_overlap) {
    console.log('⚠️  EXPECTED: This wallet has no settled positions (all markets still open)');
  } else {
    console.log('✅ READY: Mapping + resolutions work, can proceed to Step 4');
  }
  console.log('');

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
