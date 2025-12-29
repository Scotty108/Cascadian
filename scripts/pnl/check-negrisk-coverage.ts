/**
 * Check GoldSky/NegRisk data coverage
 * Answers: "Are we still missing data from GoldSky? NegRisk, etc."
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function checkNegRiskCoverage() {
  console.log('=== GOLDSKY/NEGRISK DATA COVERAGE CHECK ===\n');

  // Check pm_ctf_events for NegRisk-related events
  console.log('1. CTF Events by Type:');
  const ctfTypes = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as count,
        count(DISTINCT lower(user_address)) as unique_wallets
      FROM pm_ctf_events
      WHERE is_deleted = 0
      GROUP BY event_type
      ORDER BY count DESC
    `,
    format: 'JSONEachRow',
  });
  const ctfTypesData = (await ctfTypes.json()) as any[];
  ctfTypesData.forEach((t: any) =>
    console.log(
      `  ${t.event_type}: ${Number(t.count).toLocaleString()} events, ${Number(t.unique_wallets).toLocaleString()} wallets`
    )
  );

  // Check what operators we have
  console.log('\n2. Top Operators in CTF Events:');
  const operators = await clickhouse.query({
    query: `
      SELECT
        operator,
        count() as events,
        count(DISTINCT lower(user_address)) as wallets
      FROM pm_ctf_events
      WHERE is_deleted = 0 AND operator != ''
      GROUP BY operator
      ORDER BY events DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const opsData = (await operators.json()) as any[];
  opsData.forEach((t: any) =>
    console.log(
      `  ${t.operator}: ${Number(t.events).toLocaleString()} events, ${Number(t.wallets).toLocaleString()} wallets`
    )
  );

  // Check total data coverage
  console.log('\n3. Total Data Coverage:');
  const coverage = await clickhouse.query({
    query: `
      SELECT
        'pm_trader_events_v2' as table_name,
        count() as total_rows,
        count(DISTINCT lower(trader_wallet)) as unique_wallets,
        min(trade_time) as earliest,
        max(trade_time) as latest
      FROM pm_trader_events_v2
      WHERE is_deleted = 0

      UNION ALL

      SELECT
        'pm_ctf_events' as table_name,
        count() as total_rows,
        count(DISTINCT lower(user_address)) as unique_wallets,
        min(block_timestamp) as earliest,
        max(block_timestamp) as latest
      FROM pm_ctf_events
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const coverageData = (await coverage.json()) as any[];
  coverageData.forEach((t: any) =>
    console.log(
      `  ${t.table_name}: ${Number(t.total_rows).toLocaleString()} rows, ${Number(t.unique_wallets).toLocaleString()} wallets, ${t.earliest} to ${t.latest}`
    )
  );

  // Check if we have conditional token transfers (ERC1155)
  console.log('\n4. ERC1155 Transfer Coverage:');
  const erc1155 = await clickhouse.query({
    query: `
      SELECT
        count() as total_transfers,
        count(DISTINCT lower(from_address)) as unique_senders,
        min(block_timestamp) as earliest,
        max(block_timestamp) as latest
      FROM pm_erc1155_transfers
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const erc1155Data = (await erc1155.json()) as any[];
  erc1155Data.forEach((t: any) =>
    console.log(
      `  ${Number(t.total_transfers).toLocaleString()} transfers, ${Number(t.unique_senders).toLocaleString()} senders, ${t.earliest} to ${t.latest}`
    )
  );

  // Look for Split/Merge events which are NegRisk related
  console.log('\n5. Split/Merge (NegRisk) Events:');
  const splitMerge = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as events,
        count(DISTINCT lower(user_address)) as wallets
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND (event_type LIKE '%Split%' OR event_type LIKE '%Merge%' OR event_type LIKE '%Neg%')
      GROUP BY event_type
      ORDER BY events DESC
    `,
    format: 'JSONEachRow',
  });
  const splitMergeData = (await splitMerge.json()) as any[];
  if (splitMergeData.length === 0) {
    console.log('  NO Split/Merge events found - NegRisk data MAY be missing!');
  } else {
    splitMergeData.forEach((t: any) =>
      console.log(
        `  ${t.event_type}: ${Number(t.events).toLocaleString()} events, ${Number(t.wallets).toLocaleString()} wallets`
      )
    );
  }

  // Summary assessment
  console.log('\n=== ASSESSMENT ===');
  const hasSplitMerge = splitMergeData.length > 0;
  const hasRedemptions = ctfTypesData.some((t: any) => t.event_type === 'PayoutRedemption');
  const hasTransfers = ctfTypesData.some(
    (t: any) => t.event_type === 'TransferSingle' || t.event_type === 'TransferBatch'
  );

  console.log(`  Has PayoutRedemption events: ${hasRedemptions ? 'YES ✓' : 'NO ✗'}`);
  console.log(`  Has Transfer events: ${hasTransfers ? 'YES ✓' : 'NO ✗'}`);
  console.log(`  Has Split/Merge (NegRisk): ${hasSplitMerge ? 'YES ✓' : 'MISSING ✗'}`);

  if (!hasSplitMerge) {
    console.log('\n⚠️  NegRisk Split/Merge events are NOT in our database.');
    console.log('   This affects wallets that use position splitting/merging.');
    console.log('   However, for V7 asymmetric mode, this has MINIMAL impact');
    console.log('   because we only realize losses (not unredeemed gains).');
  }
}

checkNegRiskCoverage().catch(console.error);
