#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('=== TASK 1: INGESTION SANITY SWEEP ===\n');
  
  // CHECK 1: Timestamp validity
  console.log('━━━ CHECK 1: Timestamp Analysis ━━━\n');
  
  const timestampResult = await clickhouse.query({
    query: `
      SELECT
        min(created_at) as earliest,
        max(created_at) as latest,
        uniqExact(created_at) as unique_timestamps,
        count() as total_rows
      FROM default.trades_raw
    `,
    format: 'JSONEachRow'
  });
  const tsData = await timestampResult.json<Array<any>>();
  
  console.log(`trades_raw Timestamps:`);
  console.log(`  Earliest: ${tsData[0].earliest}`);
  console.log(`  Latest:   ${tsData[0].latest}`);
  console.log(`  Unique:   ${tsData[0].unique_timestamps.toLocaleString()}`);
  console.log(`  Total:    ${tsData[0].total_rows.toLocaleString()}\n`);
  
  if (tsData[0].unique_timestamps === 1) {
    console.log('❌ ANOMALY: All trades have the same timestamp!');
    console.log('   This indicates bulk import with incorrect timestamp handling.\n');
  } else {
    console.log(`✓ ${tsData[0].unique_timestamps.toLocaleString()} unique timestamps found.\n`);
  }
  
  // Also check trades_with_direction
  const twd_ts_result = await clickhouse.query({
    query: `
      SELECT
        min(computed_at) as earliest,
        max(computed_at) as latest,
        uniqExact(computed_at) as unique_timestamps,
        count() as total_rows
      FROM default.trades_with_direction
    `,
    format: 'JSONEachRow'
  });
  const twdTsData = await twd_ts_result.json<Array<any>>();
  
  console.log(`trades_with_direction Timestamps (computed_at):`);
  console.log(`  Earliest: ${twdTsData[0].earliest}`);
  console.log(`  Latest:   ${twdTsData[0].latest}`);
  console.log(`  Unique:   ${twdTsData[0].unique_timestamps.toLocaleString()}`);
  console.log(`  Total:    ${twdTsData[0].total_rows.toLocaleString()}\n`);
  
  // CHECK 2: Condition ID validity
  console.log('━━━ CHECK 2: Condition ID Format Validation ━━━\n');
  
  const cidValidityResult = await clickhouse.query({
    query: `
      WITH normalized AS (
        SELECT
          condition_id,
          lower(replaceAll(condition_id, '0x', '')) as cid_norm,
          length(replaceAll(condition_id, '0x', '')) as cid_length
        FROM default.trades_raw
      )
      SELECT
        countIf(cid_length = 64) as valid_64char,
        countIf(cid_length != 64) as invalid_length,
        countIf(cid_norm = '') as empty_cids,
        count() as total
      FROM normalized
    `,
    format: 'JSONEachRow'
  });
  const cidData = await cidValidityResult.json<Array<any>>();
  
  console.log(`trades_raw Condition ID Validation:`);
  console.log(`  Valid (64-char hex):  ${cidData[0].valid_64char.toLocaleString()} (${((cidData[0].valid_64char/cidData[0].total)*100).toFixed(2)}%)`);
  console.log(`  Invalid length:       ${cidData[0].invalid_length.toLocaleString()}`);
  console.log(`  Empty:                ${cidData[0].empty_cids.toLocaleString()}`);
  console.log(`  Total:                ${cidData[0].total.toLocaleString()}\n`);
  
  if (cidData[0].invalid_length > 0) {
    console.log('❌ ANOMALY: Found condition IDs with invalid length!\n');
    
    // Sample invalid IDs
    const sampleInvalidResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          length(replaceAll(condition_id, '0x', '')) as len,
          count() as occurrences
        FROM default.trades_raw
        WHERE length(replaceAll(condition_id, '0x', '')) != 64
        GROUP BY condition_id, len
        ORDER BY occurrences DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const invalidSamples = await sampleInvalidResult.json<Array<any>>();
    
    console.log('Sample invalid condition IDs:');
    invalidSamples.forEach((s, i) => {
      console.log(`  ${i+1}. "${s.condition_id}" (length: ${s.len}, occurrences: ${s.occurrences.toLocaleString()})`);
    });
    console.log();
  }
  
  // Check trades_with_direction condition IDs
  const twdCidResult = await clickhouse.query({
    query: `
      WITH normalized AS (
        SELECT
          condition_id,
          lower(replaceAll(condition_id, '0x', '')) as cid_norm,
          length(replaceAll(condition_id, '0x', '')) as cid_length
        FROM default.trades_with_direction
      )
      SELECT
        countIf(cid_length = 64) as valid_64char,
        countIf(cid_length != 64) as invalid_length,
        countIf(cid_norm = '') as empty_cids,
        count() as total
      FROM normalized
    `,
    format: 'JSONEachRow'
  });
  const twdCidData = await twdCidResult.json<Array<any>>();
  
  console.log(`trades_with_direction Condition ID Validation:`);
  console.log(`  Valid (64-char hex):  ${twdCidData[0].valid_64char.toLocaleString()} (${((twdCidData[0].valid_64char/twdCidData[0].total)*100).toFixed(2)}%)`);
  console.log(`  Invalid length:       ${twdCidData[0].invalid_length.toLocaleString()}`);
  console.log(`  Empty:                ${twdCidData[0].empty_cids.toLocaleString()}`);
  console.log(`  Total:                ${twdCidData[0].total.toLocaleString()}\n`);
  
  if (twdCidData[0].invalid_length > 0) {
    console.log('❌ ANOMALY: trades_with_direction has corrupted condition IDs!\n');
  }
  
  // CHECK 3: Trade direction field consistency
  console.log('━━━ CHECK 3: Trade Direction Field Consistency ━━━\n');
  
  // Check trades_raw (has 'trade_direction')
  const rawDirectionResult = await clickhouse.query({
    query: `
      SELECT
        trade_direction,
        count() as count
      FROM default.trades_raw
      GROUP BY trade_direction
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });
  const rawDirections = await rawDirectionResult.json<Array<any>>();
  
  console.log(`trades_raw.trade_direction distribution:`);
  rawDirections.forEach(d => {
    console.log(`  ${d.trade_direction}: ${d.count.toLocaleString()}`);
  });
  console.log();
  
  // Check if trades_raw has 'side' field
  const rawSideResult = await clickhouse.query({
    query: `
      SELECT
        side,
        count() as count
      FROM default.trades_raw
      GROUP BY side
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });
  const rawSides = await rawSideResult.json<Array<any>>();
  
  console.log(`trades_raw.side distribution:`);
  rawSides.forEach(s => {
    console.log(`  ${s.side}: ${s.count.toLocaleString()}`);
  });
  console.log();
  
  // Check trades_with_direction (has 'direction_from_transfers')
  const twdDirectionResult = await clickhouse.query({
    query: `
      SELECT
        direction_from_transfers,
        count() as count
      FROM default.trades_with_direction
      GROUP BY direction_from_transfers
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });
  const twdDirections = await twdDirectionResult.json<Array<any>>();
  
  console.log(`trades_with_direction.direction_from_transfers distribution:`);
  twdDirections.forEach(d => {
    console.log(`  ${d.direction_from_transfers}: ${d.count.toLocaleString()}`);
  });
  console.log();
  
  // SUMMARY
  console.log('━━━ SUMMARY & REQUIRED FIXES ━━━\n');
  
  const issues = [];
  
  if (tsData[0].unique_timestamps === 1) {
    issues.push({
      severity: 'CRITICAL',
      issue: 'All trades have identical timestamp (2025-11-05 19:21:12)',
      fix: 'Re-import with actual block_time or transaction timestamp from blockchain data'
    });
  }
  
  if (cidData[0].invalid_length > 0) {
    issues.push({
      severity: 'HIGH',
      issue: `${cidData[0].invalid_length.toLocaleString()} trades have invalid condition ID length`,
      fix: 'Identify source and re-import affected trades with correct condition_id format'
    });
  }
  
  if (twdCidData[0].invalid_length > 0) {
    issues.push({
      severity: 'CRITICAL',
      issue: `${twdCidData[0].invalid_length.toLocaleString()} trades_with_direction rows have corrupted condition IDs`,
      fix: 'Rebuild trades_with_direction from trades_raw using proper condition_id join (Task 2)'
    });
  }
  
  if (issues.length === 0) {
    console.log('✅ No critical data quality issues found.\n');
  } else {
    console.log(`Found ${issues.length} data quality issues:\n`);
    issues.forEach((issue, i) => {
      console.log(`${i+1}. [${issue.severity}] ${issue.issue}`);
      console.log(`   Fix: ${issue.fix}\n`);
    });
  }
  
  // Write results to JSON for report
  const results = {
    timestamp_check: {
      trades_raw: {
        earliest: tsData[0].earliest,
        latest: tsData[0].latest,
        unique_timestamps: tsData[0].unique_timestamps,
        total_rows: tsData[0].total_rows,
        anomaly: tsData[0].unique_timestamps === 1
      },
      trades_with_direction: {
        earliest: twdTsData[0].earliest,
        latest: twdTsData[0].latest,
        unique_timestamps: twdTsData[0].unique_timestamps,
        total_rows: twdTsData[0].total_rows
      }
    },
    condition_id_check: {
      trades_raw: {
        valid_64char: cidData[0].valid_64char,
        invalid_length: cidData[0].invalid_length,
        empty_cids: cidData[0].empty_cids,
        total: cidData[0].total,
        validity_pct: (cidData[0].valid_64char/cidData[0].total)*100
      },
      trades_with_direction: {
        valid_64char: twdCidData[0].valid_64char,
        invalid_length: twdCidData[0].invalid_length,
        empty_cids: twdCidData[0].empty_cids,
        total: twdCidData[0].total,
        validity_pct: (twdCidData[0].valid_64char/twdCidData[0].total)*100
      }
    },
    direction_fields: {
      trades_raw: {
        trade_direction: rawDirections,
        side: rawSides
      },
      trades_with_direction: {
        direction_from_transfers: twdDirections
      }
    },
    issues
  };
  
  const fs = require('fs');
  fs.writeFileSync('task1-ingestion-sanity-results.json', JSON.stringify(results, null, 2));
  console.log('Results written to: task1-ingestion-sanity-results.json\n');
}

main().catch(console.error);
