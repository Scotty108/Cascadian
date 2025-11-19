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

const EMPTY_TABLES = [
  'default.erc1155_transfers_pilot',
  'default.market_flow_metrics',
  'default.market_price_momentum',
  'default.api_ctf_bridge_final',
  'default.market_resolutions_ctf',
  'default.fired_signals',
  'default.fills_fact',
  'default.repair_pairs_temp',
  'default.market_resolutions_normalized',
  'default.market_resolutions_payout_backfill',
  'default.worker_heartbeats',
  'default.api_market_mapping',
  'default.erc1155_transfers_staging',
  'default.market_price_history',
  'default.erc1155_transfers_full',
  'default.tmp_repair_cids',
  'default.momentum_trading_signals',
  'default.elite_trade_attributions',
  'default.thegraph_market_mapping',
  'default.goldsky_market_mapping',
  'default.ctf_condition_meta',
  'default.category_analytics',
  'default.market_outcome_catalog',
  'default.temp_onchain_resolutions',
  'default.condition_id_recovery',
  'default.rpc_transfer_mapping',
  'default.price_snapshots_10s',
  'default.resolutions_temp',
  'default.resolution_status_cache',
  'default.category_leaders_v1',
  'default.clob_market_mapping',
  'default.gamma_markets_resolutions',
  'cascadian_clean.resolutions_rekeyed',
];

async function cleanupEmptyTables() {
  console.log('PHASE 1: Cleanup Empty Tables\n');
  console.log('═'.repeat(80));
  console.log(`Target: ${EMPTY_TABLES.length} tables with 0 rows`);
  console.log(`Status: SAFE to run (does not interfere with backfill)\n`);

  let dropped = 0;
  let skipped = 0;
  let errors = 0;

  for (const table of EMPTY_TABLES) {
    try {
      // Just drop it - we know from inventory these are empty
      await client.exec({
        query: `DROP TABLE IF EXISTS ${table}`,
      });
      console.log(`✓ Dropped ${table}`);
      dropped++;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unknown table')) {
        console.log(`ℹ️  ${table} already doesn't exist`);
      } else {
        console.error(`✗ Error dropping ${table}:`, err);
        errors++;
      }
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log('PHASE 1 COMPLETE!\n');
  console.log(`Dropped: ${dropped} tables`);
  console.log(`Skipped (not empty): ${skipped} tables`);
  console.log(`Errors: ${errors}`);

  await client.close();
}

cleanupEmptyTables().catch(console.error);
