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
 * PHASE 4: Drop Old Versioned Views and Backups
 * Target: Old v1/v2 versions when v3 exists, backup views from previous operations
 * Risk: LOW - keeping latest versions only
 */

const OLD_VERSION_VIEWS = [
  // Backup views from previous operations (dated Nov 7, 2025)
  'default.outcome_positions_v2_backup_20251107T072157',
  'default.trade_cashflows_v3_backup_20251107T072157',
  'default.winning_index_backup_20251107T072336',

  // Old outcome position views (keep v3)
  'default.pos_by_condition_v1',

  // Old realized P&L views (keep v3 where available)
  'default.realized_inputs_v1',
  'default.realized_pnl_by_condition_v3',
  'default.realized_pnl_by_market',    // v1 - keep v3
  'default.realized_pnl_by_market_v2',  // v2 - keep v3

  // Old wallet P&L views (keep v3 where available)
  'default.wallet_realized_pnl',     // v1 - keep v3
  'default.wallet_realized_pnl_v2',  // v2 - keep v3
  'default.wallet_unrealized_pnl',   // v1 - keep v2
  'default.wallet_pnl_summary',      // v1 - keep v2

  // Old trade views (keep v2)
  'default.resolved_trades_v1',
  'default.trade_flows',  // v1 - keep v2

  // Old helper views
  'default.winning_shares_v1',
  'default.winners_v1',
  'default.flows_by_condition_v1',
];

async function cleanupOldVersions() {
  console.log('PHASE 4: Cleanup Old Versioned Views\\n');
  console.log('═'.repeat(80));
  console.log(`Target: ${OLD_VERSION_VIEWS.length} old versioned views and backups`);
  console.log('Status: SAFE to run (keeping latest versions only)\\n');
  console.log('Note: This cleanup:');
  console.log('  - Drops old v1/v2 versions when v3 exists');
  console.log('  - Drops backup views from Nov 7');
  console.log('  - Keeps latest version of each view family\\n');

  let dropped = 0;
  let skipped = 0;
  let errors = 0;

  for (const view of OLD_VERSION_VIEWS) {
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
  console.log('PHASE 4 COMPLETE!\\n');
  console.log(`Dropped: ${dropped} views`);
  console.log(`Skipped (doesn't exist): ${skipped} views`);
  console.log(`Errors: ${errors}`);
  console.log('\\nNote: Latest versions of these view families are preserved:');
  console.log('  - realized_pnl_by_market_v3 (latest)');
  console.log('  - wallet_realized_pnl_v3 (latest)');
  console.log('  - wallet_unrealized_pnl_v2 (latest)');
  console.log('  - wallet_pnl_summary_v2 (latest)');
  console.log('  - resolved_trades_v2 (latest)');
  console.log('  - trade_flows_v2 (latest)\\n');

  await client.close();
}

cleanupOldVersions().catch(console.error);
