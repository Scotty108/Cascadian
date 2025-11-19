#!/usr/bin/env npx tsx
/**
 * DIAGNOSE CID MISMATCH
 *
 * Gate A: 99.59% ✅ (we have the transactions)
 * Gate B: 0.62% ❌ (CIDs don't match resolutions)
 *
 * Investigate:
 * 1. What do market_id_norm values look like in vw_trades_canonical?
 * 2. What do market_id values look like in mapping tables?
 * 3. What do CIDs look like in union map vs resolutions?
 * 4. Are we normalizing correctly?
 */

import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function runQuery<T = any>(query: string, description: string): Promise<T[]> {
  console.log(`\n🔍 ${description}...`);
  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json<T>();
    return data;
  } catch (error) {
    console.error(`❌ Error: ${error}`);
    throw error;
  }
}

async function investigateMarketIdFormats() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('1. MARKET_ID FORMAT INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════');

  // Sample market_id_norm from vw_trades_canonical
  const vwcQuery = `
    SELECT DISTINCT market_id_norm
    FROM vw_trades_canonical
    WHERE market_id_norm IS NOT NULL AND market_id_norm != ''
    LIMIT 10
  `;
  const vwcSamples = await runQuery(vwcQuery, 'Sampling market_id_norm from vw_trades_canonical');

  console.log('\nSample market_id_norm from vw_trades_canonical:');
  for (const row of vwcSamples) {
    console.log(`  ${row.market_id_norm}`);
  }

  // Sample market_id from mapping tables
  const mappingQuery = `
    SELECT DISTINCT market_id
    FROM market_id_mapping
    LIMIT 10
  `;
  const mappingSamples = await runQuery(mappingQuery, 'Sampling market_id from market_id_mapping');

  console.log('\nSample market_id from market_id_mapping:');
  for (const row of mappingSamples) {
    console.log(`  ${row.market_id}`);
  }
}

async function investigateCidFormats() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('2. CONDITION_ID FORMAT INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════');

  // Sample CIDs from union map
  const unionQuery = `
    SELECT DISTINCT cid64
    FROM _tx_cid_union
    LIMIT 10
  `;
  const unionSamples = await runQuery(unionQuery, 'Sampling cid64 from union map');

  console.log('\nSample cid64 from union map:');
  for (const row of unionSamples) {
    console.log(`  ${row.cid64}`);
  }

  // Sample CIDs from resolutions
  const resQuery = `
    SELECT DISTINCT cid64
    FROM _cid_res
    LIMIT 10
  `;
  const resSamples = await runQuery(resQuery, 'Sampling cid64 from resolutions');

  console.log('\nSample cid64 from resolutions:');
  for (const row of resSamples) {
    console.log(`  ${row.cid64}`);
  }

  // Sample the 890 CIDs that DO match
  const matchingQuery = `
    SELECT DISTINCT u.cid64
    FROM _tx_cid_union u
    INNER JOIN _cid_res r USING(cid64)
    LIMIT 10
  `;
  const matchingSamples = await runQuery(matchingQuery, 'Sampling CIDs that DO match');

  console.log('\nSample cid64 that DO match (the 890 successful ones):');
  for (const row of matchingSamples) {
    console.log(`  ${row.cid64}`);
  }
}

async function investigateSourceBreakdown() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('3. UNION MAP SOURCE BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════════');

  // Check which source contributes the matching CIDs
  const marketMatchQuery = `
    SELECT count() AS cnt
    FROM _tx_cid_via_market m
    INNER JOIN _cid_res r ON m.cid64 = r.cid64
  `;
  const marketMatch = await runQuery(marketMatchQuery, 'CIDs from market_id that match resolutions');
  console.log(`\n  Market_id source matches: ${marketMatch[0].cnt.toLocaleString()}`);

  const tokenMatchQuery = `
    SELECT count() AS cnt
    FROM _tx_cid_via_token t
    INNER JOIN _cid_res r ON t.cid64 = r.cid64
  `;
  const tokenMatch = await runQuery(tokenMatchQuery, 'CIDs from token decoding that match resolutions');
  console.log(`  Token decoding matches:   ${tokenMatch[0].cnt.toLocaleString()}`);

  const erc1155MatchQuery = `
    SELECT count() AS cnt
    FROM _tx_cid_via_erc1155 e
    INNER JOIN _cid_res r ON e.cid64 = r.cid64
  `;
  const erc1155Match = await runQuery(erc1155MatchQuery, 'CIDs from ERC1155 that match resolutions');
  console.log(`  ERC1155 source matches:   ${erc1155Match[0].cnt.toLocaleString()}`);
}

