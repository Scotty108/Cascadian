#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('DEEP INVESTIGATION: Untraded Markets Mystery');
  console.log('═'.repeat(80));
  console.log();

  // 1. Verify condition ID formats in both tables
  console.log('1. Condition ID Format Analysis');
  console.log('─'.repeat(80));

  const tradeFormats = await client.query({
    query: `
      SELECT
        countIf(startsWith(condition_id_norm, '0x')) as with_0x,
        countIf(NOT startsWith(condition_id_norm, '0x')) as without_0x,
        countIf(length(condition_id_norm) = 66) as len_66,
        countIf(length(condition_id_norm) = 64) as len_64,
        countIf(length(condition_id_norm) < 64) as len_short,
        count(DISTINCT condition_id_norm) as unique_ids
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND condition_id_norm != ''
    `,
    format: 'JSONEachRow',
  });

  const tFmt = (await tradeFormats.json<any[]>())[0];
  console.log('Trades (vw_trades_canonical):');
  console.log(`  With 0x prefix: ${tFmt.with_0x.toLocaleString()}`);
  console.log(`  Without 0x: ${tFmt.without_0x.toLocaleString()}`);
  console.log(`  Length 66: ${tFmt.len_66.toLocaleString()}`);
  console.log(`  Length 64: ${tFmt.len_64.toLocaleString()}`);
  console.log(`  Length <64: ${tFmt.len_short.toLocaleString()}`);
  console.log(`  Unique IDs: ${tFmt.unique_ids.toLocaleString()}`);
  console.log();

  const resFormats = await client.query({
    query: `
      SELECT
        countIf(startsWith(condition_id_norm, '0x')) as with_0x,
        countIf(NOT startsWith(condition_id_norm, '0x')) as without_0x,
        countIf(length(condition_id_norm) = 66) as len_66,
        countIf(length(condition_id_norm) = 64) as len_64,
        countIf(length(condition_id_norm) < 64) as len_short,
        count(DISTINCT condition_id_norm) as unique_ids
      FROM default.market_resolutions_final
      WHERE source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });

  const rFmt = (await resFormats.json<any[]>())[0];
  console.log('Blockchain Resolutions (market_resolutions_final):');
  console.log(`  With 0x prefix: ${rFmt.with_0x.toLocaleString()}`);
  console.log(`  Without 0x: ${rFmt.without_0x.toLocaleString()}`);
  console.log(`  Length 66: ${rFmt.len_66.toLocaleString()}`);
  console.log(`  Length 64: ${rFmt.len_64.toLocaleString()}`);
  console.log(`  Length <64: ${rFmt.len_short.toLocaleString()}`);
  console.log(`  Unique IDs: ${rFmt.unique_ids.toLocaleString()}`);
  console.log();

  // 2. Check ALL possible join variations
  console.log('2. Testing ALL Join Format Variations');
  console.log('─'.repeat(80));

  const joinTests = [
    { name: 'Direct (r.id = t.id)', sql: 'r.condition_id_norm = t.condition_id_norm' },
    { name: 'Add 0x to blockchain (0x+r.id = t.id)', sql: 'concat(\'0x\', r.condition_id_norm) = t.condition_id_norm' },
    { name: 'Remove 0x from trades (r.id = t.id-0x)', sql: 'r.condition_id_norm = replaceAll(t.condition_id_norm, \'0x\', \'\')' },
    { name: 'Lowercase direct', sql: 'lower(r.condition_id_norm) = lower(t.condition_id_norm)' },
    { name: 'Lowercase with 0x', sql: 'lower(concat(\'0x\', r.condition_id_norm)) = lower(t.condition_id_norm)' },
    { name: 'Lowercase strip 0x', sql: 'lower(r.condition_id_norm) = lower(replaceAll(t.condition_id_norm, \'0x\', \'\'))' },
  ];

  for (const test of joinTests) {
    const result = await client.query({
      query: `
        SELECT count(DISTINCT r.condition_id_norm) as matched
        FROM default.market_resolutions_final r
        INNER JOIN default.vw_trades_canonical t
          ON ${test.sql}
        WHERE r.source = 'blockchain'
          AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      `,
      format: 'JSONEachRow',
    });
    const res = (await result.json<any[]>())[0];
    console.log(`  ${test.name}: ${res.matched.toLocaleString()} markets matched`);
  }
  console.log();

  // 3. Sample unmatched blockchain resolutions
  console.log('3. Sample UNMATCHED Blockchain Resolutions (First 10)');
  console.log('─'.repeat(80));

  const unmatched = await client.query({
    query: `
      SELECT
        r.condition_id_norm,
        r.payout_numerators,
        r.payout_denominator,
        r.outcome_count,
        r.resolved_at
      FROM default.market_resolutions_final r
      LEFT JOIN default.vw_trades_canonical t
        ON concat('0x', r.condition_id_norm) = t.condition_id_norm
      WHERE r.source = 'blockchain'
        AND t.condition_id_norm IS NULL
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const unmatchedRows = await unmatched.json<any[]>();
  unmatchedRows.forEach((row, idx) => {
    console.log(`  ${idx + 1}. ${row.condition_id_norm}`);
    console.log(`     Outcomes: ${row.outcome_count}, Payouts: ${row.payout_numerators}/${row.payout_denominator}`);
    console.log(`     Resolved: ${row.resolved_at}`);
  });
  console.log();

  // 4. Check if those IDs exist in OTHER tables (raw trade sources)
  console.log('4. Check If Unmatched IDs Exist in Raw Trade Tables');
  console.log('─'.repeat(80));

  const firstUnmatched = unmatchedRows[0]?.condition_id_norm;
  if (firstUnmatched) {
    console.log(`Testing condition ID: ${firstUnmatched}`);
    console.log();

    // Check trades_clob_raw
    try {
      const clobCheck = await client.query({
        query: `
          SELECT count(*) as cnt
          FROM default.trades_clob_raw
          WHERE lower(replaceAll(asset_id, '0x', '')) = lower('${firstUnmatched}')
        `,
        format: 'JSONEachRow',
      });
      const clobRes = (await clobCheck.json<any[]>())[0];
      console.log(`  trades_clob_raw: ${clobRes.cnt} matches`);
    } catch (e) {
      console.log(`  trades_clob_raw: Table not found or error`);
    }

    // Check erc1155_transfers
    try {
      const erc1155Check = await client.query({
        query: `
          SELECT count(*) as cnt
          FROM default.erc1155_transfers
          WHERE lower(replaceAll(token_id, '0x', '')) = lower('${firstUnmatched}')
        `,
        format: 'JSONEatchRow',
      });
      const erc1155Res = (await erc1155Check.json<any[]>())[0];
      console.log(`  erc1155_transfers: ${erc1155Res.cnt} matches`);
    } catch (e) {
      console.log(`  erc1155_transfers: Table not found or error`);
    }

    // Check usdc_transfers
    try {
      const usdcCheck = await client.query({
        query: `
          SELECT count(DISTINCT tx_hash) as cnt
          FROM default.usdc_transfers
          WHERE tx_hash IN (
            SELECT DISTINCT tx_hash
            FROM default.erc1155_transfers
            WHERE lower(replaceAll(token_id, '0x', '')) = lower('${firstUnmatched}')
          )
        `,
        format: 'JSONEachRow',
      });
      const usdcRes = (await usdcCheck.json<any[]>())[0];
      console.log(`  usdc_transfers (linked): ${usdcRes.cnt} transactions`);
    } catch (e) {
      console.log(`  usdc_transfers: Table not found or error`);
    }
  }
  console.log();

  // 5. Date range comparison
  console.log('5. Date Range Comparison');
  console.log('─'.repeat(80));

  const tradeDates = await client.query({
    query: `
      SELECT
        min(timestamp) as earliest,
        max(timestamp) as latest,
        count(DISTINCT condition_id_norm) as unique_markets
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });

  const tDates = (await tradeDates.json<any[]>())[0];
  console.log('Trades:');
  console.log(`  Earliest: ${tDates.earliest}`);
  console.log(`  Latest: ${tDates.latest}`);
  console.log(`  Unique markets: ${tDates.unique_markets.toLocaleString()}`);
  console.log();

  const resDates = await client.query({
    query: `
      SELECT
        min(resolved_at) as earliest,
        max(resolved_at) as latest,
        count(DISTINCT condition_id_norm) as unique_markets
      FROM default.market_resolutions_final
      WHERE source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });

  const rDates = (await resDates.json<any[]>())[0];
  console.log('Blockchain Resolutions:');
  console.log(`  Earliest: ${rDates.earliest}`);
  console.log(`  Latest: ${rDates.latest}`);
  console.log(`  Unique markets: ${rDates.unique_markets.toLocaleString()}`);
  console.log();

  // 6. Pattern analysis on unmatched IDs
  console.log('6. Pattern Analysis: Unmatched vs Matched Condition IDs');
  console.log('─'.repeat(80));

  const patterns = await client.query({
    query: `
      SELECT
        'MATCHED' as category,
        substring(r.condition_id_norm, 1, 4) as prefix,
        count(*) as cnt
      FROM default.market_resolutions_final r
      INNER JOIN default.vw_trades_canonical t
        ON concat('0x', r.condition_id_norm) = t.condition_id_norm
      WHERE r.source = 'blockchain'
      GROUP BY prefix
      ORDER BY cnt DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  console.log('Top prefixes in MATCHED blockchain resolutions:');
  const matchedPrefixes = await patterns.json<any[]>();
  matchedPrefixes.forEach(p => {
    console.log(`  ${p.prefix}...: ${p.cnt.toLocaleString()}`);
  });
  console.log();

  const unmatchedPatterns = await client.query({
    query: `
      SELECT
        'UNMATCHED' as category,
        substring(r.condition_id_norm, 1, 4) as prefix,
        count(*) as cnt
      FROM default.market_resolutions_final r
      LEFT JOIN default.vw_trades_canonical t
        ON concat('0x', r.condition_id_norm) = t.condition_id_norm
      WHERE r.source = 'blockchain'
        AND t.condition_id_norm IS NULL
      GROUP BY prefix
      ORDER BY cnt DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  console.log('Top prefixes in UNMATCHED blockchain resolutions:');
  const unmatchedPrefixList = await unmatchedPatterns.json<any[]>();
  unmatchedPrefixList.forEach(p => {
    console.log(`  ${p.prefix}...: ${p.cnt.toLocaleString()}`);
  });
  console.log();

  // 7. Summary statistics
  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));

  const summary = await client.query({
    query: `
      SELECT
        count(DISTINCT r.condition_id_norm) as total_blockchain_resolutions,
        countIf(t.condition_id_norm IS NOT NULL) as matched_with_trades,
        countIf(t.condition_id_norm IS NULL) as unmatched
      FROM default.market_resolutions_final r
      LEFT JOIN default.vw_trades_canonical t
        ON concat('0x', r.condition_id_norm) = t.condition_id_norm
      WHERE r.source = 'blockchain'
    `,
    format: 'JSONEachRow',
  });

  const summ = (await summary.json<any[]>())[0];
  const matchPct = (100 * summ.matched_with_trades / summ.total_blockchain_resolutions).toFixed(1);
  const unmatchPct = (100 * summ.unmatched / summ.total_blockchain_resolutions).toFixed(1);

  console.log(`Total blockchain resolutions: ${summ.total_blockchain_resolutions.toLocaleString()}`);
  console.log(`Matched with trades: ${summ.matched_with_trades.toLocaleString()} (${matchPct}%)`);
  console.log(`Unmatched (no trades): ${summ.unmatched.toLocaleString()} (${unmatchPct}%)`);
  console.log();
  console.log('DIAGNOSIS:');
  if (parseFloat(unmatchPct) > 60) {
    console.log('⚠️  HIGH percentage of blockchain resolutions have NO corresponding trades');
    console.log('   Possible causes:');
    console.log('   1. Markets resolved but never traded on Polymarket');
    console.log('   2. Missing trade data in vw_trades_canonical');
    console.log('   3. Condition ID normalization mismatch');
  } else {
    console.log('✅ Most blockchain resolutions match traded markets');
  }
  console.log('═'.repeat(80));

  await client.close();
}

main().catch(console.error);
