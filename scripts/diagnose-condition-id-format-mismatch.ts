#!/usr/bin/env npx tsx
/**
 * DIAGNOSE: Why wallet positions don't match market_resolutions_final
 *
 * Issue: 160,845 resolutions now in truth view, but 0/30 wallet positions match.
 * Likely cause: condition_id format mismatch between tables.
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
  console.log('DIAGNOSING CONDITION_ID FORMAT MISMATCH');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get wallet's condition_ids from vw_trades_canonical
  console.log('Step 1: Getting wallet condition_ids from vw_trades_canonical...\n');

  const walletIds = await ch.query({
    query: `
      SELECT DISTINCT
        condition_id_norm as original,
        lower(replaceAll(condition_id_norm, '0x', '')) as normalized,
        length(condition_id_norm) as original_length,
        length(lower(replaceAll(condition_id_norm, '0x', ''))) as normalized_length
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
        AND condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const walletIdsData = await walletIds.json<any[]>();

  console.log('Sample wallet condition_ids:');
  walletIdsData.forEach((row, i) => {
    console.log(`${i + 1}. Original: ${row.original.substring(0, 40)}... (length: ${row.original_length})`);
    console.log(`   Normalized: ${row.normalized.substring(0, 40)}... (length: ${row.normalized_length})`);
    console.log('');
  });

  // Get sample condition_ids from market_resolutions_final
  console.log('Step 2: Getting sample condition_ids from market_resolutions_final...\n');

  const marketIds = await ch.query({
    query: `
      SELECT DISTINCT
        condition_id_norm as stored,
        length(condition_id_norm) as stored_length
      FROM default.market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const marketIdsData = await marketIds.json<any[]>();

  console.log('Sample market_resolutions_final condition_ids:');
  marketIdsData.forEach((row, i) => {
    console.log(`${i + 1}. Stored: ${row.stored.substring(0, 40)}... (length: ${row.stored_length})`);
    console.log('');
  });

  // Direct check: do ANY wallet IDs exist in market_resolutions_final?
  console.log('Step 3: Direct lookup - do wallet IDs exist in market_resolutions_final?\n');

  const directCheck = await ch.query({
    query: `
      WITH wallet_ids AS (
        SELECT DISTINCT
          condition_id_norm,
          lower(replaceAll(condition_id_norm, '0x', '')) as normalized
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
          AND condition_id_norm != ''
      )
      SELECT
        w.condition_id_norm as wallet_id,
        w.normalized as wallet_normalized,
        m.condition_id_norm as market_id,
        CASE WHEN m.condition_id_norm IS NOT NULL THEN 'FOUND' ELSE 'NOT_FOUND' END as status
      FROM wallet_ids w
      LEFT JOIN default.market_resolutions_final m
        ON w.normalized = m.condition_id_norm
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const directCheckData = await directCheck.json<any[]>();

  console.log('Direct lookup results:');
  directCheckData.forEach((row, i) => {
    console.log(`${i + 1}. Wallet ID: ${row.wallet_normalized.substring(0, 20)}...`);
    console.log(`   Status: ${row.status}`);
    if (row.status === 'FOUND') {
      console.log(`   Market ID: ${row.market_id.substring(0, 20)}...`);
    }
    console.log('');
  });

  const found = directCheckData.filter(r => r.status === 'FOUND').length;
  const total = directCheckData.length;

  console.log(`Found: ${found}/${total} wallet IDs in market_resolutions_final\n`);

  // Check if the issue is FixedString vs String
  console.log('Step 4: Checking column types...\n');

  const walletSchema = await ch.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = 'default'
        AND table = 'vw_trades_canonical'
        AND name = 'condition_id_norm'
    `,
    format: 'JSONEachRow',
  });
  const walletSchemaData = await walletSchema.json<any[]>();

  const marketSchema = await ch.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = 'default'
        AND table = 'market_resolutions_final'
        AND name = 'condition_id_norm'
    `,
    format: 'JSONEachRow',
  });
  const marketSchemaData = await marketSchema.json<any[]>();

  console.log('Column types:');
  console.log(`  vw_trades_canonical.condition_id_norm: ${walletSchemaData[0]?.type || 'NOT FOUND'}`);
  console.log(`  market_resolutions_final.condition_id_norm: ${marketSchemaData[0]?.type || 'NOT FOUND'}`);
  console.log('');

  // Try case-insensitive join
  console.log('Step 5: Trying case-insensitive join...\n');

  const caseInsensitive = await ch.query({
    query: `
      WITH wallet_ids AS (
        SELECT DISTINCT
          lower(trim(replaceAll(condition_id_norm, '0x', ''))) as cid
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
          AND condition_id_norm != ''
      )
      SELECT count(*) as found
      FROM wallet_ids w
      INNER JOIN default.market_resolutions_final m
        ON lower(trim(m.condition_id_norm)) = w.cid
    `,
    format: 'JSONEachRow',
  });
  const caseInsensitiveData = await caseInsensitive.json<any[]>();

  console.log(`Case-insensitive join found: ${caseInsensitiveData[0].found} matches\n`);

  // Show actual wallet condition_ids to manually check
  console.log('═'.repeat(80));
  console.log('WALLET CONDITION_IDS (for manual verification)');
  console.log('═'.repeat(80));
  console.log('');

  const allWalletIds = await ch.query({
    query: `
      SELECT DISTINCT
        lower(replaceAll(condition_id_norm, '0x', '')) as cid
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${AUDIT_WALLET}')
        AND condition_id_norm != ''
      ORDER BY cid
    `,
    format: 'JSONEachRow',
  });
  const allWalletIdsData = await allWalletIds.json<any[]>();

  console.log(`Wallet has ${allWalletIdsData.length} unique condition_ids:\n`);
  allWalletIdsData.slice(0, 10).forEach((row, i) => {
    console.log(`${i + 1}. ${row.cid}`);
  });
  if (allWalletIdsData.length > 10) {
    console.log(`... and ${allWalletIdsData.length - 10} more\n`);
  }

  // Check if any of these exist in market_resolutions_final
  console.log('═'.repeat(80));
  console.log('CHECKING IF THESE IDS EXIST IN MARKET_RESOLUTIONS_FINAL');
  console.log('═'.repeat(80));
  console.log('');

  for (let i = 0; i < Math.min(5, allWalletIdsData.length); i++) {
    const cid = allWalletIdsData[i].cid;
    const exists = await ch.query({
      query: `
        SELECT count(*) as count
        FROM default.market_resolutions_final
        WHERE condition_id_norm = '${cid}'
      `,
      format: 'JSONEachRow',
    });
    const existsData = await exists.json<any[]>();
    console.log(`${i + 1}. ${cid.substring(0, 20)}... → ${existsData[0].count > 0 ? 'FOUND' : 'NOT FOUND'}`);
  }
  console.log('');

  console.log('═'.repeat(80));
  console.log('VERDICT');
  console.log('═'.repeat(80));
  console.log('');

  if (found > 0 || parseInt(caseInsensitiveData[0].found) > 0) {
    console.log('✅ FORMAT ISSUE FOUND - IDs exist but join is failing');
    console.log('');
    console.log('Solution: Need to normalize condition_id formats in the join');
  } else {
    console.log('⚠️  WALLET IDS GENUINELY NOT IN market_resolutions_final');
    console.log('');
    console.log('This means:');
    console.log('1. The 30 markets this wallet trades are NOT in market_resolutions_final');
    console.log('2. They may be in other resolution tables, OR');
    console.log('3. We need to fetch them from external APIs');
    console.log('');
    console.log('Next step: Check gamma_resolved and other resolution tables');
  }
  console.log('');

  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
