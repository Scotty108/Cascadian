#!/usr/bin/env ts-node

/**
 * ERC1155 Condition ID Recovery Script
 *
 * Recovers ~200K trades with empty condition_id by extracting condition_id
 * from ERC1155 token transfer data.
 *
 * Scope: 0.26% of 77.4M empty trades (limited by ERC1155 coverage)
 * Runtime: ~5-10 minutes
 * Confidence: HIGH (95%+) for matched rows
 *
 * Uses skills: IDN, JD, CAR, AR
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

interface RecoveryStats {
  total_recovered: number;
  validated_against_resolutions: number;
  validation_pct: number;
  avg_amount_diff: number;
  median_amount_diff: number;
  p95_amount_diff: number;
  close_amount_matches: number;
  pct_close_matches: number;
}

interface DuplicateCheck {
  total_recoveries: number;
  unique_trades: number;
  duplicates: number;
}

interface FinalStats {
  total_trades: number;
  still_empty: number;
  now_filled: number;
  pct_filled: number;
  recovered_via_erc1155: number;
}

async function main() {
  console.log('========================================');
  console.log('ERC1155 Condition ID Recovery');
  console.log('========================================\n');

  try {
    // ========================================
    // Step 1: Build recovery mapping
    // ========================================
    console.log('[Step 1] Building ERC1155 recovery mapping...');
    console.log('Expected: ~200K recoveries');

    const step1Start = Date.now();

    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS erc1155_condition_recovery AS
        WITH erc1155_extracted AS (
          SELECT
            tx_hash,
            log_index,
            to_address as wallet_address,
            -- IDN: ID Normalization - extract first 64 hex chars as condition_id
            substring(lower(replaceAll(token_id, '0x', '')), 1, 64) as condition_id_extracted,
            -- Normalize token value to shares (convert from wei)
            toDecimal128(value, 0) / 1000000.0 as token_amount_shares,
            block_timestamp
          FROM erc1155_transfers
          WHERE
            -- Filter out zero/null token addresses
            token_id != '0x0000000000000000000000000000000000000000000000000000000000000040'
            AND token_id != ''
            -- Only process transfers TO wallets (receiving tokens)
            AND to_address != '0x0000000000000000000000000000000000000000'
        ),

        trades_empty AS (
          SELECT
            transaction_hash,
            wallet_address,
            trade_id,
            shares,
            usd_value,
            timestamp
          FROM trades_raw
          WHERE condition_id = ''
        ),

        -- JD: Join Discipline - match on normalized tx_hash + wallet
        matched_with_ranking AS (
          SELECT
            t.transaction_hash,
            t.wallet_address,
            t.trade_id,
            t.shares as trade_shares,
            e.condition_id_extracted,
            e.token_amount_shares,
            -- Calculate amount proximity for ranking
            abs(t.shares - e.token_amount_shares) as amount_diff,
            -- CAR: ClickHouse Array Rule - ROW_NUMBER for deduplication
            ROW_NUMBER() OVER (
              PARTITION BY t.transaction_hash, t.wallet_address, t.trade_id
              ORDER BY
                abs(t.shares - e.token_amount_shares) ASC,  -- Closest amount match first
                e.log_index ASC                              -- Earlier log if tie
            ) as match_rank
          FROM trades_empty t
          INNER JOIN erc1155_extracted e ON (
            lower(t.transaction_hash) = lower(e.tx_hash) AND
            lower(t.wallet_address) = lower(e.wallet_address)
          )
        )

        -- Take only best match per trade
        SELECT
          transaction_hash,
          wallet_address,
          trade_id,
          condition_id_extracted as recovered_condition_id,
          trade_shares,
          token_amount_shares,
          amount_diff,
          'erc1155' as recovery_method,
          now() as recovered_at
        FROM matched_with_ranking
        WHERE match_rank = 1
      `
    });

    const step1Duration = ((Date.now() - step1Start) / 1000).toFixed(2);
    console.log(`✓ Recovery mapping built in ${step1Duration}s\n`);

    // ========================================
    // GATE 1: Validate recovery quality
    // ========================================
    console.log('[GATE 1] Validating recovery quality...');

    const gate1Result = await client.query({
      query: `
        SELECT
          count() as total_recovered,
          -- Validate against market_resolutions_final
          countIf(recovered_condition_id IN (
            SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
            FROM market_resolutions_final
          )) as validated_against_resolutions,
          100.0 * validated_against_resolutions / total_recovered as validation_pct,
          -- Amount matching quality
          avg(amount_diff) as avg_amount_diff,
          quantile(0.50)(amount_diff) as median_amount_diff,
          quantile(0.95)(amount_diff) as p95_amount_diff,
          -- Amount diff should be LOW (< 1.0 shares) for high confidence
          countIf(amount_diff < 1.0) as close_amount_matches,
          100.0 * close_amount_matches / total_recovered as pct_close_matches
        FROM erc1155_condition_recovery
      `,
      format: 'JSONEachRow'
    });

    const gate1Stats = (await gate1Result.json())[0] as RecoveryStats;

    console.log('Recovery Quality Metrics:');
    console.log(`  Total recovered:           ${gate1Stats.total_recovered.toLocaleString()}`);
    console.log(`  Validated against markets: ${gate1Stats.validated_against_resolutions.toLocaleString()} (${gate1Stats.validation_pct.toFixed(1)}%)`);
    console.log(`  Avg amount diff:           ${gate1Stats.avg_amount_diff.toFixed(2)} shares`);
    console.log(`  Median amount diff:        ${gate1Stats.median_amount_diff.toFixed(2)} shares`);
    console.log(`  P95 amount diff:           ${gate1Stats.p95_amount_diff.toFixed(2)} shares`);
    console.log(`  Close matches (<1 share):  ${gate1Stats.close_amount_matches.toLocaleString()} (${gate1Stats.pct_close_matches.toFixed(1)}%)\n`);

    // Check thresholds
    if (gate1Stats.validation_pct < 85) {
      console.error(`❌ GATE 1 FAILED: Validation rate ${gate1Stats.validation_pct.toFixed(1)}% < 85%`);
      console.error('   ERC1155 data quality issue detected. Aborting recovery.');
      process.exit(1);
    }

    if (gate1Stats.pct_close_matches < 70) {
      console.error(`❌ GATE 1 FAILED: Close matches ${gate1Stats.pct_close_matches.toFixed(1)}% < 70%`);
      console.error('   Amount matching not reliable. Aborting recovery.');
      process.exit(1);
    }

    console.log('✓ GATE 1 PASSED: Recovery quality is acceptable\n');

    // ========================================
    // GATE 2: Check for duplicates
    // ========================================
    console.log('[GATE 2] Checking for duplicate mappings...');

    const gate2Result = await client.query({
      query: `
        SELECT
          count() as total_recoveries,
          uniq(transaction_hash, wallet_address, trade_id) as unique_trades,
          count() - unique_trades as duplicates
        FROM erc1155_condition_recovery
      `,
      format: 'JSONEachRow'
    });

    const gate2Stats = (await gate2Result.json())[0] as DuplicateCheck;

    console.log(`  Total recoveries:  ${gate2Stats.total_recoveries.toLocaleString()}`);
    console.log(`  Unique trades:     ${gate2Stats.unique_trades.toLocaleString()}`);
    console.log(`  Duplicates:        ${gate2Stats.duplicates.toLocaleString()}\n`);

    if (gate2Stats.duplicates > 0) {
      console.error(`❌ GATE 2 FAILED: Found ${gate2Stats.duplicates} duplicate mappings`);
      console.error('   ROW_NUMBER ranking failed. Aborting recovery.');
      process.exit(1);
    }

    console.log('✓ GATE 2 PASSED: No duplicate mappings\n');

    // ========================================
    // Step 2: Apply recovery (ATOMIC REBUILD)
    // ========================================
    console.log('[Step 2] Applying recovery (atomic rebuild)...');
    console.log('Creating trades_raw_erc1155_recovered table...');

    const step2Start = Date.now();

    // First, get the current schema to preserve all fields
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE trades_raw',
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json();
    const fields = schema.map((s: any) => s.name);

    // Build SELECT clause with all fields
    const selectFields = fields.map(f => `t.${f}`).join(',\n    ');

    await client.command({
      query: `
        CREATE TABLE trades_raw_erc1155_recovered AS
        SELECT
          ${selectFields},
          -- Override condition_id with recovered value if available
          COALESCE(r.recovered_condition_id, t.condition_id) as condition_id_final,
          -- Track recovery metadata
          r.recovery_method as condition_id_recovery_method,
          r.recovered_at as condition_id_recovered_at
        FROM trades_raw t
        LEFT JOIN erc1155_condition_recovery r ON (
          t.transaction_hash = r.transaction_hash AND
          t.wallet_address = r.wallet_address AND
          t.trade_id = r.trade_id
        )
      `
    });

    // Now update the condition_id field
    await client.command({
      query: `
        ALTER TABLE trades_raw_erc1155_recovered
        DROP COLUMN condition_id
      `
    });

    await client.command({
      query: `
        ALTER TABLE trades_raw_erc1155_recovered
        RENAME COLUMN condition_id_final TO condition_id
      `
    });

    const step2Duration = ((Date.now() - step2Start) / 1000).toFixed(2);
    console.log(`✓ Recovery table created in ${step2Duration}s\n`);

    // ========================================
    // GATE 3: Verify recovery results
    // ========================================
    console.log('[GATE 3] Verifying final results...');

    const gate3Result = await client.query({
      query: `
        SELECT
          count() as total_trades,
          countIf(condition_id = '') as still_empty,
          countIf(condition_id != '') as now_filled,
          100.0 * countIf(condition_id != '') / count() as pct_filled,
          countIf(condition_id_recovery_method = 'erc1155') as recovered_via_erc1155
        FROM trades_raw_erc1155_recovered
      `,
      format: 'JSONEachRow'
    });

    const gate3Stats = (await gate3Result.json())[0] as FinalStats;

    console.log('Final Trade Statistics:');
    console.log(`  Total trades:         ${gate3Stats.total_trades.toLocaleString()}`);
    console.log(`  Still empty:          ${gate3Stats.still_empty.toLocaleString()}`);
    console.log(`  Now filled:           ${gate3Stats.now_filled.toLocaleString()} (${gate3Stats.pct_filled.toFixed(2)}%)`);
    console.log(`  Recovered via ERC1155: ${gate3Stats.recovered_via_erc1155.toLocaleString()}\n`);

    // Verify improvement
    const beforePct = 51.47; // From initial analysis
    const improvement = gate3Stats.pct_filled - beforePct;

    if (improvement < 0.1) {
      console.error(`❌ GATE 3 FAILED: Improvement ${improvement.toFixed(2)}% < 0.1%`);
      console.error('   Recovery did not improve condition_id coverage. Aborting swap.');
      process.exit(1);
    }

    console.log(`✓ GATE 3 PASSED: Improved coverage by ${improvement.toFixed(2)}%\n`);

    // ========================================
    // Step 3: Atomic swap
    // ========================================
    console.log('[Step 3] Performing atomic table swap...');
    console.log('WARNING: This will replace the current trades_raw table!');
    console.log('Press Ctrl+C within 5 seconds to abort...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('Proceeding with swap...');

    await client.command({
      query: `
        RENAME TABLE
          trades_raw TO trades_raw_before_erc1155_recovery,
          trades_raw_erc1155_recovered TO trades_raw
      `
    });

    console.log('✓ Table swap complete\n');

    // ========================================
    // Final verification
    // ========================================
    console.log('[Final] Post-deployment verification...');

    const finalResult = await client.query({
      query: `
        SELECT
          'After ERC1155 Recovery' as status,
          count() as total_trades,
          countIf(condition_id = '') as empty_condition_id,
          100.0 * countIf(condition_id != '') / count() as pct_filled
        FROM trades_raw
      `,
      format: 'JSONEachRow'
    });

    const finalStats = (await finalResult.json())[0] as any;

    console.log('Final Status:');
    console.log(`  Total trades:      ${finalStats.total_trades.toLocaleString()}`);
    console.log(`  Empty condition_id: ${finalStats.empty_condition_id.toLocaleString()}`);
    console.log(`  Filled:            ${finalStats.pct_filled.toFixed(2)}%\n`);

    console.log('========================================');
    console.log('✅ ERC1155 Recovery Complete!');
    console.log('========================================\n');

    console.log('Summary:');
    console.log(`  - Recovered ${gate3Stats.recovered_via_erc1155.toLocaleString()} trades`);
    console.log(`  - Improved coverage from 51.47% → ${finalStats.pct_filled.toFixed(2)}%`);
    console.log(`  - Remaining empty: ${finalStats.empty_condition_id.toLocaleString()} (${(100 - finalStats.pct_filled).toFixed(2)}%)`);
    console.log('\nNext steps:');
    console.log('  1. Test P&L calculation on sample wallets');
    console.log('  2. Investigate source data for remaining 77.2M trades');
    console.log('  3. See ERC1155_RECOVERY_FINAL_ANALYSIS.md for recovery options\n');

    console.log('Backup table: trades_raw_before_erc1155_recovery');
    console.log('To rollback: RENAME TABLE trades_raw TO trades_raw_failed, trades_raw_before_erc1155_recovery TO trades_raw\n');

  } catch (error) {
    console.error('❌ Error during recovery:', error);
    console.error('\nRecovery failed. No changes were made to trades_raw.');
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
