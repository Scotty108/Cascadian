#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000
});

const testWallets = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, name: 'Wallet 1 (Working)' },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, name: 'Wallet 2 (Broken)' },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, name: 'Wallet 3 (Broken)' },
  { address: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, name: 'Wallet 4 (Broken)' }
];

async function checkConditionCoverage() {
  console.log('='.repeat(80));
  console.log('CONDITION ID COVERAGE ANALYSIS');
  console.log('='.repeat(80));
  console.log();

  for (const wallet of testWallets) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${wallet.name}: ${wallet.address}`);
    console.log(`UI P&L: $${wallet.ui_pnl.toLocaleString()}`);
    console.log('='.repeat(80));

    // Get condition coverage summary
    const summaryQuery = `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet.address}')
          AND condition_id != ''
          AND condition_id IS NOT NULL
      )
      SELECT
        (SELECT count() FROM wallet_conditions) as total_conditions,
        (SELECT count()
         FROM wallet_conditions wc
         INNER JOIN market_resolutions_final r ON wc.condition_id_norm = r.condition_id_norm
        ) as matched_conditions,
        (SELECT count()
         FROM wallet_conditions wc
         LEFT JOIN market_resolutions_final r ON wc.condition_id_norm = r.condition_id_norm
         WHERE r.condition_id_norm IS NULL
        ) as unmatched_conditions
    `;

    const summaryResult = await client.query({ query: summaryQuery, format: 'JSONEachRow' });
    const summary: any = (await summaryResult.json())[0];

    if (summary) {
      const match_rate = summary.total_conditions > 0
        ? ((summary.matched_conditions / summary.total_conditions) * 100).toFixed(1)
        : '0.0';

      console.log(`\n📊 Coverage Summary:`);
      console.log(`   Total Unique Conditions: ${summary.total_conditions}`);
      console.log(`   Matched in Resolutions: ${summary.matched_conditions} (${match_rate}%)`);
      console.log(`   Unmatched: ${summary.unmatched_conditions}`);

      if (summary.matched_conditions > 0) {
        console.log(`\n✅ RESOLUTION DATA EXISTS for this wallet!`);
        console.log(`   → The is_resolved field is NOT being updated correctly`);
      } else {
        console.log(`\n❌ NO RESOLUTION DATA found for this wallet`);
        console.log(`   → Either markets aren't resolved or condition_id format is wrong`);
      }
    }

    // Get top conditions by trade count (show matched/unmatched status)
    console.log(`\n📋 Top 10 Conditions by Trade Count:`);

    const detailQuery = `
      WITH wallet_conditions AS (
        SELECT
          condition_id,
          lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
          count() as trade_count
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet.address}')
          AND condition_id != ''
          AND condition_id IS NOT NULL
        GROUP BY condition_id
      )
      SELECT
        wc.condition_id_norm,
        wc.trade_count,
        CASE WHEN r.condition_id_norm IS NOT NULL THEN 'MATCHED' ELSE 'UNMATCHED' END as status,
        r.winning_outcome,
        r.resolved_at
      FROM wallet_conditions wc
      LEFT JOIN market_resolutions_final r ON wc.condition_id_norm = r.condition_id_norm
      ORDER BY wc.trade_count DESC
      LIMIT 10
    `;

    const detailResult = await client.query({ query: detailQuery, format: 'JSONEachRow' });
    const details: any[] = await detailResult.json();

    console.table(details);

    // Sample condition_id formats
    console.log(`\n🔍 Sample Condition ID Formats (first 5):`);

    const formatQuery = `
      SELECT
        condition_id,
        length(condition_id) as len,
        condition_id LIKE '0x%' as has_prefix,
        length(replaceAll(condition_id, '0x', '')) as norm_len
      FROM trades_raw
      WHERE lower(wallet_address) = lower('${wallet.address}')
        AND condition_id != ''
        AND condition_id IS NOT NULL
      LIMIT 5
    `;

    const formatResult = await client.query({ query: formatQuery, format: 'JSONEachRow' });
    const formats: any[] = await formatResult.json();

    console.table(formats);

    // Check for format issues
    const issueQuery = `
      SELECT count() as bad_format_count
      FROM trades_raw
      WHERE lower(wallet_address) = lower('${wallet.address}')
        AND (
          condition_id = ''
          OR condition_id IS NULL
          OR length(replaceAll(condition_id, '0x', '')) != 64
        )
    `;

    const issueResult = await client.query({ query: issueQuery, format: 'JSONEachRow' });
    const issue: any = (await issueResult.json())[0];

    if (issue && issue.bad_format_count > 0) {
      console.log(`\n⚠️  WARNING: ${issue.bad_format_count} trades have malformed condition_ids`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(80));

  await client.close();
}

checkConditionCoverage()
  .then(() => {
    console.log('\n✅ Investigation complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
