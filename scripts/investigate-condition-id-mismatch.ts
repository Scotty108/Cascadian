import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n=== INVESTIGATING CONDITION_ID FORMAT MISMATCH ===\n');

  // Step 1: Check format of condition_id_norm in vw_trades_canonical
  console.log('Step 1: Checking vw_trades_canonical.condition_id_norm format\n');

  const tradesFormat = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) as len,
        substring(condition_id_norm, 1, 2) as prefix,
        lower(condition_id_norm) = condition_id_norm as is_lowercase
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const tradeRows = await tradesFormat.json() as Array<{
    condition_id_norm: string;
    len: string;
    prefix: string;
    is_lowercase: number;
  }>;

  console.log('Sample from vw_trades_canonical:');
  tradeRows.forEach(r => {
    console.log(`  ${r.condition_id_norm.substring(0, 20)}... (len=${r.len}, prefix="${r.prefix}", lowercase=${r.is_lowercase === 1})`);
  });

  // Step 2: Check format in market_resolutions_final
  console.log('\nStep 2: Checking market_resolutions_final.condition_id_norm format\n');

  const resFormat = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        length(condition_id_norm) as len,
        substring(condition_id_norm, 1, 2) as prefix,
        lower(condition_id_norm) = condition_id_norm as is_lowercase
      FROM default.market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const resRows = await resFormat.json() as Array<{
    condition_id_norm: string;
    len: string;
    prefix: string;
    is_lowercase: number;
  }>;

  console.log('Sample from market_resolutions_final:');
  resRows.forEach(r => {
    console.log(`  ${r.condition_id_norm.substring(0, 20)}... (len=${r.len}, prefix="${r.prefix}", lowercase=${r.is_lowercase === 1})`);
  });

  // Step 3: Check format in vw_resolutions_unified
  console.log('\nStep 3: Checking vw_resolutions_unified.cid_hex format\n');

  const unifiedFormat = await ch.query({
    query: `
      SELECT
        cid_hex,
        length(cid_hex) as len,
        substring(cid_hex, 1, 2) as prefix
      FROM cascadian_clean.vw_resolutions_unified
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const unifiedRows = await unifiedFormat.json() as Array<{
    cid_hex: string;
    len: string;
    prefix: string;
  }>;

  console.log('Sample from vw_resolutions_unified:');
  unifiedRows.forEach(r => {
    console.log(`  ${r.cid_hex.substring(0, 20)}... (len=${r.len}, prefix="${r.prefix}")`);
  });

  // Step 4: Test different join approaches
  console.log('\n=== TESTING DIFFERENT JOIN APPROACHES ===\n');

  const joinTests = [
    {
      name: 'Direct join (as-is)',
      condition: `t.condition_id_norm = r.cid_hex`,
    },
    {
      name: 'Lower both sides',
      condition: `lower(t.condition_id_norm) = lower(r.cid_hex)`,
    },
    {
      name: 'Strip 0x from trades',
      condition: `lower(replaceAll(t.condition_id_norm, '0x', '')) = lower(replaceAll(r.cid_hex, '0x', ''))`,
    },
    {
      name: 'Add 0x to resolutions (WRONG - for comparison)',
      condition: `lower(t.condition_id_norm) = lower(concat('0x', r.cid_hex))`,
    },
  ];

  for (const test of joinTests) {
    const result = await ch.query({
      query: `
        SELECT count(DISTINCT t.condition_id_norm) as matches
        FROM (
          SELECT DISTINCT condition_id_norm
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          LIMIT 100000
        ) t
        INNER JOIN cascadian_clean.vw_resolutions_unified r
          ON ${test.condition}
      `,
      format: 'JSONEachRow',
    });

    const matchCount = (await result.json())[0] as { matches: string };
    const pct = ((parseInt(matchCount.matches) / 100000) * 100).toFixed(2);
    console.log(`${test.name.padEnd(40)}: ${parseInt(matchCount.matches).toLocaleString().padStart(10)} matches (${pct}%)`);
  }

  // Step 5: Find a specific overlapping market
  console.log('\n=== FINDING OVERLAPPING MARKET ===\n');

  const overlap = await ch.query({
    query: `
      SELECT
        t.condition_id_norm as trade_cid,
        r.cid_hex as res_cid,
        r.winning_outcome,
        r.payout_numerators
      FROM (
        SELECT DISTINCT condition_id_norm
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        LIMIT 100000
      ) t
      INNER JOIN cascadian_clean.vw_resolutions_unified r
        ON lower(t.condition_id_norm) = lower(r.cid_hex)
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });

  const overlapRows = await overlap.json();
  if (overlapRows.length > 0) {
    const row = overlapRows[0] as any;
    console.log('Example matching market:');
    console.log(`  Trade CID:     ${row.trade_cid}`);
    console.log(`  Resolution CID: ${row.res_cid}`);
    console.log(`  Match:         ${row.trade_cid.toLowerCase() === row.res_cid.toLowerCase()}`);
    console.log(`  Outcome:       ${row.winning_outcome}`);
  } else {
    console.log('No overlapping markets found!');
  }

  // Step 6: Calculate correct expected coverage
  console.log('\n=== EXPECTED VS ACTUAL COVERAGE ===\n');

  const expectedCoverage = await ch.query({
    query: `
      WITH trades_distinct AS (
        SELECT count(DISTINCT condition_id_norm) as total
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ),
      resolutions_distinct AS (
        SELECT count(DISTINCT cid_hex) as total
        FROM cascadian_clean.vw_resolutions_unified
      )
      SELECT
        trades_distinct.total as traded_markets,
        resolutions_distinct.total as resolved_markets,
        round(100.0 * resolutions_distinct.total / trades_distinct.total, 2) as expected_coverage_pct
      FROM trades_distinct, resolutions_distinct
    `,
    format: 'JSONEachRow',
  });

  const expected = (await expectedCoverage.json())[0] as {
    traded_markets: string;
    resolved_markets: string;
    expected_coverage_pct: string;
  };

  console.log(`Traded markets:      ${parseInt(expected.traded_markets).toLocaleString()}`);
  console.log(`Resolved markets:    ${parseInt(expected.resolved_markets).toLocaleString()}`);
  console.log(`Expected coverage:   ${expected.expected_coverage_pct}% (if 100% overlap)`);
  console.log(`Actual coverage:     24.8% (from earlier measurement)`);
  console.log(`\nConclusion: ${parseFloat(expected.expected_coverage_pct) > 50 ?
    'Most traded markets are NOT resolved yet' :
    'Join logic is working correctly'}`);

  await ch.close();
}

main().catch(console.error);
