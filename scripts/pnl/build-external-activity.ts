/**
 * Step 4: Build pm_wallet_external_activity_60d
 *
 * Detects external activity (splits, merges, redemptions, transfers)
 * and assigns confidence tiers.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('=== Building pm_wallet_external_activity_60d ===\n');

  // Step 1: Check available tables
  console.log('1. Checking external activity sources...');
  const tablesQ = await ch.query({
    query: `
      SELECT name, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE '%ctf%' OR name LIKE '%split%' OR name LIKE '%merge%' OR name LIKE '%redemption%' OR name LIKE '%transfer%')
        AND total_rows > 0
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });
  const tables = (await tablesQ.json()) as any[];
  for (const t of tables.slice(0, 10)) {
    console.log(`   ${t.name}: ${Number(t.total_rows).toLocaleString()} rows`);
  }

  // Step 2: Create the table
  console.log('\n2. Creating table...');
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallet_external_activity_60d (
        wallet String,
        as_of_date Date,

        -- From CTF events
        split_count_60d UInt32,
        merge_count_60d UInt32,

        -- From redemptions
        redemption_count_60d UInt32,

        -- From transfers
        transfer_in_count_60d UInt32,
        transfer_out_count_60d UInt32,

        -- Aggregate
        external_events_60d UInt32,
        external_activity_ratio Float64,

        -- Tier assignment
        confidence_tier String

      ) ENGINE = ReplacingMergeTree(as_of_date)
      ORDER BY wallet
    `,
  });
  console.log('   Done.\n');

  // Step 3: Populate from CTF and other sources
  console.log('3. Computing external activity...');
  const startTime = Date.now();

  // First get trade counts per wallet from our CLV table
  // Then join with CTF events
  // FIX: Use correct event type names (PositionSplit, PositionsMerge) and add 60d filter
  await ch.command({
    query: `
      INSERT INTO pm_wallet_external_activity_60d
      WITH
        now() AS t_now,

        wallet_trades AS (
          SELECT wallet, n_trades_60d
          FROM pm_wallet_clv_60d
        ),

        -- Count 60-day external events with CORRECT event type names
        ctf_activity AS (
          SELECT
            lower(user_address) as wallet,
            countIf(event_type = 'PositionSplit') as splits,
            countIf(event_type = 'PositionsMerge') as merges,
            countIf(event_type = 'PayoutRedemption') as redemptions
          FROM pm_ctf_events
          WHERE event_timestamp >= t_now - INTERVAL 60 DAY
          GROUP BY wallet
        ),

        transfer_activity AS (
          SELECT
            lower(from_address) as wallet,
            count() as transfers_out
          FROM pm_erc1155_transfers
          WHERE from_address != to_address
            AND block_timestamp >= t_now - INTERVAL 60 DAY
          GROUP BY wallet
        ),

        transfer_in AS (
          SELECT
            lower(to_address) as wallet,
            count() as transfers_in
          FROM pm_erc1155_transfers
          WHERE from_address != to_address
            AND block_timestamp >= t_now - INTERVAL 60 DAY
          GROUP BY wallet
        )

      SELECT
        wt.wallet,
        today() as as_of_date,
        coalesce(ca.splits, 0) as split_count_60d,
        coalesce(ca.merges, 0) as merge_count_60d,
        coalesce(ca.redemptions, 0) as redemption_count_60d,
        coalesce(ti.transfers_in, 0) as transfer_in_count_60d,
        coalesce(ta.transfers_out, 0) as transfer_out_count_60d,

        coalesce(ca.splits, 0) + coalesce(ca.merges, 0) + coalesce(ti.transfers_in, 0) + coalesce(ta.transfers_out, 0) as external_events_60d,

        (coalesce(ca.splits, 0) + coalesce(ca.merges, 0) + coalesce(ti.transfers_in, 0) + coalesce(ta.transfers_out, 0)) / wt.n_trades_60d as external_activity_ratio,

        multiIf(
          (coalesce(ca.splits, 0) + coalesce(ca.merges, 0) + coalesce(ti.transfers_in, 0) + coalesce(ta.transfers_out, 0)) / wt.n_trades_60d < 0.05, 'A',
          (coalesce(ca.splits, 0) + coalesce(ca.merges, 0) + coalesce(ti.transfers_in, 0) + coalesce(ta.transfers_out, 0)) / wt.n_trades_60d < 0.20, 'B',
          'C'
        ) as confidence_tier

      FROM wallet_trades wt
      LEFT JOIN ctf_activity ca ON ca.wallet = wt.wallet
      LEFT JOIN transfer_activity ta ON ta.wallet = wt.wallet
      LEFT JOIN transfer_in ti ON ti.wallet = wt.wallet
    `,
    clickhouse_settings: {
      wait_end_of_query: 1,
      max_execution_time: 300,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Done (${elapsed}s)\n`);

  // Step 4: Stats
  console.log('4. Tier distribution:');
  const tierQ = await ch.query({
    query: `
      SELECT
        confidence_tier,
        count() as cnt,
        avg(external_activity_ratio) as avg_ratio
      FROM pm_wallet_external_activity_60d
      GROUP BY confidence_tier
      ORDER BY confidence_tier
    `,
    format: 'JSONEachRow',
  });
  const tiers = (await tierQ.json()) as any[];
  for (const t of tiers) {
    console.log(`   Tier ${t.confidence_tier}: ${Number(t.cnt).toLocaleString()} wallets (avg ratio: ${(t.avg_ratio * 100).toFixed(1)}%)`);
  }

  console.log('\n=== Done! pm_wallet_external_activity_60d is ready. ===');
  await ch.close();
}

main().catch(console.error);
