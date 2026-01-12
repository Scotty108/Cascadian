/**
 * Create pm_wallets_clean_pool_v2: Wallets where V1 PnL should be accurate
 *
 * NEW CRITERION (from investigation):
 * - For EVERY condition they trade, they only trade ONE outcome (YES or NO, not both)
 * - This avoids the "exchange mints tokens" problem
 *
 * When you trade both outcomes of the same condition, the exchange can mint
 * tokens during matched trades, creating "phantom inventory" that V1 can't track.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Creating pm_wallets_clean_pool_v2 ===\n');
  console.log('Criterion: Only trade ONE outcome per condition (no dual-outcome trading)\n');

  // Step 1: Create the table
  console.log('Step 1: Creating table...');
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallets_clean_pool_v2 (
        wallet String,
        trade_count UInt32,
        volume_usdc Float64,
        maker_ratio Float64,
        conditions_traded UInt32,
        first_trade DateTime,
        last_trade DateTime,
        created_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree()
      ORDER BY wallet
    `
  });
  console.log('  Done.\n');

  // Step 2: Find wallets that trade both outcomes of ANY condition (to exclude)
  console.log('Step 2: Finding wallets that trade both outcomes of same condition...');

  const dualOutcomeCountQuery = `
    SELECT count(DISTINCT wallet) as cnt
    FROM (
      SELECT
        lower(trader_wallet) as wallet,
        m.condition_id
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE m.condition_id != ''
      GROUP BY lower(trader_wallet), m.condition_id
      HAVING countDistinct(m.outcome_index) > 1
    )
  `;

  const dualResult = await clickhouse.query({
    query: dualOutcomeCountQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const dualCount = (await dualResult.json() as any[])[0].cnt;
  console.log(`  ${Number(dualCount).toLocaleString()} wallets trade both outcomes (to exclude).\n`);

  // Step 3: Create temp table for dual-outcome wallets, then anti-join
  console.log('Step 3: Creating temp table for dual-outcome wallets...');

  // Drop and recreate temp table
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS _tmp_dual_outcome_wallets'
  });

  await clickhouse.command({
    query: `
      CREATE TABLE _tmp_dual_outcome_wallets ENGINE = MergeTree() ORDER BY wallet AS
      SELECT DISTINCT wallet
      FROM (
        SELECT
          lower(trader_wallet) as wallet,
          m.condition_id
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE m.condition_id != ''
        GROUP BY lower(trader_wallet), m.condition_id
        HAVING countDistinct(m.outcome_index) > 1
      )
    `,
    clickhouse_settings: { max_execution_time: 600 }
  });

  const tmpCount = await clickhouse.query({
    query: 'SELECT count() as cnt FROM _tmp_dual_outcome_wallets',
    format: 'JSONEachRow'
  });
  console.log(`  Created temp table with ${Number((await tmpCount.json() as any[])[0].cnt).toLocaleString()} wallets.\n`);

  // Step 4: Find clean wallets using LEFT ANTI JOIN pattern
  console.log('Step 4: Finding single-outcome wallets with metrics...');
  console.log('  Running query (may take several minutes)...');
  const startTime = Date.now();

  // Count first using anti-join
  const countQuery = `
    SELECT count(DISTINCT t.wallet) as clean_count
    FROM (
      SELECT lower(trader_wallet) as wallet
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) != ''
    ) t
    LEFT JOIN _tmp_dual_outcome_wallets d ON t.wallet = d.wallet
    WHERE d.wallet IS NULL
  `;

  try {
    const countResult = await clickhouse.query({
      query: countQuery,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 600 }
    });
    const cleanCount = (await countResult.json() as any[])[0].clean_count;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`  Found ${Number(cleanCount).toLocaleString()} single-outcome wallets in ${elapsed}s.\n`);

    // Step 5: Insert with metrics
    console.log('Step 5: Truncating and inserting clean wallets with metrics...');
    await clickhouse.command({ query: 'TRUNCATE TABLE pm_wallets_clean_pool_v2' });

    // Full insert query with anti-join
    const insertQuery = `
      INSERT INTO pm_wallets_clean_pool_v2
      SELECT
        t.wallet,
        count() as trade_count,
        sum(t.usdc_amount) / 1e6 as volume_usdc,
        countIf(t.role = 'maker') / count() as maker_ratio,
        count(DISTINCT m.condition_id) as conditions_traded,
        min(t.trade_time) as first_trade,
        max(t.trade_time) as last_trade
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      LEFT JOIN _tmp_dual_outcome_wallets d ON lower(t.trader_wallet) = d.wallet
      WHERE m.condition_id != ''
        AND d.wallet IS NULL
      GROUP BY lower(t.trader_wallet) as wallet
      HAVING trade_count >= 5
    `;

    await clickhouse.command({
      query: insertQuery,
      clickhouse_settings: { max_execution_time: 900 }
    });

    // Verify
    const verifyResult = await clickhouse.query({
      query: 'SELECT count() as cnt FROM pm_wallets_clean_pool_v2',
      format: 'JSONEachRow'
    });
    const finalCount = (await verifyResult.json() as any[])[0].cnt;
    console.log(`  Inserted ${Number(finalCount).toLocaleString()} wallets.\n`);

    // Step 6: Summary
    console.log('=== Clean Pool V2 Summary ===\n');

    const summaryQuery = `
      SELECT
        count() as total_wallets,
        sum(trade_count) as total_trades,
        round(avg(trade_count), 0) as avg_trades,
        round(sum(volume_usdc), 0) as total_volume,
        round(avg(volume_usdc), 0) as avg_volume,
        round(avg(maker_ratio) * 100, 1) as avg_maker_pct,
        round(avg(conditions_traded), 1) as avg_conditions
      FROM pm_wallets_clean_pool_v2
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
      FROM pm_wallets_clean_pool_v2
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

    // Clean up temp table
    await clickhouse.command({ query: 'DROP TABLE IF EXISTS _tmp_dual_outcome_wallets' });

    const totalWallets = Number(dualCount) + Number(finalCount);
    const pct = (Number(finalCount) / totalWallets * 100).toFixed(1);
    console.log(`\n✅ pm_wallets_clean_pool_v2 ready!`);
    console.log(`   ${pct}% of traders (${Number(finalCount).toLocaleString()}/${totalWallets.toLocaleString()}) only trade one outcome per condition.`);
    console.log(`   These wallets should have high V1 accuracy.`);

  } catch (e: any) {
    console.error('Error:', e.message);
    // Clean up temp table on error
    await clickhouse.command({ query: 'DROP TABLE IF EXISTS _tmp_dual_outcome_wallets' }).catch(() => {});
  }
}

main().catch(console.error);
