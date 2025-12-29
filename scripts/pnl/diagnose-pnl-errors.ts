/**
 * Diagnose PnL Errors - Investigate root causes
 *
 * Checks:
 * 1. Token map join types (are we breaking the join with bad casts?)
 * 2. Deduplication issues (raw vs dedup counts)
 * 3. Data freshness (staleness)
 * 4. Missing condition_ids after join
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

// Worst wallets from V19b test
const WORST_WALLETS = [
  '0x48a457e7a5e0171dfff724f56734c486210f2525', // 40687% error
  '0xa7cfafa0db244f760436fcf83c8b1eb98904ba10', // -1325% error
  '0x7f3c8979d0afa00007bae4747d5347122af05613', // -907% error
  '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', // -408% error
  '0x2e0b70d482e6b389e81dea528be57d825dd48070', // -287% error
];

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   PNL ERROR DIAGNOSIS                                                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // 1. First, check token_id types in both tables
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('1. TOKEN MAP JOIN TYPE INSPECTION');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const typeQuery = `
    SELECT
      'pm_trader_events_dedup_v2_tbl.token_id' as field,
      toTypeName(token_id) as type,
      toString(token_id) as sample_value
    FROM pm_trader_events_dedup_v2_tbl
    LIMIT 1

    UNION ALL

    SELECT
      'pm_token_to_condition_map_v4.token_id_dec' as field,
      toTypeName(token_id_dec) as type,
      toString(token_id_dec) as sample_value
    FROM pm_token_to_condition_map_v4
    LIMIT 1

    UNION ALL

    SELECT
      'pm_token_to_condition_map_v4.token_id_hex' as field,
      toTypeName(token_id_hex) as type,
      token_id_hex as sample_value
    FROM pm_token_to_condition_map_v4
    LIMIT 1
  `;

  const typeResult = await client.query({ query: typeQuery, format: 'JSONEachRow' });
  const typeRows = await typeResult.json() as any[];

  console.log('Field Types:');
  for (const row of typeRows) {
    console.log(`  ${row.field}`);
    console.log(`    Type: ${row.type}`);
    console.log(`    Sample: ${row.sample_value?.slice(0, 50)}`);
  }

  // 2. Check the actual join - are we losing rows?
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('2. TOKEN MAP JOIN COVERAGE (sample wallet)');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const sampleWallet = WORST_WALLETS[0];

  const joinCoverageQuery = `
    SELECT
      count() as total_trades,
      countIf(m.condition_id IS NOT NULL AND m.condition_id != '') as matched_trades,
      countIf(m.condition_id IS NULL OR m.condition_id = '') as unmatched_trades,
      round(countIf(m.condition_id IS NULL OR m.condition_id = '') * 100.0 / count(), 1) as unmatched_pct
    FROM pm_trader_events_dedup_v2_tbl t
    LEFT JOIN pm_token_to_condition_map_v4 m
      ON toString(t.token_id) = toString(m.token_id_dec)
    WHERE lower(t.trader_wallet) = lower('${sampleWallet}')
  `;

  const joinResult = await client.query({ query: joinCoverageQuery, format: 'JSONEachRow' });
  const joinRows = await joinResult.json() as any[];

  console.log(`Wallet: ${sampleWallet}`);
  console.log(`  Total trades: ${joinRows[0]?.total_trades}`);
  console.log(`  Matched (have condition_id): ${joinRows[0]?.matched_trades}`);
  console.log(`  Unmatched (NULL condition_id): ${joinRows[0]?.unmatched_trades} (${joinRows[0]?.unmatched_pct}%)`);

  // 3. Show sample of unmatched token_ids
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('3. UNMATCHED TOKEN_IDS SAMPLE');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const unmatchedQuery = `
    SELECT
      t.token_id,
      toTypeName(t.token_id) as token_type,
      t.usdc_amount / 1000000.0 as usdc,
      t.trade_time
    FROM pm_trader_events_dedup_v2_tbl t
    LEFT JOIN pm_token_to_condition_map_v4 m
      ON toString(t.token_id) = toString(m.token_id_dec)
    WHERE lower(t.trader_wallet) = lower('${sampleWallet}')
      AND (m.condition_id IS NULL OR m.condition_id = '')
    ORDER BY t.usdc_amount DESC
    LIMIT 10
  `;

  const unmatchedResult = await client.query({ query: unmatchedQuery, format: 'JSONEachRow' });
  const unmatchedRows = await unmatchedResult.json() as any[];

  if (unmatchedRows.length > 0) {
    console.log('Unmatched token_ids (not in token map):');
    for (const row of unmatchedRows) {
      console.log(`  token_id: ${row.token_id} (${row.token_type})`);
      console.log(`    USDC: $${row.usdc?.toLocaleString()}, Time: ${row.trade_time}`);
    }

    // Check if these token_ids exist in the map with different format
    const firstUnmatched = unmatchedRows[0]?.token_id;
    if (firstUnmatched) {
      console.log(`\nChecking if token_id ${firstUnmatched} exists in map with different format...`);

      const checkMapQuery = `
        SELECT
          token_id_dec,
          token_id_hex,
          condition_id,
          outcome_index
        FROM pm_token_to_condition_map_v4
        WHERE toString(token_id_dec) LIKE '%${String(firstUnmatched).slice(-10)}%'
           OR token_id_hex LIKE '%${String(firstUnmatched).slice(-10)}%'
        LIMIT 5
      `;

      const checkResult = await client.query({ query: checkMapQuery, format: 'JSONEachRow' });
      const checkRows = await checkResult.json() as any[];

      if (checkRows.length > 0) {
        console.log('  Found similar entries in token map:');
        for (const row of checkRows) {
          console.log(`    dec: ${row.token_id_dec}, hex: ${row.token_id_hex}`);
        }
      } else {
        console.log('  No similar entries found - token truly missing from map');
      }
    }
  } else {
    console.log('All token_ids matched!');
  }

  // 4. Deduplication check
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('4. DEDUPLICATION CHECK (raw vs dedup)');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  for (const wallet of WORST_WALLETS.slice(0, 3)) {
    const dedupQuery = `
      SELECT
        'raw' as source,
        count() as count,
        max(trade_time) as max_time,
        sum(usdc_amount) / 1000000.0 as total_usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0

      UNION ALL

      SELECT
        'dedup' as source,
        count() as count,
        max(trade_time) as max_time,
        sum(usdc_amount) / 1000000.0 as total_usdc
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
    `;

    const dedupResult = await client.query({ query: dedupQuery, format: 'JSONEachRow' });
    const dedupRows = await dedupResult.json() as any[];

    console.log(`Wallet: ${wallet.slice(0, 20)}...`);
    for (const row of dedupRows) {
      console.log(`  ${row.source.padEnd(6)}: ${String(row.count).padStart(6)} trades, max_time: ${row.max_time}, USDC: $${Math.round(row.total_usdc).toLocaleString()}`);
    }

    const raw = dedupRows.find(r => r.source === 'raw');
    const dedup = dedupRows.find(r => r.source === 'dedup');
    if (raw && dedup) {
      const countDiff = Number(raw.count) - Number(dedup.count);
      const usdcDiff = Number(raw.total_usdc) - Number(dedup.total_usdc);
      if (countDiff !== 0 || Math.abs(usdcDiff) > 1) {
        console.log(`  ⚠️  MISMATCH: ${countDiff} trades, $${Math.round(usdcDiff).toLocaleString()} USDC difference`);
      }
    }
    console.log('');
  }

  // 5. Check token map completeness
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('5. TOKEN MAP COMPLETENESS');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const mapStatsQuery = `
    SELECT
      count() as total_tokens,
      countIf(condition_id IS NOT NULL AND condition_id != '') as with_condition,
      countIf(condition_id IS NULL OR condition_id = '') as without_condition
    FROM pm_token_to_condition_map_v4
  `;

  const mapStatsResult = await client.query({ query: mapStatsQuery, format: 'JSONEachRow' });
  const mapStats = (await mapStatsResult.json() as any[])[0];

  console.log(`Token map stats:`);
  console.log(`  Total tokens: ${mapStats.total_tokens?.toLocaleString()}`);
  console.log(`  With condition_id: ${mapStats.with_condition?.toLocaleString()}`);
  console.log(`  Without condition_id: ${mapStats.without_condition?.toLocaleString()}`);

  // 6. Check if we're using the wrong join key
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('6. JOIN KEY COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const joinKeyQuery = `
    WITH sample_trades AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${sampleWallet}')
      LIMIT 5
    )
    SELECT
      t.token_id as trade_token_id,
      toString(t.token_id) as trade_token_str,
      m_dec.token_id_dec as map_token_dec,
      m_dec.condition_id as condition_via_dec,
      m_hex.token_id_hex as map_token_hex,
      m_hex.condition_id as condition_via_hex
    FROM sample_trades t
    LEFT JOIN pm_token_to_condition_map_v4 m_dec
      ON toString(t.token_id) = toString(m_dec.token_id_dec)
    LEFT JOIN pm_token_to_condition_map_v4 m_hex
      ON lower(hex(t.token_id)) = lower(m_hex.token_id_hex)
  `;

  const joinKeyResult = await client.query({ query: joinKeyQuery, format: 'JSONEachRow' });
  const joinKeyRows = await joinKeyResult.json() as any[];

  console.log('Comparing join methods (toString vs hex):');
  for (const row of joinKeyRows) {
    const decMatch = row.condition_via_dec ? '✓' : '✗';
    const hexMatch = row.condition_via_hex ? '✓' : '✗';
    console.log(`  token_id: ${row.trade_token_str?.slice(0, 30)}...`);
    console.log(`    via toString(dec): ${decMatch} ${row.condition_via_dec?.slice(0, 20) || 'NULL'}`);
    console.log(`    via hex:           ${hexMatch} ${row.condition_via_hex?.slice(0, 20) || 'NULL'}`);
  }

  // 7. Summary recommendations
  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('7. DIAGNOSIS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const unmatchedPct = parseFloat(joinRows[0]?.unmatched_pct || '0');

  if (unmatchedPct > 5) {
    console.log(`⚠️  HIGH TOKEN MAP MISS RATE: ${unmatchedPct}% of trades have no condition_id`);
    console.log('   LIKELY CAUSE: Token map is incomplete or join is broken');
    console.log('   FIX: Check token_id types and rebuild token map');
  }

  // Check if raw vs dedup has major differences
  const rawCount = dedupRows?.find((r: any) => r.source === 'raw')?.count || 0;
  const dedupCount = dedupRows?.find((r: any) => r.source === 'dedup')?.count || 0;
  if (Number(rawCount) > Number(dedupCount) * 1.5) {
    console.log(`⚠️  DEDUP IS MISSING TRADES: raw=${rawCount}, dedup=${dedupCount}`);
    console.log('   LIKELY CAUSE: Dedup job not running or not catching all data');
    console.log('   FIX: Check dedup cron and backfill');
  }
}

main().catch(console.error);
