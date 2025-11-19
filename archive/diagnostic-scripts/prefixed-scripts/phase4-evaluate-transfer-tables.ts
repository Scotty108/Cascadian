import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client';

async function evaluateTransferTables() {
  console.log('=== Phase 4: Transfer Tables Evaluation ===\n');

  // Phase 4A: erc1155_transfers
  console.log('Phase 4A: Evaluating erc1155_transfers...\n');

  try {
    const erc1155Schema = await clickhouse.query({
      query: 'DESCRIBE erc1155_transfers',
      format: 'JSONEachRow'
    });
    console.log('erc1155_transfers schema:');
    console.log(JSON.stringify(await erc1155Schema.json(), null, 2));
  } catch (e) {
    console.log('erc1155_transfers schema error:', e);
  }

  try {
    const erc1155Stats = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_timestamp) as earliest_timestamp,
          max(block_timestamp) as latest_timestamp,
          count(DISTINCT transaction_hash) as unique_txs,
          count(DISTINCT token_id) as unique_tokens
        FROM erc1155_transfers
      `,
      format: 'JSONEachRow'
    });
    console.log('\nerc1155_transfers stats:');
    console.log(JSON.stringify(await erc1155Stats.json(), null, 2));
  } catch (e) {
    console.log('erc1155_transfers stats error:', e);
  }

  // Test coverage with orphans
  try {
    const erc1155Coverage = await clickhouse.query({
      query: `
        SELECT
          'erc1155_transfers' as source,
          count() AS total_orphans,
          countIf(erc.token_id IS NOT NULL) AS has_token_id,
          countIf(decoded_cid != '') AS can_decode_to_cid,
          round(100.0 * countIf(decoded_cid != '') / count(), 2) AS potential_repair_pct,
          -- Check wallet attribution
          countIf(erc.from = o.wallet_address) AS wallet_matches_from,
          countIf(erc.to = o.wallet_address) AS wallet_matches_to,
          countIf(erc.from = o.wallet_address OR erc.to = o.wallet_address) AS wallet_matches_either
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN erc1155_transfers erc
          ON o.transaction_hash = erc.transaction_hash
        LEFT JOIN LATERAL (
          SELECT
            CASE
              WHEN erc.token_id IS NOT NULL AND length(erc.token_id) >= 66
              THEN lower(lpad(hex(bitShiftRight(reinterpretAsUInt256(unhex(substring(erc.token_id, 3))), 2)), 64, '0'))
              ELSE ''
            END as decoded_cid
        ) d ON 1=1
      `,
      format: 'JSONEachRow'
    });
    console.log('\nerc1155_transfers orphan coverage:');
    console.log(JSON.stringify(await erc1155Coverage.json(), null, 2));
  } catch (e) {
    console.log('erc1155_transfers coverage error:', e);
  }

  // Check for row inflation
  try {
    const erc1155Dupes = await clickhouse.query({
      query: `
        SELECT
          o.transaction_hash,
          count() as erc_match_count,
          groupArray(erc.token_id) as token_ids
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN erc1155_transfers erc
          ON o.transaction_hash = erc.transaction_hash
        WHERE erc.token_id IS NOT NULL
        GROUP BY o.transaction_hash
        HAVING erc_match_count > 1
        ORDER BY erc_match_count DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const dupes = await erc1155Dupes.json();
    console.log('\nerc1155_transfers duplication check (sample of multi-match txs):');
    console.log(JSON.stringify(dupes, null, 2));
  } catch (e) {
    console.log('erc1155_transfers duplication error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Phase 4B: erc20_transfers_staging
  console.log('Phase 4B: Evaluating erc20_transfers_staging...\n');

  try {
    const erc20StagingSchema = await clickhouse.query({
      query: 'DESCRIBE erc20_transfers_staging',
      format: 'JSONEachRow'
    });
    console.log('erc20_transfers_staging schema:');
    console.log(JSON.stringify(await erc20StagingSchema.json(), null, 2));
  } catch (e) {
    console.log('erc20_transfers_staging schema error:', e);
  }

  try {
    const erc20StagingStats = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_timestamp) as earliest_timestamp,
          max(block_timestamp) as latest_timestamp,
          count(DISTINCT transaction_hash) as unique_txs,
          count(DISTINCT token_address) as unique_tokens
        FROM erc20_transfers_staging
      `,
      format: 'JSONEachRow'
    });
    console.log('\nerc20_transfers_staging stats:');
    console.log(JSON.stringify(await erc20StagingStats.json(), null, 2));
  } catch (e) {
    console.log('erc20_transfers_staging stats error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Phase 4C: erc20_transfers_decoded
  console.log('Phase 4C: Evaluating erc20_transfers_decoded...\n');

  try {
    const erc20DecodedSchema = await clickhouse.query({
      query: 'DESCRIBE erc20_transfers_decoded',
      format: 'JSONEachRow'
    });
    console.log('erc20_transfers_decoded schema:');
    console.log(JSON.stringify(await erc20DecodedSchema.json(), null, 2));
  } catch (e) {
    console.log('erc20_transfers_decoded schema error:', e);
  }

  try {
    const erc20DecodedStats = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_timestamp) as earliest_timestamp,
          max(block_timestamp) as latest_timestamp,
          count(DISTINCT transaction_hash) as unique_txs
        FROM erc20_transfers_decoded
      `,
      format: 'JSONEachRow'
    });
    console.log('\nerc20_transfers_decoded stats:');
    console.log(JSON.stringify(await erc20DecodedStats.json(), null, 2));
  } catch (e) {
    console.log('erc20_transfers_decoded stats error:', e);
  }

  // Check if it has condition_id
  try {
    const erc20DecodedCoverage = await clickhouse.query({
      query: `
        SELECT
          'erc20_transfers_decoded' as source,
          count() AS total_orphans,
          countIf(erc20.condition_id IS NOT NULL AND erc20.condition_id != '') AS has_condition_id,
          round(100.0 * countIf(erc20.condition_id IS NOT NULL AND erc20.condition_id != '') / count(), 2) AS potential_repair_pct
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN erc20_transfers_decoded erc20
          ON o.transaction_hash = erc20.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    console.log('\nerc20_transfers_decoded orphan coverage:');
    console.log(JSON.stringify(await erc20DecodedCoverage.json(), null, 2));
  } catch (e) {
    console.log('erc20_transfers_decoded coverage error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Phase 4D: pm_erc1155_flats
  console.log('Phase 4D: Evaluating pm_erc1155_flats...\n');

  try {
    const pmFlatsSchema = await clickhouse.query({
      query: 'DESCRIBE pm_erc1155_flats',
      format: 'JSONEachRow'
    });
    console.log('pm_erc1155_flats schema:');
    console.log(JSON.stringify(await pmFlatsSchema.json(), null, 2));
  } catch (e) {
    console.log('pm_erc1155_flats schema error:', e);
  }

  try {
    const pmFlatsStats = await clickhouse.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_timestamp) as earliest_timestamp,
          max(block_timestamp) as latest_timestamp,
          count(DISTINCT transaction_hash) as unique_txs
        FROM pm_erc1155_flats
      `,
      format: 'JSONEachRow'
    });
    console.log('\npm_erc1155_flats stats:');
    console.log(JSON.stringify(await pmFlatsStats.json(), null, 2));
  } catch (e) {
    console.log('pm_erc1155_flats stats error:', e);
  }

  // Test coverage
  try {
    const pmFlatsCoverage = await clickhouse.query({
      query: `
        SELECT
          'pm_erc1155_flats' as source,
          count() AS total_orphans,
          countIf(pm.condition_id IS NOT NULL AND pm.condition_id != '') AS has_condition_id,
          round(100.0 * countIf(pm.condition_id IS NOT NULL AND pm.condition_id != '') / count(), 2) AS potential_repair_pct,
          -- Check wallet attribution
          countIf(pm.from = o.wallet_address) AS wallet_matches_from,
          countIf(pm.to = o.wallet_address) AS wallet_matches_to,
          countIf(pm.from = o.wallet_address OR pm.to = o.wallet_address) AS wallet_matches_either
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN pm_erc1155_flats pm
          ON o.transaction_hash = pm.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    console.log('\npm_erc1155_flats orphan coverage:');
    console.log(JSON.stringify(await pmFlatsCoverage.json(), null, 2));
  } catch (e) {
    console.log('pm_erc1155_flats coverage error:', e);
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Phase 4E: Re-verify fact_trades_clean
  console.log('Phase 4E: Re-verifying fact_trades_clean (C1 ruled out)...\n');

  try {
    const ftcSchema = await clickhouse.query({
      query: 'DESCRIBE fact_trades_clean',
      format: 'JSONEachRow'
    });
    console.log('fact_trades_clean schema:');
    console.log(JSON.stringify(await ftcSchema.json(), null, 2));
  } catch (e) {
    console.log('fact_trades_clean schema error:', e);
  }

  // Test wallet attribution issue
  try {
    const ftcCoverage = await clickhouse.query({
      query: `
        SELECT
          'fact_trades_clean' as source,
          count() AS total_orphans,
          countIf(ftc.condition_id IS NOT NULL AND ftc.condition_id != '') AS has_condition_id,
          round(100.0 * countIf(ftc.condition_id IS NOT NULL AND ftc.condition_id != '') / count(), 2) AS potential_repair_pct,
          -- Check for wallet mismatch (C1's main concern)
          countIf(ftc.wallet != o.wallet_address) AS wallet_mismatch_count,
          countIf(ftc.wallet = o.wallet_address) AS wallet_match_count,
          round(100.0 * countIf(ftc.wallet != o.wallet_address) / countIf(ftc.condition_id IS NOT NULL), 2) AS wallet_mismatch_pct
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN fact_trades_clean ftc
          ON o.transaction_hash = ftc.tx_hash
      `,
      format: 'JSONEachRow'
    });
    console.log('\nfact_trades_clean orphan coverage:');
    console.log(JSON.stringify(await ftcCoverage.json(), null, 2));
  } catch (e) {
    console.log('fact_trades_clean coverage error:', e);
  }

  // Check for duplication
  try {
    const ftcDupes = await clickhouse.query({
      query: `
        SELECT
          o.transaction_hash,
          count(DISTINCT ftc.trade_id) as ftc_matches,
          groupArray(ftc.condition_id) as condition_ids,
          groupArray(ftc.wallet) as wallets
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN fact_trades_clean ftc
          ON o.transaction_hash = ftc.tx_hash
        WHERE ftc.trade_id IS NOT NULL
        GROUP BY o.transaction_hash
        HAVING ftc_matches > 1
        ORDER BY ftc_matches DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const ftcDupesData = await ftcDupes.json();
    console.log('\nfact_trades_clean duplication check (sample of multi-match txs):');
    console.log(JSON.stringify(ftcDupesData, null, 2));
  } catch (e) {
    console.log('fact_trades_clean duplication error:', e);
  }

  console.log('\n=== Phase 4 Complete ===');
}

evaluateTransferTables().catch(console.error);
