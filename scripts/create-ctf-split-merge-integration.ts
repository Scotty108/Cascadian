/**
 * CTF Split/Merge Integration for PnL Engine V2
 *
 * Creates tables and views to properly account for CTF Split/Merge operations
 * in the PnL calculation.
 *
 * PREREQUISITES:
 * - Deploy goldsky/ctf-events-corrected.yaml to start capturing Split/Merge events
 * - Wait for data to flow into pm_ctf_events
 *
 * WHAT THIS DOES:
 * 1. Creates pm_ctf_split_merge_expanded table - expands Split/Merge to per-outcome records
 * 2. Creates vw_pm_ledger_v3 - unified ledger of trades + CTF operations
 * 3. Creates vw_pm_pnl_with_ctf - complete PnL with CTF adjustments
 *
 * COST BASIS IMPACT:
 * - PositionSplit: User deposits USDC (negative cash), receives shares for EACH outcome
 * - PositionsMerge: User returns shares from ALL outcomes, receives USDC back
 *
 * Terminal: Claude 3
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function createCTFIntegration() {
  console.log('\n🔧 CTF Split/Merge Integration for PnL Engine');
  console.log('='.repeat(80));

  try {
    // Step 0: Check if Split/Merge events exist
    console.log('\n📊 Step 0: Checking for Split/Merge events in pm_ctf_events\n');

    const eventCheckResult = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count() as cnt
        FROM pm_ctf_events
        GROUP BY event_type
        ORDER BY event_type
      `,
      format: 'JSONEachRow',
    });
    const eventCounts = (await eventCheckResult.json()) as Array<{ event_type: string; cnt: string }>;

    console.log('   Event type distribution:');
    eventCounts.forEach((r) => {
      console.log(`   - ${r.event_type}: ${parseInt(r.cnt).toLocaleString()}`);
    });

    const hasSplit = eventCounts.some((e) => e.event_type === 'PositionSplit' && parseInt(e.cnt) > 0);
    const hasMerge = eventCounts.some((e) => e.event_type === 'PositionsMerge' && parseInt(e.cnt) > 0);

    if (!hasSplit && !hasMerge) {
      console.log('\n⚠️  WARNING: No Split/Merge events found in pm_ctf_events!');
      console.log('   Make sure you have deployed the corrected Goldsky pipeline:');
      console.log('   goldsky/ctf-events-corrected.yaml');
      console.log('\n   Continuing to create tables/views for when data arrives...\n');
    }

    // Step 1: Create the expanded Split/Merge table
    console.log('\n📊 Step 1: Creating pm_ctf_split_merge_expanded table\n');
    console.log('   This expands each Split/Merge to per-outcome records...\n');

    const createExpandedTableSQL = `
      CREATE TABLE IF NOT EXISTS pm_ctf_split_merge_expanded (
        wallet String,
        condition_id String,
        outcome_index UInt8,
        event_type String,
        -- For Split: negative cash (deposit), positive shares
        -- For Merge: positive cash (withdraw), negative shares
        cash_delta Float64,
        shares_delta Float64,
        amount_raw UInt256,
        event_timestamp DateTime,
        block_number UInt64,
        tx_hash String,
        id String
      )
      ENGINE = ReplacingMergeTree()
      ORDER BY (wallet, condition_id, outcome_index, id)
    `;

    await clickhouse.command({ query: createExpandedTableSQL });
    console.log('   ✅ pm_ctf_split_merge_expanded table created');

    // Step 2: Populate the expanded table from pm_ctf_events
    console.log('\n📊 Step 2: Populating expanded table from pm_ctf_events\n');

    // First, truncate to rebuild fresh
    await clickhouse.command({ query: 'TRUNCATE TABLE pm_ctf_split_merge_expanded' });

    const populateSQL = `
      INSERT INTO pm_ctf_split_merge_expanded
      SELECT
        lower(user_address) AS wallet,
        lower(
          CASE
            -- condition_id may be 0x prefixed or not - normalize to 64 hex chars
            WHEN startsWith(condition_id, '0x') THEN substring(condition_id, 3)
            ELSE condition_id
          END
        ) AS condition_id,
        -- Binary markets have outcomes 0 and 1
        -- Split/Merge affect BOTH outcomes equally
        arrayJoin([0, 1]) AS outcome_index,
        event_type,
        -- Cash delta: Split = deposit (negative), Merge = withdraw (positive)
        CASE
          WHEN event_type = 'PositionSplit' THEN -(toFloat64(amount_or_payout) / 1000000)
          WHEN event_type = 'PositionsMerge' THEN +(toFloat64(amount_or_payout) / 1000000)
          ELSE 0
        END AS cash_delta,
        -- Shares delta: Split = receive (positive), Merge = return (negative)
        CASE
          WHEN event_type = 'PositionSplit' THEN +(toFloat64(amount_or_payout) / 1000000)
          WHEN event_type = 'PositionsMerge' THEN -(toFloat64(amount_or_payout) / 1000000)
          ELSE 0
        END AS shares_delta,
        toUInt256(amount_or_payout) AS amount_raw,
        event_timestamp,
        block_number,
        tx_hash,
        -- Add outcome_index to id to make unique per outcome
        concat(id, '_out', toString(arrayJoin([0, 1]))) AS id
      FROM pm_ctf_events
      WHERE event_type IN ('PositionSplit', 'PositionsMerge')
        AND event_timestamp > toDateTime('1970-01-01 01:00:00')
    `;

    await clickhouse.command({ query: populateSQL });

    // Verify population
    const expandedCountResult = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count() as cnt,
          round(sum(abs(cash_delta)), 2) as total_volume
        FROM pm_ctf_split_merge_expanded
        GROUP BY event_type
      `,
      format: 'JSONEachRow',
    });
    const expandedCounts = (await expandedCountResult.json()) as Array<{
      event_type: string;
      cnt: string;
      total_volume: string;
    }>;

    console.log('\n   Expanded table populated:');
    expandedCounts.forEach((r) => {
      console.log(`   - ${r.event_type}: ${parseInt(r.cnt).toLocaleString()} rows, $${r.total_volume} volume`);
    });

    // Step 3: Create unified ledger view (trades + CTF)
    console.log('\n📊 Step 3: Creating vw_pm_ledger_v3 (unified ledger)\n');

    const createLedgerV3SQL = `
      CREATE OR REPLACE VIEW vw_pm_ledger_v3 AS
      -- CLOB trades from pm_trader_events_v2
      SELECT
        t.trader_wallet AS wallet,
        lower(
          CASE
            WHEN startsWith(m.condition_id, '0x') THEN substring(m.condition_id, 3)
            ELSE m.condition_id
          END
        ) AS condition_id,
        m.outcome_index,
        -- Buy = cash out, shares in; Sell = cash in, shares out
        CASE WHEN lower(t.side) = 'buy'
             THEN -(t.usdc_amount / 1000000)
             ELSE +(t.usdc_amount / 1000000) END AS cash_delta,
        CASE WHEN lower(t.side) = 'buy'
             THEN +(t.token_amount / 1000000)
             ELSE -(t.token_amount / 1000000) END AS shares_delta,
        t.trade_time AS event_timestamp,
        toUInt64(t.block_number) AS block_number,
        t.transaction_hash AS tx_hash,
        'CLOB' AS source
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec

      UNION ALL

      -- CTF Split/Merge events
      SELECT
        wallet,
        condition_id,
        outcome_index,
        cash_delta,
        shares_delta,
        event_timestamp,
        block_number,
        tx_hash,
        CASE
          WHEN event_type = 'PositionSplit' THEN 'CTF_SPLIT'
          WHEN event_type = 'PositionsMerge' THEN 'CTF_MERGE'
          ELSE event_type
        END AS source
      FROM pm_ctf_split_merge_expanded
    `;

    await clickhouse.command({ query: createLedgerV3SQL });
    console.log('   ✅ vw_pm_ledger_v3 created');

    // Verify ledger V3
    const ledgerV3Result = await clickhouse.query({
      query: `
        SELECT
          source,
          count() as row_count,
          round(sum(abs(cash_delta)), 2) as total_volume
        FROM vw_pm_ledger_v3
        GROUP BY source
        ORDER BY source
      `,
      format: 'JSONEachRow',
    });
    const ledgerV3Stats = (await ledgerV3Result.json()) as Array<{
      source: string;
      row_count: string;
      total_volume: string;
    }>;

    console.log('\n   Ledger V3 sources:');
    console.log('   Source         | Rows            | Volume');
    console.log('   ' + '-'.repeat(50));
    ledgerV3Stats.forEach((r) => {
      const source = r.source.padEnd(14);
      const rows = parseInt(r.row_count).toLocaleString().padStart(15);
      const volume = ('$' + parseFloat(r.total_volume).toLocaleString()).padStart(15);
      console.log(`   ${source} | ${rows} | ${volume}`);
    });

    // Step 4: Create complete PnL view with CTF
    console.log('\n📊 Step 4: Creating vw_pm_pnl_with_ctf (complete PnL)\n');

    const createPnLWithCTFSQL = `
      CREATE OR REPLACE VIEW vw_pm_pnl_with_ctf AS
      WITH aggregated AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          sum(cash_delta) AS total_cash,
          sum(shares_delta) AS final_shares,
          count() AS event_count,
          min(event_timestamp) AS first_event,
          max(event_timestamp) AS last_event,
          -- Track source breakdown
          countIf(source = 'CLOB') AS clob_events,
          countIf(source = 'CTF_SPLIT') AS split_events,
          countIf(source = 'CTF_MERGE') AS merge_events
        FROM vw_pm_ledger_v3
        GROUP BY wallet, condition_id, outcome_index
      ),
      with_resolution AS (
        SELECT
          a.*,
          CASE
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 0 THEN 0.0
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 1 THEN 0.0
            ELSE NULL
          END AS resolved_price,
          r.condition_id IS NOT NULL AS is_resolved,
          r.resolved_at
        FROM aggregated a
        LEFT JOIN pm_condition_resolutions r ON a.condition_id = r.condition_id
      )
      SELECT
        wallet,
        condition_id,
        outcome_index,
        total_cash,
        final_shares,
        event_count,
        first_event,
        last_event,
        clob_events,
        split_events,
        merge_events,
        resolved_price,
        is_resolved,
        resolved_at,
        -- Resolution payout
        CASE
          WHEN is_resolved THEN final_shares * resolved_price
          ELSE NULL
        END AS resolution_cash,
        -- Realized PnL (only for resolved)
        CASE
          WHEN is_resolved THEN total_cash + (final_shares * resolved_price)
          ELSE NULL
        END AS realized_pnl
      FROM with_resolution
    `;

    await clickhouse.command({ query: createPnLWithCTFSQL });
    console.log('   ✅ vw_pm_pnl_with_ctf created');

    // Step 5: Create wallet summary view with CTF
    console.log('\n📊 Step 5: Creating vw_pm_wallet_summary_with_ctf\n');

    const createWalletSummarySQL = `
      CREATE OR REPLACE VIEW vw_pm_wallet_summary_with_ctf AS
      WITH market_pnl AS (
        SELECT
          wallet,
          condition_id,
          max(is_resolved) AS is_resolved,
          sum(realized_pnl) AS market_pnl,
          sum(event_count) AS total_events,
          sum(clob_events) AS clob_events,
          sum(split_events) AS split_events,
          sum(merge_events) AS merge_events
        FROM vw_pm_pnl_with_ctf
        GROUP BY wallet, condition_id
      )
      SELECT
        wallet,
        -- Market counts
        count(DISTINCT condition_id) AS total_markets,
        countIf(is_resolved = 1) AS resolved_markets,
        -- Event counts
        sum(total_events) AS total_events,
        sum(clob_events) AS clob_events,
        sum(split_events) AS split_events,
        sum(merge_events) AS merge_events,
        -- PnL metrics (resolved only)
        round(sumIf(market_pnl, is_resolved = 1), 2) AS realized_pnl,
        round(avgIf(market_pnl, is_resolved = 1), 2) AS avg_pnl_per_market,
        -- Win/loss
        countIf(is_resolved = 1 AND market_pnl > 0) AS wins,
        countIf(is_resolved = 1 AND market_pnl < 0) AS losses,
        round(100.0 * countIf(is_resolved = 1 AND market_pnl > 0) /
              nullIf(countIf(is_resolved = 1), 0), 2) AS win_rate_pct,
        -- Gains/losses
        round(sumIf(market_pnl, is_resolved = 1 AND market_pnl > 0), 2) AS total_gains,
        round(sumIf(market_pnl, is_resolved = 1 AND market_pnl < 0), 2) AS total_losses,
        -- Profit factor
        round(sumIf(market_pnl, is_resolved = 1 AND market_pnl > 0) /
              nullIf(abs(sumIf(market_pnl, is_resolved = 1 AND market_pnl < 0)), 0), 3) AS profit_factor
      FROM market_pnl
      GROUP BY wallet
    `;

    await clickhouse.command({ query: createWalletSummarySQL });
    console.log('   ✅ vw_pm_wallet_summary_with_ctf created');

    // Step 6: Test on whale wallet
    console.log('\n📊 Step 6: Testing on whale wallet (0x5668...)\n');

    const testWallet = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';

    const testResult = await clickhouse.query({
      query: `
        SELECT
          realized_pnl,
          resolved_markets,
          total_events,
          clob_events,
          split_events,
          merge_events,
          win_rate_pct,
          profit_factor
        FROM vw_pm_wallet_summary_with_ctf
        WHERE wallet = '${testWallet}'
      `,
      format: 'JSONEachRow',
    });
    const testStats = (await testResult.json()) as Array<{
      realized_pnl: number;
      resolved_markets: number;
      total_events: number;
      clob_events: number;
      split_events: number;
      merge_events: number;
      win_rate_pct: number;
      profit_factor: number;
    }>;

    if (testStats.length > 0) {
      const stats = testStats[0];
      console.log(`   Wallet: ${testWallet}`);
      console.log(`   Realized PnL: $${stats.realized_pnl?.toLocaleString() ?? 'N/A'}`);
      console.log(`   Resolved Markets: ${stats.resolved_markets}`);
      console.log(`   Events: ${stats.total_events} total (${stats.clob_events} CLOB, ${stats.split_events} Split, ${stats.merge_events} Merge)`);
      console.log(`   Win Rate: ${stats.win_rate_pct}%`);
      console.log(`   Profit Factor: ${stats.profit_factor}`);
      console.log('\n   Expected: ~$22M (per Polymarket UI)');
    } else {
      console.log('   No data found for test wallet');
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('\n✅ CTF SPLIT/MERGE INTEGRATION COMPLETE\n');
    console.log('Tables/Views created:');
    console.log('  - pm_ctf_split_merge_expanded (table) - Expanded CTF events per outcome');
    console.log('  - vw_pm_ledger_v3 (view) - Unified ledger: CLOB + CTF');
    console.log('  - vw_pm_pnl_with_ctf (view) - Per-position PnL with CTF');
    console.log('  - vw_pm_wallet_summary_with_ctf (view) - Wallet-level metrics');
    console.log('\nNEXT STEPS:');
    console.log('  1. Deploy goldsky/ctf-events-corrected.yaml to capture Split/Merge');
    console.log('  2. Wait for historical backfill to complete');
    console.log('  3. Re-run this script to repopulate pm_ctf_split_merge_expanded');
    console.log('  4. Validate against 20 test wallets');
    console.log('\n' + '='.repeat(80));
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

createCTFIntegration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
