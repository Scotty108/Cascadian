#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

async function investigateConflictPatterns() {
  console.log('🔬 Investigating Conflict Patterns...\n');

  // 1. Check for specific patterns in wallet addresses
  console.log('1. Analyzing wallet address patterns in conflicts...');
  const walletPatternsResult = await clickhouse.query({
    query: `
      WITH conflict_trades AS (
        SELECT
          transaction_hash,
          wallet_address,
          trade_id,
          created_at,
          source
        FROM pm_trades_canonical_v3
        WHERE transaction_hash IN (
          SELECT transaction_hash
          FROM pm_trades_canonical_v3
          GROUP BY transaction_hash
          HAVING count() > 1
          LIMIT 1000
        )
      )
      SELECT
        transaction_hash,
        groupArray(wallet_address) AS wallets,
        groupArray(source) AS sources,
        count() AS wallet_count,
        min(created_at) AS first_seen,
        max(created_at) AS last_seen
      FROM conflict_trades
      GROUP BY transaction_hash
      ORDER BY wallet_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const patterns = await walletPatternsResult.json<any>();

  console.log('\n📊 Sample Conflicted Transactions (Top 20 by wallet count):\n');
  for (const pattern of patterns) {
    console.log(`Tx: ${pattern.transaction_hash}`);
    console.log(`   Wallets (${pattern.wallet_count}): ${pattern.wallets.slice(0, 3).join(', ')}${pattern.wallet_count > 3 ? '...' : ''}`);
    console.log(`   Sources: ${[...new Set(pattern.sources)].join(', ')}`);
    console.log(`   Time span: ${pattern.first_seen} to ${pattern.last_seen}`);
    console.log('');
  }

  // 2. Check source distribution for conflicts
  console.log('\n2. Analyzing source field distribution in conflicts...');
  const sourceDistResult = await clickhouse.query({
    query: `
      WITH conflict_trades AS (
        SELECT
          transaction_hash,
          source
        FROM pm_trades_canonical_v3
        WHERE transaction_hash IN (
          SELECT transaction_hash
          FROM pm_trades_canonical_v3
          GROUP BY transaction_hash
          HAVING count() > 1
          LIMIT 100000
        )
      )
      SELECT
        source,
        count() AS trade_count
      FROM conflict_trades
      GROUP BY source
      ORDER BY trade_count DESC
    `,
    format: 'JSONEachRow'
  });
  const sourceDist = await sourceDistResult.json<any>();

  console.log('\n📊 Source Distribution in Conflicts:');
  for (const row of sourceDist) {
    console.log(`   ${row.source}: ${row.trade_count.toLocaleString()}`);
  }

  // 3. Check if wallets are truly different or case sensitivity issues
  console.log('\n\n3. Checking for case sensitivity issues...');
  const caseIssuesResult = await clickhouse.query({
    query: `
      WITH sample_conflicts AS (
        SELECT
          transaction_hash,
          groupArray(wallet_address) AS wallets,
          groupArray(lower(wallet_address)) AS wallets_lower
        FROM pm_trades_canonical_v3
        WHERE transaction_hash IN (
          SELECT transaction_hash
          FROM pm_trades_canonical_v3
          GROUP BY transaction_hash
          HAVING count() > 1
          LIMIT 100
        )
        GROUP BY transaction_hash
      )
      SELECT
        count() AS total_sampled,
        countIf(length(arrayDistinct(wallets)) != length(arrayDistinct(wallets_lower))) AS case_sensitive_conflicts
      FROM sample_conflicts
    `,
    format: 'JSONEachRow'
  });
  const caseIssues = (await caseIssuesResult.json<any>())[0];

  console.log(`Sampled conflicts: ${caseIssues.total_sampled}`);
  console.log(`Case-sensitive duplicates: ${caseIssues.case_sensitive_conflicts}`);

  // 4. Check schema to understand 'source' field
  console.log('\n\n4. Checking pm_trades_canonical_v3 schema...');
  const schemaResult = await clickhouse.query({
    query: `
      SELECT
        name,
        type,
        default_expression
      FROM system.columns
      WHERE database = currentDatabase()
        AND table = 'pm_trades_canonical_v3'
        AND name IN ('source', 'wallet_address', 'transaction_hash', 'trade_id', 'created_at')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  const schema = await schemaResult.json<any>();

  console.log('\n📋 Relevant Schema Fields:');
  for (const col of schema) {
    console.log(`   ${col.name}: ${col.type}${col.default_expression ? ` (default: ${col.default_expression})` : ''}`);
  }

  // 5. Check one specific conflict in detail
  console.log('\n\n5. Deep dive into one specific conflict...');
  const detailResult = await clickhouse.query({
    query: `
      WITH sample_tx AS (
        SELECT transaction_hash
        FROM pm_trades_canonical_v3
        WHERE transaction_hash != ''
        GROUP BY transaction_hash
        HAVING count() > 1
        LIMIT 1
      )
      SELECT
        t.trade_id,
        t.transaction_hash,
        t.wallet_address,
        t.condition_id_norm_v3,
        t.trade_direction,
        t.shares,
        t.usd_value,
        t.created_at,
        t.source
      FROM pm_trades_canonical_v3 t
      WHERE t.transaction_hash IN (SELECT transaction_hash FROM sample_tx)
      ORDER BY t.created_at
    `,
    format: 'JSONEachRow'
  });
  const details = await detailResult.json<any>();

  console.log('\n📋 Detailed Example of One Conflicted Transaction:');
  console.log(`Transaction: ${details[0]?.transaction_hash}\n`);
  for (const trade of details) {
    console.log(`Trade ID: ${trade.trade_id}`);
    console.log(`  Wallet: ${trade.wallet_address}`);
    console.log(`  Direction: ${trade.trade_direction} | Shares: ${trade.shares} | Value: $${trade.usd_value}`);
    console.log(`  CID: ${trade.condition_id_norm_v3?.substring(0, 16)}...`);
    console.log(`  Created: ${trade.created_at} | Source: ${trade.source}`);
    console.log('');
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    patterns: patterns,
    source_distribution: sourceDist,
    case_sensitivity: caseIssues,
    schema: schema,
    example_conflict: details
  };

  writeFileSync(
    '/tmp/conflict-pattern-investigation.json',
    JSON.stringify(report, null, 2)
  );

  console.log('\n✅ Investigation complete! Report saved to /tmp/conflict-pattern-investigation.json');

  return report;
}

investigateConflictPatterns().catch(console.error);
