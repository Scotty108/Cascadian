/**
 * Investigate why pm_trader_fills_canonical_v1 is behind pm_trader_events_v2
 *
 * Questions:
 * 1. Is canonical lagging (recent days missing)?
 * 2. Or is it systematically dropping certain fills?
 *
 * Tables to investigate:
 * - pm_trader_events_v2 (raw events with duplicates)
 * - pm_trader_fills_canonical_v1 (supposed to be canonical)
 * - pm_trader_events_dedup_v2_tbl (520M rows - might be the true canonical)
 * - pm_unified_ledger_v8_tbl
 * - pm_unified_ledger_v9_clob_nodrop_tbl
 * - pm_unified_ledger_v9_clob_tbl
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Investigating Canonical vs Events Gap ===\n');

  // 0. FIRST - Compare all candidate tables
  console.log('=== Candidate Tables Overview ===');
  const tablesToCheck = [
    'pm_trader_events_v2',
    'pm_trader_fills_canonical_v1',
    'pm_trader_events_dedup_v2_tbl',
    'pm_unified_ledger_v8_tbl',
    'pm_unified_ledger_v9_clob_nodrop_tbl',
    'pm_unified_ledger_v9_clob_tbl',
  ];

  for (const table of tablesToCheck) {
    try {
      // Get row count
      const countQuery = table === 'pm_trader_events_v2'
        ? `SELECT count() as cnt FROM ${table} WHERE is_deleted = 0`
        : `SELECT count() as cnt FROM ${table}`;
      const count = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
      const c = (await count.json() as any[])[0];

      // Try to get volume if usdc_amount column exists
      let volStr = 'N/A';
      try {
        const volQuery = table === 'pm_trader_events_v2'
          ? `SELECT sum(abs(usdc_amount))/1e6 as vol FROM ${table} WHERE is_deleted = 0`
          : `SELECT sum(abs(usdc_amount))/1e6 as vol FROM ${table}`;
        const vol = await clickhouse.query({ query: volQuery, format: 'JSONEachRow' });
        const v = (await vol.json() as any[])[0];
        volStr = `$${(parseFloat(v.vol) / 1e6).toFixed(2)}M`;
      } catch {
        volStr = 'no usdc_amount';
      }

      console.log(`  ${table}: ${parseInt(c.cnt).toLocaleString()} rows, ${volStr}`);
    } catch (e: any) {
      console.log(`  ${table}: ERROR - ${e.message?.substring(0, 50) || 'unknown'}`);
    }
  }
  console.log('');

  // 1. Daily volume comparison (last 30 days)
  console.log('=== Daily Volume Comparison (Last 30 Days) ===');
  const dailyQuery = `
    WITH
    e AS (
      SELECT toDate(ts) d, sum(abs(usdc_amount))/1e6 ev, count() as e_cnt
      FROM pm_trader_events_v2
      WHERE is_deleted=0 AND ts >= now() - INTERVAL 30 DAY
      GROUP BY d
    ),
    c AS (
      SELECT toDate(ts) d, sum(abs(usdc_amount))/1e6 cv, count() as c_cnt
      FROM pm_trader_fills_canonical_v1
      WHERE ts >= now() - INTERVAL 30 DAY
      GROUP BY d
    )
    SELECT e.d as date,
           e.ev as events_vol,
           c.cv as canonical_vol,
           if(e.ev=0, 1, c.cv/e.ev) AS ratio,
           e.ev - coalesce(c.cv, 0) as gap,
           e.e_cnt as events_cnt,
           c.c_cnt as canonical_cnt
    FROM e LEFT JOIN c USING d
    ORDER BY e.d DESC
    LIMIT 35
  `;

  const result = await clickhouse.query({ query: dailyQuery, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  console.log('Date        | Events Vol    | Canonical Vol | Ratio  | Gap           | E Cnt   | C Cnt');
  console.log('------------|---------------|---------------|--------|---------------|---------|--------');
  for (const r of rows) {
    const date = r.date;
    const ev = parseFloat(r.events_vol || 0).toFixed(0).padStart(13);
    const cv = parseFloat(r.canonical_vol || 0).toFixed(0).padStart(13);
    const ratio = parseFloat(r.ratio || 0).toFixed(3).padStart(6);
    const gap = parseFloat(r.gap || 0).toFixed(0).padStart(13);
    const eCnt = parseInt(r.events_cnt || 0).toString().padStart(7);
    const cCnt = parseInt(r.canonical_cnt || 0).toString().padStart(7);
    console.log(`${date} | ${ev} | ${cv} | ${ratio} | ${gap} | ${eCnt} | ${cCnt}`);
  }

  // Summary stats
  const totalEvents = rows.reduce((s, r) => s + parseFloat(r.events_vol || 0), 0);
  const totalCanonical = rows.reduce((s, r) => s + parseFloat(r.canonical_vol || 0), 0);
  console.log('\n=== 30-Day Summary ===');
  console.log(`Total Events Volume: $${(totalEvents/1e6).toFixed(2)}M`);
  console.log(`Total Canonical Volume: $${(totalCanonical/1e6).toFixed(2)}M`);
  console.log(`Overall Ratio: ${(totalCanonical/totalEvents*100).toFixed(1)}%`);
  console.log(`Total Gap: $${((totalEvents - totalCanonical)/1e6).toFixed(2)}M`);

  // 2. Get table schemas
  console.log('\n=== Table Schema: pm_trader_fills_canonical_v1 ===');
  const desc1 = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_trader_fills_canonical_v1',
    format: 'JSONEachRow'
  });
  const schema1 = await desc1.json() as any[];
  for (const r of schema1) {
    console.log(`  ${r.name}: ${r.type}`);
  }

  console.log('\n=== Table Schema: pm_trader_events_v2 ===');
  const desc2 = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_trader_events_v2',
    format: 'JSONEachRow'
  });
  const schema2 = await desc2.json() as any[];
  for (const r of schema2) {
    console.log(`  ${r.name}: ${r.type}`);
  }

  // 3. Row counts
  console.log('\n=== Total Row Counts ===');
  const count1 = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_trader_fills_canonical_v1',
    format: 'JSONEachRow'
  });
  const c1 = (await count1.json() as any[])[0];
  console.log(`pm_trader_fills_canonical_v1: ${parseInt(c1.cnt).toLocaleString()} rows`);

  const count2 = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0',
    format: 'JSONEachRow'
  });
  const c2 = (await count2.json() as any[])[0];
  console.log(`pm_trader_events_v2 (is_deleted=0): ${parseInt(c2.cnt).toLocaleString()} rows`);

  // 4. Check for common join keys between tables
  console.log('\n=== Checking Join Keys ===');

  // Sample some data to find matching patterns
  const sampleQuery = `
    SELECT
      event_id,
      trader_wallet,
      token_id,
      usdc_amount,
      token_amount,
      ts
    FROM pm_trader_fills_canonical_v1
    LIMIT 5
  `;
  const sample = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleRows = await sample.json() as any[];
  console.log('Sample canonical fills:');
  for (const r of sampleRows) {
    console.log(`  event_id=${r.event_id}, wallet=${r.trader_wallet?.substring(0,10)}..., token=${r.token_id?.substring(0,10)}...`);
  }

  // Check if event_id exists in events_v2
  if (sampleRows.length > 0) {
    const testEventId = sampleRows[0].event_id;
    console.log(`\nChecking if event_id=${testEventId} exists in pm_trader_events_v2...`);
    const checkQuery = `
      SELECT count() as cnt FROM pm_trader_events_v2 WHERE event_id = '${testEventId}'
    `;
    const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
    const checkRows = await checkResult.json() as any[];
    console.log(`  Found ${checkRows[0].cnt} matching rows`);
  }

  // 5. Check the worst wallet from validation results
  console.log('\n=== Worst Wallet Analysis (0xd57c...) ===');
  const worstWallet = '0xd57c675ac2aec7dc4985b4f20c2360a255cc1a45';

  const walletEventsQuery = `
    SELECT
      count() as cnt,
      sum(abs(usdc_amount))/1e6 as vol,
      min(ts) as first_ts,
      max(ts) as last_ts
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${worstWallet}')
      AND is_deleted = 0
  `;
  const walletEvents = await clickhouse.query({ query: walletEventsQuery, format: 'JSONEachRow' });
  const we = (await walletEvents.json() as any[])[0];
  console.log(`Events: ${we.cnt} fills, $${parseFloat(we.vol).toFixed(2)} volume`);
  console.log(`  Date range: ${we.first_ts} to ${we.last_ts}`);

  const walletCanonicalQuery = `
    SELECT
      count() as cnt,
      sum(abs(usdc_amount))/1e6 as vol,
      min(ts) as first_ts,
      max(ts) as last_ts
    FROM pm_trader_fills_canonical_v1
    WHERE lower(trader_wallet) = lower('${worstWallet}')
  `;
  const walletCanonical = await clickhouse.query({ query: walletCanonicalQuery, format: 'JSONEachRow' });
  const wc = (await walletCanonical.json() as any[])[0];
  console.log(`Canonical: ${wc.cnt} fills, $${parseFloat(wc.vol).toFixed(2)} volume`);
  console.log(`  Date range: ${wc.first_ts} to ${wc.last_ts}`);

  // Try to find the missing fills using event_id
  console.log('\n=== Missing Fills Analysis ===');
  const missingQuery = `
    SELECT
      e.event_id,
      e.usdc_amount / 1e6 as usdc,
      e.ts
    FROM pm_trader_events_v2 e
    LEFT JOIN pm_trader_fills_canonical_v1 c
      ON e.event_id = c.event_id
    WHERE lower(e.trader_wallet) = lower('${worstWallet}')
      AND e.is_deleted = 0
      AND c.event_id IS NULL
    ORDER BY e.ts DESC
    LIMIT 20
  `;
  const missing = await clickhouse.query({ query: missingQuery, format: 'JSONEachRow' });
  const missingRows = await missing.json() as any[];
  console.log(`Found ${missingRows.length} fills in events but NOT in canonical (showing first 20):`);
  for (const r of missingRows) {
    console.log(`  ${r.ts}: $${parseFloat(r.usdc).toFixed(2)} (event_id=${r.event_id?.substring(0,20)}...)`);
  }
}

main().catch(console.error);
