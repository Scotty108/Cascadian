#!/usr/bin/env npx tsx
/**
 * Phase 1 (REVISED): Build vw_resolutions_clean from resolutions_by_cid
 *
 * Discovery: resolutions_by_cid has 176 markets with VALID payout data
 * This replaces the warehouse-based approach (which had empty payouts)
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

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('PHASE 1 (REVISED): BUILD CLEAN RESOLUTION VIEW');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Verify resolutions_by_cid data
  console.log('Step 1: Verifying resolutions_by_cid data quality...\n');

  const verify = await ch.query({
    query: `
      SELECT
        count(*) as total,
        countIf(payout_denominator > 0) as valid_denom,
        countIf(length(payout_numerators) > 0) as with_numerators,
        countIf(length(payout_numerators) > 0 AND payout_denominator > 0) as fully_valid
      FROM cascadian_clean.resolutions_by_cid
    `,
    format: 'JSONEachRow',
  });

  const verifyData = await verify.json<any[]>();
  console.log(`Total resolutions: ${verifyData[0].total}`);
  console.log(`Valid denominator: ${verifyData[0].valid_denom}`);
  console.log(`With numerators: ${verifyData[0].with_numerators}`);
  console.log(`Fully valid: ${verifyData[0].fully_valid}\n`);

  if (parseInt(verifyData[0].fully_valid) === 0) {
    console.log('❌ ERROR: No valid payout data found in resolutions_by_cid');
    process.exit(1);
  }

  // Step 2: Create clean view
  console.log('Step 2: Creating vw_resolutions_clean from resolutions_by_cid...\n');

  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_clean AS
      SELECT
        cid_hex,
        winning_index,
        payout_numerators,
        payout_denominator,
        resolved_at,
        'blockchain' as source
      FROM cascadian_clean.resolutions_by_cid
      WHERE payout_denominator > 0
        AND length(payout_numerators) > 0
    `
  });

  console.log('✓ Created vw_resolutions_clean\n');

  // Step 3: Verify view
  console.log('Step 3: Verifying view contents...\n');

  const viewCheck = await ch.query({
    query: `SELECT count(*) as cnt FROM cascadian_clean.vw_resolutions_clean`,
    format: 'JSONEachRow',
  });
  const viewData = await viewCheck.json<any[]>();
  console.log(`Clean resolutions available: ${viewData[0].cnt}\n`);

  // Step 4: Check if test wallet has positions in these markets
  console.log('Step 4: Checking test wallet coverage...\n');

  const testWallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

  const coverage = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT
          concat('0x', left(replaceAll(condition_id_norm, '0x', ''), 62), '00') as market_cid
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${testWallet}')
          AND condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        count(*) as total_markets,
        countIf(r.cid_hex IS NOT NULL) as found_in_resolutions,
        countIf(r.payout_denominator > 0) as with_valid_payouts
      FROM wallet_markets w
      LEFT JOIN cascadian_clean.vw_resolutions_clean r
        ON lower(replaceAll(w.market_cid, '0x', '')) = lower(replaceAll(r.cid_hex, '0x', ''))
    `,
    format: 'JSONEachRow',
  });

  const covData = await coverage.json<any[]>();
  const pct = (parseInt(covData[0].found_in_resolutions) / parseInt(covData[0].total_markets) * 100).toFixed(1);

  console.log(`Wallet ${testWallet.substring(0, 12)}... has:`);
  console.log(`  Total unique markets: ${covData[0].total_markets}`);
  console.log(`  Found in resolutions_clean: ${covData[0].found_in_resolutions} (${pct}%)`);
  console.log(`  With valid payouts: ${covData[0].with_valid_payouts}\n`);

  // Step 5: Check system-wide coverage
  console.log('Step 5: Checking system-wide coverage...\n');

  const systemCoverage = await ch.query({
    query: `
      WITH all_markets AS (
        SELECT DISTINCT
          concat('0x', left(replaceAll(condition_id_norm, '0x', ''), 62), '00') as market_cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        count(*) as total_markets,
        countIf(r.cid_hex IS NOT NULL) as with_resolutions,
        countIf(r.payout_denominator > 0) as with_valid_payouts
      FROM all_markets m
      LEFT JOIN cascadian_clean.vw_resolutions_clean r
        ON lower(replaceAll(m.market_cid, '0x', '')) = lower(replaceAll(r.cid_hex, '0x', ''))
    `,
    format: 'JSONEachRow',
  });

  const sysCov = await systemCoverage.json<any[]>();
  const sysPct = (parseInt(sysCov[0].with_valid_payouts) / parseInt(sysCov[0].total_markets) * 100).toFixed(2);

  console.log(`System-wide coverage:`);
  console.log(`  Total unique markets: ${parseInt(sysCov[0].total_markets).toLocaleString()}`);
  console.log(`  With valid resolutions: ${parseInt(sysCov[0].with_valid_payouts).toLocaleString()} (${sysPct}%)\n`);

  console.log('═'.repeat(80));
  console.log('PHASE 1 COMPLETE');
  console.log('═'.repeat(80));
  console.log(`✓ vw_resolutions_clean created from resolutions_by_cid`);
  console.log(`✓ ${verifyData[0].fully_valid} valid resolutions available`);
  console.log(`✓ System coverage: ${sysPct}% of traded markets`);
  console.log(`\n⚠️  Note: Low coverage (${sysPct}%) is expected - most markets are still open\n`);

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
