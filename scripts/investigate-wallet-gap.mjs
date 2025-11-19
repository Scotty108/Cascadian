#!/usr/bin/env node

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const WALLETS = [
  { addr: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', name: 'Wallet 1 (CONTROL)' },
  { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', name: 'Wallet 2' },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', name: 'Wallet 3' },
  { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', name: 'Wallet 4' },
];

async function runQuery(name, query) {
  try {
    console.log(`\n${name}`);
    console.log('='.repeat(80));
    const result = await client.query({
      query,
      format: 'JSONEachRow',
    });
    const rows = await result.json();
    if (rows.length === 0) {
      console.log('(no results)');
    } else {
      console.table(rows);
    }
    return rows;
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return [];
  }
}

async function main() {
  console.log('\n');
  console.log('█'.repeat(80));
  console.log('  WALLET RESOLUTION GAP INVESTIGATION');
  console.log('█'.repeat(80));

  // CHECK 1: Table Existence
  console.log('\n\n### CHECK 1: TABLE EXISTENCE ###\n');

  await runQuery(
    '1a. Does market_resolutions_final exist?',
    `
    SELECT
      IF(COUNT(*) > 0, 'EXISTS', 'MISSING') as status,
      COUNT(*) as table_count
    FROM system.tables
    WHERE database = 'default' AND name = 'market_resolutions_final'
    `
  );

  await runQuery(
    '1b. Does trades_raw exist?',
    `
    SELECT
      IF(COUNT(*) > 0, 'EXISTS', 'MISSING') as status,
      COUNT(*) as table_count
    FROM system.tables
    WHERE database = 'default' AND name = 'trades_raw'
    `
  );

  // CHECK 2: Data Volume
  console.log('\n\n### CHECK 2: DATA VOLUME BY WALLET ###\n');

  const walletList = WALLETS.map((w) => `'${w.addr}'`).join(',');

  await runQuery(
    '2a. Trade counts per wallet',
    `
    SELECT
      wallet_address,
      count(*) as total_trades,
      countIf(condition_id != '') as condition_id_populated,
      countIf(condition_id = '') as condition_id_empty,
      round(100.0 * countIf(condition_id != '') / count(*), 1) as populated_pct
    FROM trades_raw
    WHERE wallet_address IN (${walletList})
    GROUP BY wallet_address
    ORDER BY total_trades DESC
    `
  );

  // CHECK 3: Join Verification
  console.log('\n\n### CHECK 3: JOIN VERIFICATION ###\n');

  await runQuery(
    '3a. Resolution join success rate per wallet',
    `
    SELECT
      t.wallet_address,
      count(*) as total_trade_conditions,
      countIf(r.condition_id_norm IS NOT NULL) as matched_in_resolutions,
      countIf(r.condition_id_norm IS NULL) as unmatched,
      round(100.0 * countIf(r.condition_id_norm IS NOT NULL) / count(*), 1) as match_pct
    FROM trades_raw t
    LEFT JOIN market_resolutions_final r ON
      lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    WHERE t.wallet_address IN (${walletList})
    GROUP BY t.wallet_address
    ORDER BY total_trade_conditions DESC
    `
  );

  // CHECK 4: Resolved Count
  console.log('\n\n### CHECK 4: RESOLVED CONDITION COUNTS ###\n');

  await runQuery(
    '4a. Resolved vs unresolved per wallet (using winning_index as source of truth)',
    `
    SELECT
      t.wallet_address,
      countIf(r.condition_id_norm IS NOT NULL AND r.winning_index IS NOT NULL) as resolved_count,
      countIf(r.condition_id_norm IS NOT NULL AND r.winning_index IS NULL) as unresolved_count,
      countIf(r.condition_id_norm IS NULL) as unmapped_count,
      count(*) as total_conditions
    FROM trades_raw t
    LEFT JOIN market_resolutions_final r ON
      lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    WHERE t.wallet_address IN (${walletList})
    GROUP BY t.wallet_address
    ORDER BY resolved_count DESC
    `
  );

  // CHECK 5: Sample Data
  console.log('\n\n### CHECK 5: SAMPLE DATA (WALLET 2) ###\n');

  await runQuery(
    '5a. Sample conditions and join results',
    `
    SELECT
      t.condition_id,
      lower(replaceAll(t.condition_id, '0x', '')) as normalized_id,
      r.condition_id_norm,
      r.is_resolved,
      IF(r.condition_id_norm IS NOT NULL, 'MATCHED', 'NOT_FOUND') as join_status
    FROM trades_raw t
    LEFT JOIN market_resolutions_final r ON
      lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    WHERE t.wallet_address = '0x8e9eedf20dfa70956d49f608a205e402d9df38e4'
    LIMIT 10
    `
  );

  // CHECK 6: market_resolutions_final Status
  console.log('\n\n### CHECK 6: market_resolutions_final DATA STATUS ###\n');

  await runQuery(
    '6a. Row count in market_resolutions_final',
    `
    SELECT
      COUNT(*) as total_rows,
      countIf(is_resolved = 1) as resolved_count,
      countIf(is_resolved = 0) as unresolved_count,
      COUNT(DISTINCT condition_id_norm) as unique_conditions
    FROM market_resolutions_final
    `
  );

  // CHECK 7: Comparison with Control (Wallet 1)
  console.log('\n\n### CHECK 7: CONTROL WALLET (1) ANALYSIS ###\n');

  await runQuery(
    '7a. Wallet 1 detailed breakdown (CONTROL - should have resolved data)',
    `
    SELECT
      t.wallet_address as wallet,
      count(*) as total_conditions,
      countIf(r.condition_id_norm IS NOT NULL) as found_in_resolutions,
      countIf(r.winning_index IS NOT NULL) as winning_index_count,
      countIf(r.winning_index IS NULL) as unresolved_count,
      countIf(r.condition_id_norm IS NULL) as not_found
    FROM trades_raw t
    LEFT JOIN market_resolutions_final r ON
      lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    WHERE t.wallet_address = '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'
    `
  );

  // SUMMARY
  console.log('\n\n');
  console.log('█'.repeat(80));
  console.log('  INVESTIGATION COMPLETE');
  console.log('█'.repeat(80));
  console.log(`
Analysis Results:
1. If CHECK 1a shows MISSING -> market_resolutions_final table not created
2. If CHECK 2a shows 0 rows for wallets 2-4 -> Data never imported
3. If CHECK 2a shows empty condition_id -> Condition IDs not populated
4. If CHECK 3a shows match_pct < 10% -> Join key mismatch or data format issue
5. If CHECK 4a shows 0 resolved_count -> No resolution data for those markets
6. If CHECK 6a shows 0 rows -> market_resolutions_final is empty

See WALLET_RESOLUTION_GAP_INVESTIGATION.md for detailed hypothesis analysis.
  `);
}

main().catch((error) => {
  console.error('\nFATAL ERROR:', error.message);
  process.exit(1);
});
