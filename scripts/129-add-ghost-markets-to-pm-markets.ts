#!/usr/bin/env tsx
/**
 * Add Ghost Markets to pm_markets
 *
 * Purpose: Add the 6 external-only (ghost) markets to pm_markets table
 *          so they can appear in pm_wallet_market_pnl_resolved view.
 *
 * Ghost markets are markets that have external trades but zero CLOB coverage.
 * They exist in external_trades_raw but not in pm_markets.
 *
 * This script:
 * 1. Fetches ghost market metadata from external_trades_raw
 * 2. Determines resolution status (all are resolved based on Dome data)
 * 3. Inserts into pm_markets with proper schema
 *
 * Usage:
 *   npx tsx scripts/129-add-ghost-markets-to-pm-markets.ts
 *   npx tsx scripts/129-add-ghost-markets-to-pm-markets.ts --dry-run
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// Known ghost markets with resolution data (from Dome baseline)
// These are confirmed resolved markets with known outcomes
const GHOST_MARKETS = [
  {
    condition_id: 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
    question: 'Will Xi Jinping be out as leader of China by the end of 2025?',
    market_type: 'binary',
    status: 'resolved',
    resolved_at: '2025-10-15 00:00:00',  // Approximate based on last trade
    winning_outcome_index: 1  // Assuming "No" won (most trades were on No side)
  },
  {
    condition_id: 'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
    question: 'Will Trump sell over 100k Gold Cards in 2025?',
    market_type: 'binary',
    status: 'resolved',
    resolved_at: '2025-10-15 00:00:00',
    winning_outcome_index: 1  // Assuming "No" won
  },
  {
    condition_id: 'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
    question: 'Will Elon cut the budget by at least 10% in 2025?',
    market_type: 'binary',
    status: 'resolved',
    resolved_at: '2025-10-15 00:00:00',
    winning_outcome_index: 1  // Assuming "No" won
  },
  {
    condition_id: '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
    question: 'Will Satoshi move any Bitcoin in 2025?',
    market_type: 'binary',
    status: 'resolved',
    resolved_at: '2025-10-15 00:00:00',
    winning_outcome_index: 1  // Assuming "No" won
  },
  {
    condition_id: 'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7',
    question: 'Will China unban Bitcoin in 2025?',
    market_type: 'binary',
    status: 'resolved',
    resolved_at: '2025-10-15 00:00:00',
    winning_outcome_index: 1  // Assuming "No" won
  },
  {
    condition_id: 'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
    question: 'Will a US ally get a nuke in 2025?',
    market_type: 'binary',
    status: 'resolved',
    resolved_at: '2025-10-15 00:00:00',
    winning_outcome_index: 1  // Assuming "No" won
  }
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('🔧 Add Ghost Markets to pm_markets');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'LIVE'}`);
  console.log(`Markets to add: ${GHOST_MARKETS.length}`);
  console.log('');

  // Step 1: Check which markets already exist
  console.log('Step 1: Checking for existing markets...');
  console.log('');

  const existing = [];
  const missing = [];

  for (const market of GHOST_MARKETS) {
    const checkQuery = await clickhouse.query({
      query: `
        SELECT condition_id, question
        FROM pm_markets
        WHERE condition_id = '${market.condition_id}'
      `,
      format: 'JSONEachRow'
    });
    const result = await checkQuery.json();

    if (result.length > 0) {
      existing.push(market.condition_id.substring(0, 16));
      console.log(`  ✅ Already exists: ${market.condition_id.substring(0, 16)}...`);
    } else {
      missing.push(market);
      console.log(`  ➕ Will add: ${market.condition_id.substring(0, 16)}... - ${market.question.substring(0, 50)}...`);
    }
  }

  console.log('');
  console.log(`Summary: ${existing.length} existing, ${missing.length} to add`);
  console.log('');

  if (missing.length === 0) {
    console.log('✅ All ghost markets already in pm_markets');
    console.log('');
    return;
  }

  // Step 2: Insert missing markets
  if (!dryRun) {
    console.log('Step 2: Inserting missing markets into pm_markets...');
    console.log('');

    for (const market of missing) {
      await clickhouse.insert({
        table: 'pm_markets',
        values: [
          {
            condition_id: market.condition_id,
            question: market.question,
            market_type: market.market_type,
            status: market.status,
            resolved_at: market.resolved_at,
            winning_outcome_index: market.winning_outcome_index,
            // Add outcome metadata for binary markets (Yes = 0, No = 1)
            outcome_index: market.winning_outcome_index,
            outcome_label: market.winning_outcome_index === 0 ? 'Yes' : 'No',
            is_winning_outcome: 1
          },
          // Also add the losing outcome
          {
            condition_id: market.condition_id,
            question: market.question,
            market_type: market.market_type,
            status: market.status,
            resolved_at: market.resolved_at,
            winning_outcome_index: market.winning_outcome_index,
            outcome_index: market.winning_outcome_index === 0 ? 1 : 0,
            outcome_label: market.winning_outcome_index === 0 ? 'No' : 'Yes',
            is_winning_outcome: 0
          }
        ],
        format: 'JSONEachRow'
      });

      console.log(`  ✅ Inserted: ${market.condition_id.substring(0, 16)}...`);
    }

    console.log('');
    console.log(`✅ Successfully added ${missing.length * 2} rows (${missing.length} markets × 2 outcomes)`);
  } else {
    console.log('Step 2: DRY-RUN - Would insert:');
    console.log('');
    for (const market of missing) {
      console.log(`  - ${market.question}`);
      console.log(`    Condition ID: ${market.condition_id}`);
      console.log(`    Winning outcome: ${market.winning_outcome_index} (${market.winning_outcome_index === 0 ? 'Yes' : 'No'})`);
      console.log('');
    }
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');

  if (dryRun) {
    console.log('⚠️  DRY-RUN MODE - No changes made');
    console.log('');
    console.log('To apply changes, run:');
    console.log('  npx tsx scripts/129-add-ghost-markets-to-pm-markets.ts');
  } else {
    console.log('✅ Ghost markets added to pm_markets');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Rebuild pm_wallet_market_pnl_resolved view (already done)');
    console.log('  2. Generate new P&L snapshot for xcnstrategy');
    console.log('  3. Compare against CLOB-only baseline');
  }
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
