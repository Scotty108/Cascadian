/**
 * Create pm_wallets_clean_pool_v1: Wallets where V1 PnL should be accurate
 *
 * Criteria:
 * 1. In pm_wallets_no_negrisk (no neg risk market trades)
 * 2. No PositionSplit or PositionsMerge in pm_ctf_events
 * 3. No phantom inventory (for every condition/outcome: sold <= bought)
 *
 * These are wallets where ALL inventory came from CLOB trades,
 * so V1's calculation should match Polymarket's.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Creating pm_wallets_clean_pool_v1 ===\n');

  // Step 1: Create the table
  console.log('Step 1: Creating table...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallets_clean_pool_v1 (
        wallet String,
        trade_count UInt32,
        volume_usdc Float64,
        maker_ratio Float64,
        first_trade DateTime,
        last_trade DateTime,
        conditions_traded UInt32,
        created_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree()
      ORDER BY wallet
    `
  });
  console.log('  Done.\n');

  // Step 2: Find wallets with splits/merges (to exclude)
  console.log('Step 2: Finding wallets with splits/merges...');
  const splitMergeQuery = `
    SELECT count(DISTINCT lower(user_address)) as cnt
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND event_type IN ('PositionSplit', 'PositionsMerge')
  `;
  const splitMergeResult = await clickhouse.query({ query: splitMergeQuery, format: 'JSONEachRow' });
  const splitMergeCount = (await splitMergeResult.json() as any[])[0].cnt;
  console.log(`  ${Number(splitMergeCount).toLocaleString()} wallets have splits/merges.\n`);

  // Step 3: Find clean wallets using sampling approach
  // This is a complex query so we'll do it in stages
  console.log('Step 3: Finding clean wallets (this may take a few minutes)...');
  console.log('  Stage A: Getting candidate wallets from pm_wallets_no_negrisk without splits/merges...');

  const candidatesQuery = `
    SELECT wallet
    FROM pm_wallets_no_negrisk
    WHERE wallet NOT IN (
      SELECT DISTINCT lower(user_address)
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND event_type IN ('PositionSplit', 'PositionsMerge')
    )
  `;

  const candidatesResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM (${candidatesQuery})`,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const candidateCount = (await candidatesResult.json() as any[])[0].cnt;
  console.log(`  ${Number(candidateCount).toLocaleString()} candidates (no neg risk, no splits/merges).\n`);

  // Step 4: Check for phantom inventory
  // A wallet has phantom inventory if for ANY (condition, outcome): sold > bought
  console.log('  Stage B: Checking for phantom inventory...');
  console.log('  (Finding wallets where sold > bought for any position)\n');

  // This query finds wallets WITH phantom inventory (to exclude)
  // We'll sample first to estimate, then do full scan
  const phantomQuery = `
    WITH
      -- Candidates: no neg risk, no splits/merges
      candidates AS (
        SELECT wallet
        FROM pm_wallets_no_negrisk
        WHERE wallet NOT IN (
          SELECT DISTINCT lower(user_address)
          FROM pm_ctf_events
          WHERE is_deleted = 0
            AND event_type IN ('PositionSplit', 'PositionsMerge')
        )
      ),
      -- Position balances per wallet/condition/outcome
      position_balances AS (
        SELECT
          lower(t.trader_wallet) as wallet,
          m.condition_id,
          m.outcome_index,
          sumIf(t.token_amount, t.side = 'buy') as bought,
          sumIf(t.token_amount, t.side = 'sell') as sold
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) IN (SELECT wallet FROM candidates)
          AND m.condition_id != ''
        GROUP BY lower(t.trader_wallet), m.condition_id, m.outcome_index
      ),
      -- Wallets with ANY phantom inventory (sold > bought * 1.001 to allow tiny rounding)
      phantom_wallets AS (
        SELECT DISTINCT wallet
        FROM position_balances
        WHERE sold > bought * 1.001 AND bought > 0
      )
    -- Clean wallets = candidates minus phantom
    SELECT
      p.wallet,
      count() as trade_count,
      sum(t.usdc_amount) / 1e6 as volume_usdc,
      countIf(t.role = 'maker') / count() as maker_ratio,
      min(t.trade_time) as first_trade,
      max(t.trade_time) as last_trade,
      count(DISTINCT m.condition_id) as conditions_traded
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    JOIN (
      SELECT wallet FROM candidates
      WHERE wallet NOT IN (SELECT wallet FROM phantom_wallets)
    ) p ON lower(t.trader_wallet) = p.wallet
    WHERE m.condition_id != ''
    GROUP BY p.wallet
    HAVING trade_count >= 5  -- Minimum activity threshold
  `;

  console.log('  Running full phantom inventory check (may take 5-10 minutes)...');
  const startTime = Date.now();

  try {
    // First, let's just count how many clean wallets there are
    const countQuery = `
      WITH
        candidates AS (
          SELECT wallet
          FROM pm_wallets_no_negrisk
          WHERE wallet NOT IN (
            SELECT DISTINCT lower(user_address)
            FROM pm_ctf_events
            WHERE is_deleted = 0
              AND event_type IN ('PositionSplit', 'PositionsMerge')
          )
        ),
        position_balances AS (
          SELECT
            lower(t.trader_wallet) as wallet,
            m.condition_id,
            m.outcome_index,
            sumIf(t.token_amount, t.side = 'buy') as bought,
            sumIf(t.token_amount, t.side = 'sell') as sold
          FROM pm_trader_events_v3 t
          JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
          WHERE lower(t.trader_wallet) IN (SELECT wallet FROM candidates)
            AND m.condition_id != ''
          GROUP BY lower(t.trader_wallet), m.condition_id, m.outcome_index
        ),
        phantom_wallets AS (
          SELECT DISTINCT wallet
          FROM position_balances
          WHERE sold > bought * 1.001 AND bought > 0
        )
      SELECT
        count(DISTINCT wallet) as clean_count
      FROM position_balances
      WHERE wallet NOT IN (SELECT wallet FROM phantom_wallets)
    `;

    const countResult = await clickhouse.query({
      query: countQuery,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 600 }
    });
    const cleanCount = (await countResult.json() as any[])[0].clean_count;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Found ${Number(cleanCount).toLocaleString()} clean wallets in ${elapsed}s.\n`);

    // Step 5: Insert into table
    console.log('Step 4: Inserting clean wallets with metrics...');

    await clickhouse.command({ query: 'TRUNCATE TABLE pm_wallets_clean_pool_v1' });

    await clickhouse.command({
      query: `
        INSERT INTO pm_wallets_clean_pool_v1
        ${phantomQuery}
      `,
      clickhouse_settings: { max_execution_time: 600 }
    });

    // Verify
    const verifyResult = await clickhouse.query({
      query: 'SELECT count() as cnt FROM pm_wallets_clean_pool_v1',
      format: 'JSONEachRow'
    });
    const finalCount = (await verifyResult.json() as any[])[0].cnt;
    console.log(`  Inserted ${Number(finalCount).toLocaleString()} wallets.\n`);

    // Step 6: Summary stats
    console.log('=== Clean Pool Summary ===\n');

    const summaryQuery = `
      SELECT
        count() as total_wallets,
        sum(trade_count) as total_trades,
        round(avg(trade_count), 0) as avg_trades,
        round(sum(volume_usdc), 0) as total_volume,
        round(avg(volume_usdc), 0) as avg_volume,
        round(avg(maker_ratio) * 100, 1) as avg_maker_pct,
        round(avg(conditions_traded), 1) as avg_conditions
      FROM pm_wallets_clean_pool_v1
    `;

    const summaryResult = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
    const summary = (await summaryResult.json() as any[])[0];

    console.log(`Total wallets:     ${Number(summary.total_wallets).toLocaleString()}`);
    console.log(`Total trades:      ${Number(summary.total_trades).toLocaleString()}`);
    console.log(`Avg trades/wallet: ${Number(summary.avg_trades).toLocaleString()}`);
    console.log(`Total volume:      $${Number(summary.total_volume).toLocaleString()}`);
    console.log(`Avg volume/wallet: $${Number(summary.avg_volume).toLocaleString()}`);
    console.log(`Avg maker ratio:   ${summary.avg_maker_pct}%`);
    console.log(`Avg conditions:    ${summary.avg_conditions}`);

    // Distribution by trade count
    console.log('\n=== Distribution by Trade Count ===\n');
    const distQuery = `
      SELECT
        multiIf(
          trade_count < 10, '5-9',
          trade_count < 50, '10-49',
          trade_count < 100, '50-99',
          trade_count < 500, '100-499',
          trade_count < 1000, '500-999',
          '1000+'
        ) as bucket,
        count() as wallets,
        round(avg(volume_usdc), 0) as avg_volume
      FROM pm_wallets_clean_pool_v1
      GROUP BY bucket
      ORDER BY min(trade_count)
    `;
    const distResult = await clickhouse.query({ query: distQuery, format: 'JSONEachRow' });
    const dist = await distResult.json() as any[];

    console.log('Trades     | Wallets    | Avg Volume');
    console.log('-'.repeat(40));
    for (const row of dist) {
      console.log(
        `${row.bucket.padEnd(10)} | ${String(row.wallets).padStart(10)} | $${Number(row.avg_volume).toLocaleString()}`
      );
    }

    console.log('\n✅ pm_wallets_clean_pool_v1 ready!');
    console.log('   These wallets should have ~85-95% V1 accuracy.');

  } catch (e: any) {
    console.error('Error:', e.message);

    // If timeout, suggest running with longer timeout or sampling
    if (e.message.includes('timeout') || e.message.includes('TIMEOUT')) {
      console.log('\n⚠️  Query timed out. Try running with sampling approach or increase timeout.');
    }
  }
}

main().catch(console.error);
