#!/usr/bin/env npx tsx
/**
 * Extract List of Markets Missing Resolutions
 *
 * Gets the prioritized list of condition_ids that need resolution backfill:
 * 1. 90+ days old (definitely resolved)
 * 2. 30-90 days old (likely resolved)
 * 3. <30 days old (might still be open)
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n📋 EXTRACTING MISSING RESOLUTIONS LIST\n');
  console.log('═'.repeat(80));

  // Get list of resolved condition_ids
  console.log('\n1️⃣ Getting resolved condition_ids...\n');

  const resolved = await ch.query({
    query: `
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      UNION ALL
      SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
      FROM default.resolutions_external_ingest
      WHERE payout_denominator > 0
    `,
    format: 'JSONEachRow'
  });

  const resolvedData = await resolved.json<any>();
  const resolvedSet = new Set(resolvedData.map((r: any) => r.cid_norm));
  console.log(`  Found ${resolvedSet.size.toLocaleString()} resolved markets`);

  // Get unresolved markets by age
  console.log('\n2️⃣ Finding unresolved markets by age...\n');

  const unresolved = await ch.query({
    query: `
      WITH market_ages AS (
        SELECT
          lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm,
          MAX(timestamp) as last_trade,
          COUNT(*) as trade_count,
          CASE
            WHEN last_trade >= now() - INTERVAL 30 DAY THEN 'recent'
            WHEN last_trade >= now() - INTERVAL 90 DAY THEN 'medium'
            ELSE 'old'
          END as age_category
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        GROUP BY cid_norm
      )
      SELECT
        cid_norm,
        last_trade,
        trade_count,
        age_category
      FROM market_ages
      ORDER BY age_category, trade_count DESC
    `,
    format: 'JSONEachRow'
  });

  const unresolvedData = await unresolved.json<any>();

  // Filter out resolved markets
  const missing = unresolvedData.filter((m: any) => !resolvedSet.has(m.cid_norm));

  // Group by age
  const byAge = {
    old: missing.filter((m: any) => m.age_category === 'old'),      // 90+ days
    medium: missing.filter((m: any) => m.age_category === 'medium'), // 30-90 days
    recent: missing.filter((m: any) => m.age_category === 'recent')  // <30 days
  };

  console.log(`  Old (90+ days): ${byAge.old.length.toLocaleString()}`);
  console.log(`  Medium (30-90 days): ${byAge.medium.length.toLocaleString()}`);
  console.log(`  Recent (<30 days): ${byAge.recent.length.toLocaleString()}`);
  console.log(`  Total missing: ${missing.length.toLocaleString()}`);

  // Save to files
  console.log('\n3️⃣ Saving to files...\n');

  const saveList = (list: any[], filename: string, description: string) => {
    const json = {
      generated_at: new Date().toISOString(),
      description,
      count: list.length,
      markets: list.map(m => ({
        condition_id: '0x' + m.cid_norm, // Add back 0x prefix
        last_trade: m.last_trade,
        trade_count: m.trade_count
      }))
    };

    writeFileSync(filename, JSON.stringify(json, null, 2));
    console.log(`  ✓ ${filename} (${list.length.toLocaleString()} markets)`);
  };

  saveList(byAge.old, 'missing-resolutions-priority-1-old.json',
    'Markets last traded 90+ days ago - definitely resolved (HIGH PRIORITY)');

  saveList(byAge.medium, 'missing-resolutions-priority-2-medium.json',
    'Markets last traded 30-90 days ago - likely resolved (MEDIUM PRIORITY)');

  saveList(byAge.recent, 'missing-resolutions-priority-3-recent.json',
    'Markets last traded <30 days ago - might still be open (LOW PRIORITY)');

  // Summary statistics
  console.log('\n═'.repeat(80));
  console.log('📊 SUMMARY\n');

  const totalTrades = missing.reduce((sum, m) => sum + parseInt(m.trade_count), 0);
  const oldTrades = byAge.old.reduce((sum, m) => sum + parseInt(m.trade_count), 0);

  console.log(`Total missing markets: ${missing.length.toLocaleString()}`);
  console.log(`Total trades in missing markets: ${totalTrades.toLocaleString()}`);
  console.log(`\nPriority 1 (90+ days old):`);
  console.log(`  Markets: ${byAge.old.length.toLocaleString()}`);
  console.log(`  Trades: ${oldTrades.toLocaleString()}`);
  console.log(`  Impact: Backfilling these will unlock ${(oldTrades/totalTrades*100).toFixed(1)}% of missing trade volume`);

  console.log('\n📁 Files created:');
  console.log('  missing-resolutions-priority-1-old.json');
  console.log('  missing-resolutions-priority-2-medium.json');
  console.log('  missing-resolutions-priority-3-recent.json');

  console.log('\n🎯 Next step:');
  console.log('  Run: npx tsx backfill-resolutions-from-api.ts missing-resolutions-priority-1-old.json\n');

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
