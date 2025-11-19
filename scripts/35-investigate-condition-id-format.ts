import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigateConditionIDFormat() {
  console.log('=== Investigating Condition ID Format Anomaly ===\n');
  console.log('🚨 CRITICAL: Top market showed trades in query 1, but 0 trades in query 2\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Query 1: Get top markets for xcnstrategy (this worked)
  console.log('QUERY 1: Get top markets (from script 34)\n');

  const topMarketsQuery = `
    SELECT
      condition_id_norm_v3 AS condition_id,
      outcome_index_v3 AS outcome_idx,
      count() AS trades,
      sum(abs(usd_value)) AS volume
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
    GROUP BY condition_id, outcome_idx
    ORDER BY volume DESC
    LIMIT 3
  `;

  const topMarketsResult = await clickhouse.query({ query: topMarketsQuery, format: 'JSONEachRow' });
  const topMarkets = await topMarketsResult.json<any[]>();

  console.log('Top 3 markets:\n');
  topMarkets.forEach((m, idx) => {
    console.log(`[${idx + 1}] CID: ${m.condition_id}`);
    console.log(`    Length: ${m.condition_id.length} chars`);
    console.log(`    Trades: ${m.trades}, Volume: $${Number(m.volume).toLocaleString()}`);
    console.log(`    First 20 chars: "${m.condition_id.substring(0, 20)}..."`);
    console.log(`    Last 20 chars:  "...${m.condition_id.substring(m.condition_id.length - 20)}"`);
    console.log('');
  });

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Query 2: Try to find this exact condition_id (failed with 0 results)
  console.log('QUERY 2: Search for top market directly\n');

  const topCID = topMarkets[0].condition_id;
  console.log(`Searching for: ${topCID}\n`);

  const directQuery = `
    SELECT
      count() AS total_trades,
      uniq(wallet_address) AS total_wallets
    FROM pm_trades_canonical_v3
    WHERE condition_id_norm_v3 = '${topCID}'
  `;

  const directResult = await clickhouse.query({ query: directQuery, format: 'JSONEachRow' });
  const directData = await directResult.json<any[]>();

  console.log(`Result: ${directData[0].total_trades} trades, ${directData[0].total_wallets} wallets\n`);

  if (Number(directData[0].total_trades) === 0) {
    console.log('❌ ZERO RESULTS! But Query 1 found this same condition_id with trades!\n');
  } else {
    console.log('✅ Found trades with direct query\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Hypothesis: Maybe condition_id has special characters or encoding issues
  console.log('HYPOTHESIS 1: Special characters or encoding\n');

  // Get hex encoding of the condition_id
  console.log(`Condition ID string: "${topCID}"`);
  console.log(`Character codes: ${Array.from(topCID.substring(0, 20)).map(c => c.charCodeAt(0)).join(', ')}\n`);

  // Check for non-printable characters
  const nonPrintable = Array.from(topCID).filter(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126);
  if (nonPrintable.length > 0) {
    console.log(`⚠️  Found ${nonPrintable.length} non-printable characters!`);
  } else {
    console.log('✅ No non-printable characters detected\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Hypothesis 2: Case sensitivity
  console.log('HYPOTHESIS 2: Case sensitivity\n');

  const lowerQuery = `
    SELECT count() AS trades
    FROM pm_trades_canonical_v3
    WHERE lower(condition_id_norm_v3) = lower('${topCID}')
  `;

  const lowerResult = await clickhouse.query({ query: lowerQuery, format: 'JSONEachRow' });
  const lowerData = await lowerResult.json<any[]>();

  console.log(`Case-insensitive search: ${lowerData[0].trades} trades\n`);

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Hypothesis 3: GROUP BY creates synthetic IDs
  console.log('HYPOTHESIS 3: Checking actual raw data\n');

  const rawDataQuery = `
    SELECT
      condition_id_norm_v3,
      outcome_index_v3,
      trade_direction,
      usd_value,
      timestamp
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
    ORDER BY usd_value DESC
    LIMIT 10
  `;

  const rawDataResult = await clickhouse.query({ query: rawDataQuery, format: 'JSONEachRow' });
  const rawData = await rawDataResult.json<any[]>();

  console.log('Top 10 trades by USD value (raw data):\n');
  console.log('| # | Condition ID (first 20)  | Out | Side | USD Value    | Timestamp           |');
  console.log('|---|--------------------------|-----|------|--------------|---------------------|');

  rawData.forEach((trade, idx) => {
    console.log(`| ${String(idx + 1).padStart(2)} | ${(trade.condition_id_norm_v3 || '').substring(0, 24)} | ${String(trade.outcome_index_v3).padStart(3)} | ${trade.trade_direction.padEnd(4)} | $${String(Number(trade.usd_value).toLocaleString()).padStart(10)} | ${trade.timestamp} |`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  // Check if these raw condition_ids match the grouped ones
  console.log('Comparing raw vs grouped condition_ids:\n');

  const rawCID = rawData[0]?.condition_id_norm_v3 || '';
  console.log(`Raw data CID:    "${rawCID}"`);
  console.log(`Grouped CID:     "${topCID}"`);
  console.log(`Match:           ${rawCID === topCID ? '✅ YES' : '❌ NO'}\n`);

  if (rawCID !== topCID) {
    console.log('Differences:');
    console.log(`  Raw length:    ${rawCID.length}`);
    console.log(`  Grouped length: ${topCID.length}`);
    console.log(`  Raw first 20:   "${rawCID.substring(0, 20)}"`);
    console.log(`  Grouped first 20: "${topCID.substring(0, 20)}"\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Final check: List ALL unique condition_ids for this wallet
  console.log('All unique condition_ids for xcnstrategy:\n');

  const allCIDsQuery = `
    SELECT DISTINCT
      condition_id_norm_v3 AS cid,
      length(condition_id_norm_v3) AS cid_length
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
    ORDER BY cid_length, cid
    LIMIT 20
  `;

  const allCIDsResult = await clickhouse.query({ query: allCIDsQuery, format: 'JSONEachRow' });
  const allCIDs = await allCIDsResult.json<any[]>();

  console.log('| # | Length | Condition ID (first 40 chars)            |');
  console.log('|---|--------|------------------------------------------|');

  allCIDs.forEach((row, idx) => {
    const cidStr = String(row.cid || '');
    console.log(`| ${String(idx + 1).padStart(2)} | ${String(row.cid_length).padStart(6)} | ${cidStr.substring(0, 40).padEnd(40)} |`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  // Count by length
  const lengthDistQuery = `
    SELECT
      length(condition_id_norm_v3) AS cid_length,
      count() AS trade_count,
      uniq(condition_id_norm_v3) AS unique_cids
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
    GROUP BY cid_length
    ORDER BY cid_length
  `;

  const lengthDistResult = await clickhouse.query({ query: lengthDistQuery, format: 'JSONEachRow' });
  const lengthDist = await lengthDistResult.json<any[]>();

  console.log('Condition ID length distribution:\n');
  console.log('| Length | Trade Count | Unique CIDs |');
  console.log('|--------|-------------|-------------|');

  lengthDist.forEach(row => {
    console.log(`| ${String(row.cid_length).padStart(6)} | ${String(row.trade_count).padStart(11)} | ${String(row.unique_cids).padStart(11)} |`);
  });

  console.log('\n');

  const expectedLength = 64; // 32 bytes = 64 hex chars
  const hasExpectedLength = lengthDist.some(row => row.cid_length === expectedLength);

  if (!hasExpectedLength) {
    console.log(`⚠️  WARNING: No condition_ids have expected length of ${expectedLength} chars!`);
    console.log('   Expected: 32-byte hex = 64 characters');
    console.log('   This suggests data format issues in condition_id_norm_v3 field\n');
  }

  return {
    topCID,
    directQueryTrades: Number(directData[0].total_trades),
    rawCID,
    lengthDistribution: lengthDist
  };
}

investigateConditionIDFormat().catch(console.error);
