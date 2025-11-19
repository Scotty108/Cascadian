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

/**
 * PHASE 5: Drop Obsolete/Duplicate Views
 * Target: Views superseded by better implementations or no longer needed
 * Risk: MEDIUM - verify these aren't referenced before running
 *
 * IMPORTANT: Review before running!
 * - Check if any frontend code references these views
 * - Verify API routes don't use these views
 * - Confirm replacement views exist and work
 */

const OBSOLETE_VIEWS = [
  // Old mapping approaches (superseded by condition_market_map table)
  'default.condition_id_bridge',
  'default.canonical_condition',
  'default.token_dim',

  // Old trade views (superseded by vw_trades_canonical)
  'default.trades_dedup_view',
  'default.trades_working',
  'default.trades_unique',

  // Obsolete market tracking (no longer needed)
  'default.market_last_price',
  'default.market_last_trade',
  'default.markets',

  // Old coverage/resolution tracking (superseded by new approach)
  'default.coverage_by_source',
  'default.resolution_candidates_norm',
  'default.resolution_candidates_ranked',
  'default.resolution_rollup',
  'default.resolution_conflicts',

  // Old volume ranking (superseded)
  'default.missing_by_vol',
  'default.missing_ranked',
  'default.vol_rank_dedup',

  // Old missing data tracking (superseded)
  'default.missing_condition_ids',
  'default.unresolved_markets',

  // Debug/test views (no longer needed)
  'default.test_rpnl_debug',

  // Old P&L approaches (superseded by newer calculations)
  'default.realized_pnl_by_resolution',  # Superseded by realized_pnl_by_market_v3
  'default.pnl_final_by_condition',      # Superseded by newer P&L views

  // Old wallet trade tracking (superseded)
  'default.wallet_trade_cashflows_by_outcome',
];

async function cleanupObsoleteViews() {
  console.log('PHASE 5: Cleanup Obsolete/Duplicate Views\\n');
  console.log('═'.repeat(80));
  console.log(`Target: ${OBSOLETE_VIEWS.length} obsolete views`);
  console.log('Status: MEDIUM RISK - verify not referenced in production\\n');

  console.log('⚠️  WARNING: Before proceeding, verify:');
  console.log('  1. No frontend code references these views');
  console.log('  2. No API routes use these views');
  console.log('  3. Replacement views exist and work correctly\\n');

  console.log('Views to be dropped:');
  console.log('  - Old mapping approaches (superseded by tables)');
  console.log('  - Old trade views (superseded by vw_trades_canonical)');
  console.log('  - Obsolete tracking/ranking views');
  console.log('  - Debug/test views\\n');

  let dropped = 0;
  let skipped = 0;
  let errors = 0;

  for (const view of OBSOLETE_VIEWS) {
    try {
      await client.exec({
        query: `DROP VIEW IF EXISTS ${view}`,
      });
      console.log(`✓ Dropped ${view}`);
      dropped++;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unknown table')) {
        console.log(`ℹ️  ${view} already doesn't exist`);
        skipped++;
      } else {
        console.error(`✗ Error dropping ${view}:`, err);
        errors++;
      }
    }
  }

  console.log('\\n' + '═'.repeat(80));
  console.log('PHASE 5 COMPLETE!\\n');
  console.log(`Dropped: ${dropped} views`);
  console.log(`Skipped (doesn't exist): ${skipped} views`);
  console.log(`Errors: ${errors}`);
  console.log('\\nReplacement views in production:');
  console.log('  - vw_trades_canonical (main trades view)');
  console.log('  - condition_market_map (table, not view)');
  console.log('  - realized_pnl_by_market_v3 (latest P&L)');
  console.log('  - wallet_pnl_summary_v2 (wallet P&L)\\n');

  await client.close();
}

cleanupObsoleteViews().catch(console.error);