async function investigateConditionIdInVwc() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('4. CONDITION_ID_NORM IN VW_TRADES_CANONICAL');
  console.log('═══════════════════════════════════════════════════════════');

  // Sample condition_id_norm from vw_trades_canonical directly
  const vwcCidQuery = `
    SELECT DISTINCT condition_id_norm
    FROM vw_trades_canonical
    WHERE condition_id_norm IS NOT NULL
      AND condition_id_norm != ''
      AND condition_id_norm != concat('0x', repeat('0', 64))
    LIMIT 10
  `;
  const vwcCidSamples = await runQuery(vwcCidQuery, 'Sampling condition_id_norm from vw_trades_canonical');

  console.log('\nSample condition_id_norm from vw_trades_canonical (raw):');
  for (const row of vwcCidSamples) {
    console.log(`  ${row.condition_id_norm}`);
  }

  // Now normalize and check if they match resolutions
  const vwcCidNormQuery = `
    WITH vwc_norm AS (
      SELECT DISTINCT lpad(lower(replaceAll(condition_id_norm, '0x', '')), 64, '0') AS cid64
      FROM vw_trades_canonical
      WHERE condition_id_norm IS NOT NULL
        AND condition_id_norm != ''
        AND condition_id_norm != concat('0x', repeat('0', 64))
      LIMIT 10
    )
    SELECT
      v.cid64,
      if(v.cid64 IN (SELECT cid64 FROM _cid_res), 'YES', 'NO') AS in_resolutions
    FROM vwc_norm v
  `;
  const vwcNormCheck = await runQuery(vwcCidNormQuery, 'Checking if normalized vwc CIDs match resolutions');

  console.log('\nNormalized vwc condition_ids and resolution match:');
  for (const row of vwcNormCheck) {
    console.log(`  ${row.cid64} → ${row.in_resolutions}`);
  }
}

async function investigateDirectCidJoin() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('5. DIRECT CONDITION_ID JOIN TEST');
  console.log('═══════════════════════════════════════════════════════════');

  // Test: If we join vw_trades_canonical directly to resolutions on condition_id_norm,
  // how many match?
  const directJoinQuery = `
    WITH vwc_cids AS (
      SELECT DISTINCT lpad(lower(replaceAll(condition_id_norm, '0x', '')), 64, '0') AS cid64
      FROM vw_trades_canonical
      WHERE condition_id_norm IS NOT NULL
        AND condition_id_norm != ''
        AND condition_id_norm != concat('0x', repeat('0', 64))
    )
    SELECT
      (SELECT count() FROM vwc_cids) AS vwc_distinct_cids,
      (SELECT count() FROM _cid_res) AS res_distinct_cids,
      (SELECT count() FROM vwc_cids v INNER JOIN _cid_res r USING(cid64)) AS direct_join_matches,
      round(100.0 * direct_join_matches / nullIf(vwc_distinct_cids, 0), 2) AS pct_vwc_in_res,
      round(100.0 * direct_join_matches / nullIf(res_distinct_cids, 0), 2) AS pct_res_in_vwc
  `;

  const directJoin = await runQuery(directJoinQuery, 'Testing direct vwc → resolutions join');
  const d = directJoin[0];

  console.log('\nDirect join results (vwc.condition_id_norm → resolutions):');
  console.log(`  VWC distinct CIDs:        ${d.vwc_distinct_cids.toLocaleString()}`);
  console.log(`  Res distinct CIDs:        ${d.res_distinct_cids.toLocaleString()}`);
  console.log(`  Direct matches:           ${d.direct_join_matches.toLocaleString()}`);
  console.log(`  % VWC in res:             ${d.pct_vwc_in_res}%`);
  console.log(`  % Res in VWC:             ${d.pct_res_in_vwc}%`);

  console.log('\n💡 KEY INSIGHT:');
  if (d.pct_res_in_vwc > 50) {
    console.log('  ✅ Direct condition_id_norm join works!');
    console.log('  ➡️  We should skip the market_id mapping and use vwc.condition_id_norm directly');
  } else {
    console.log('  ❌ Direct condition_id_norm join also fails');
    console.log('  ➡️  The issue is deeper - CID formats are fundamentally incompatible');
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔬 DIAGNOSE CID MISMATCH');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Gate A: 99.59% ✅ (we have the transactions)');
  console.log('Gate B: 0.62% ❌ (only 890 / 144,109 CIDs match)');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    await investigateMarketIdFormats();
    await investigateCidFormats();
    await investigateSourceBreakdown();
    await investigateConditionIdInVwc();
    await investigateDirectCidJoin();

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('DIAGNOSTIC COMPLETE');
    console.log('═══════════════════════════════════════════════════════════\n');

    await clickhouse.close();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    await clickhouse.close();
    process.exit(2);
  }
}

main();
