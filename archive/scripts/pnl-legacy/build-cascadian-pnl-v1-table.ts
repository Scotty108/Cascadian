/**
 * Build Cascadian PnL V1 Materialized Table
 *
 * Creates a materialized table (not view) for fast wallet-level queries.
 * Uses proper deduplication and the Cascadian PnL V1 formula.
 *
 * Terminal: Claude 1
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,  // 10 minutes for full table build
});

async function buildTable() {
  console.log('=== BUILDING CASCADIAN PNL V1 TABLE ===');
  console.log('');

  // Step 1: Create the outcome-level PnL table
  console.log('Step 1: Creating pm_cascadian_pnl_v1 table...');

  // First drop if exists
  await client.command({
    query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v1_new'
  });

  // Create new table with the full calculation
  const createTable = `
    CREATE TABLE pm_cascadian_pnl_v1_new
    ENGINE = MergeTree()
    ORDER BY (trader_wallet, condition_id, outcome_index)
    AS
    WITH
      -- Step 1: Deduplicate trades by event_id
      deduped_trades AS (
        SELECT
          event_id,
          any(trader_wallet) AS trader_wallet,
          any(side) AS side,
          any(usdc_amount) AS usdc_amount,
          any(token_amount) AS token_amount,
          any(token_id) AS token_id,
          any(trade_time) AS trade_time
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
        GROUP BY event_id
      ),

      -- Step 2: Map tokens to conditions
      with_condition AS (
        SELECT
          t.event_id,
          t.trader_wallet,
          t.side,
          t.usdc_amount,
          t.token_amount,
          t.trade_time,
          m.condition_id,
          m.outcome_index
        FROM deduped_trades t
        INNER JOIN pm_token_to_condition_map_v3 m
          ON toString(t.token_id) = toString(m.token_id_dec)
      ),

      -- Step 3: Aggregate per wallet/condition/outcome
      aggregated AS (
        SELECT
          trader_wallet,
          condition_id,
          outcome_index,
          -- Trade cash flow: buy = outflow (-), sell = inflow (+)
          SUM(CASE WHEN side = 'buy' THEN -usdc_amount ELSE usdc_amount END) / 1000000.0 AS trade_cash_flow,
          -- Final shares: buy = increase (+), sell = decrease (-)
          SUM(CASE WHEN side = 'buy' THEN token_amount ELSE -token_amount END) / 1000000.0 AS final_shares,
          -- Trade metadata
          COUNT(*) AS trade_count,
          MIN(trade_time) AS first_trade,
          MAX(trade_time) AS last_trade
        FROM with_condition
        GROUP BY trader_wallet, condition_id, outcome_index
      ),

      -- Step 4: Join with resolutions
      with_resolution AS (
        SELECT
          a.trader_wallet,
          a.condition_id,
          a.outcome_index,
          a.trade_cash_flow,
          a.final_shares,
          a.trade_count,
          a.first_trade,
          a.last_trade,
          r.payout_numerators,
          r.resolved_at,
          -- Binary resolution price
          CASE
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 0 THEN 0.0
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 1 THEN 0.0
            ELSE NULL
          END AS resolution_price
        FROM aggregated a
        LEFT JOIN pm_condition_resolutions r
          ON lower(a.condition_id) = lower(r.condition_id)
          AND r.is_deleted = 0
      )

    SELECT
      trader_wallet,
      condition_id,
      outcome_index,
      trade_cash_flow,
      final_shares,
      resolution_price,
      -- Cascadian PnL = Trade Cash Flow + (Final Shares × Resolution Price)
      trade_cash_flow + (final_shares * coalesce(resolution_price, 0)) AS realized_pnl,
      -- Metadata
      trade_count,
      first_trade,
      last_trade,
      resolved_at,
      resolution_price IS NOT NULL AS is_resolved
    FROM with_resolution
  `;

  console.log('   Building table (this may take 2-5 minutes)...');
  const startTime = Date.now();
  await client.command({ query: createTable });
  const buildTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Table built in ${buildTime}s`);

  // Step 2: Count rows
  const countResult = await client.query({
    query: 'SELECT COUNT(*) as cnt FROM pm_cascadian_pnl_v1_new',
    format: 'JSONEachRow'
  });
  const count = (await countResult.json() as any[])[0]?.cnt;
  console.log(`   Rows: ${count?.toLocaleString()}`);

  // Step 3: Atomic swap
  console.log('');
  console.log('Step 2: Atomic table swap...');
  await client.command({
    query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v1_old'
  });

  // Check if old table exists
  const existsResult = await client.query({
    query: "SELECT count() as cnt FROM system.tables WHERE name = 'pm_cascadian_pnl_v1' AND database = 'default'",
    format: 'JSONEachRow'
  });
  const exists = (await existsResult.json() as any[])[0]?.cnt > 0;

  if (exists) {
    await client.command({
      query: 'RENAME TABLE pm_cascadian_pnl_v1 TO pm_cascadian_pnl_v1_old'
    });
  }
  await client.command({
    query: 'RENAME TABLE pm_cascadian_pnl_v1_new TO pm_cascadian_pnl_v1'
  });
  console.log('   Swap complete');

  // Cleanup old table
  await client.command({
    query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v1_old'
  });

  // Step 4: Create wallet summary view (fast - reads from materialized table)
  console.log('');
  console.log('Step 3: Creating wallet summary view...');

  const walletView = `
    CREATE OR REPLACE VIEW vw_pm_wallet_summary_v1 AS
    SELECT
      trader_wallet,
      -- PnL metrics (resolved markets only)
      SUM(CASE WHEN is_resolved THEN realized_pnl ELSE 0 END) AS total_realized_pnl,
      SUM(CASE WHEN is_resolved AND realized_pnl > 0 THEN realized_pnl ELSE 0 END) AS gross_profit,
      SUM(CASE WHEN is_resolved AND realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END) AS gross_loss,

      -- Market counts
      COUNT(DISTINCT CASE WHEN is_resolved THEN condition_id END) AS resolved_markets,
      COUNT(DISTINCT CASE WHEN is_resolved AND realized_pnl > 0 THEN condition_id END) AS winning_markets,
      COUNT(DISTINCT CASE WHEN is_resolved AND realized_pnl < 0 THEN condition_id END) AS losing_markets,

      -- Trade counts
      SUM(trade_count) AS total_trades,

      -- Derived metrics
      CASE
        WHEN COUNT(DISTINCT CASE WHEN is_resolved THEN condition_id END) > 0
        THEN COUNT(DISTINCT CASE WHEN is_resolved AND realized_pnl > 0 THEN condition_id END) * 1.0
             / COUNT(DISTINCT CASE WHEN is_resolved THEN condition_id END)
        ELSE 0
      END AS win_rate,

      CASE
        WHEN SUM(CASE WHEN is_resolved AND realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END) > 0
        THEN SUM(CASE WHEN is_resolved AND realized_pnl > 0 THEN realized_pnl ELSE 0 END)
             / SUM(CASE WHEN is_resolved AND realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END)
        ELSE NULL
      END AS profit_factor,

      -- Time range
      MIN(first_trade) AS first_trade,
      MAX(last_trade) AS last_trade

    FROM pm_cascadian_pnl_v1
    GROUP BY trader_wallet
  `;

  await client.command({ query: walletView });
  console.log('   Created vw_pm_wallet_summary_v1');

  // Step 5: Create market summary view (for zero-sum validation)
  console.log('');
  console.log('Step 4: Creating market summary view...');

  const marketView = `
    CREATE OR REPLACE VIEW vw_pm_market_summary_v1 AS
    SELECT
      condition_id,
      is_resolved,
      COUNT(DISTINCT trader_wallet) AS participant_count,
      SUM(realized_pnl) AS market_pnl_sum,
      SUM(trade_cash_flow) AS total_trade_volume,
      SUM(final_shares) AS net_shares,
      MIN(first_trade) AS first_trade,
      MAX(last_trade) AS last_trade,
      MAX(resolved_at) AS resolved_at
    FROM pm_cascadian_pnl_v1
    GROUP BY condition_id, is_resolved
  `;

  await client.command({ query: marketView });
  console.log('   Created vw_pm_market_summary_v1');

  console.log('');
  console.log('=== BUILD COMPLETE ===');
}

async function validate() {
  console.log('');
  console.log('=== VALIDATION ===');
  console.log('');

  // Test 1: W2 PnL
  console.log('1. W2 PnL (should be ~$4,405-4,418)...');
  const w2Result = await client.query({
    query: `
      SELECT
        total_realized_pnl,
        resolved_markets,
        win_rate,
        profit_factor
      FROM vw_pm_wallet_summary_v1
      WHERE trader_wallet = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838'
    `,
    format: 'JSONEachRow'
  });
  const w2 = (await w2Result.json() as any[])[0];
  console.log('   PnL: $' + (w2?.total_realized_pnl?.toFixed(2) || 'N/A'));
  console.log('   Markets: ' + w2?.resolved_markets);
  console.log('   Win Rate: ' + ((w2?.win_rate || 0) * 100).toFixed(1) + '%');
  console.log('   Profit Factor: ' + (w2?.profit_factor?.toFixed(2) || 'N/A'));

  // Test 2: Zero-sum check
  console.log('');
  console.log('2. Zero-sum validation...');
  const zsResult = await client.query({
    query: `
      SELECT
        COUNT(*) as total_markets,
        SUM(CASE WHEN ABS(market_pnl_sum) > 1.0 THEN 1 ELSE 0 END) as non_zero_markets,
        AVG(ABS(market_pnl_sum)) as avg_abs_deviation,
        MAX(ABS(market_pnl_sum)) as max_abs_deviation
      FROM vw_pm_market_summary_v1
      WHERE is_resolved = 1
    `,
    format: 'JSONEachRow'
  });
  const zs = (await zsResult.json() as any[])[0];
  console.log('   Resolved markets: ' + zs?.total_markets?.toLocaleString());
  console.log('   Non-zero sum (>$1): ' + zs?.non_zero_markets);
  console.log('   Avg |deviation|: $' + zs?.avg_abs_deviation?.toFixed(6));
  console.log('   Max |deviation|: $' + zs?.max_abs_deviation?.toFixed(2));

  // Test 3: Sample leaderboard
  console.log('');
  console.log('3. Sample leaderboard (top 5)...');
  const lbResult = await client.query({
    query: `
      SELECT
        trader_wallet,
        total_realized_pnl,
        resolved_markets,
        win_rate
      FROM vw_pm_wallet_summary_v1
      WHERE resolved_markets >= 5
      ORDER BY total_realized_pnl DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const top5 = await lbResult.json() as any[];
  for (const row of top5) {
    console.log(
      '   ' + row.trader_wallet.slice(0, 10) + '... | ' +
      '$' + row.total_realized_pnl.toFixed(2).padStart(12) + ' | ' +
      row.resolved_markets + ' mkts | ' +
      (row.win_rate * 100).toFixed(1) + '%'
    );
  }

  // Test 4: Query performance
  console.log('');
  console.log('4. Query performance test...');
  const start = Date.now();
  await client.query({
    query: `
      SELECT * FROM pm_cascadian_pnl_v1
      WHERE trader_wallet = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838'
    `,
    format: 'JSONEachRow'
  });
  console.log('   Single wallet query: ' + (Date.now() - start) + 'ms');

  console.log('');
  console.log('=== VALIDATION COMPLETE ===');
}

async function main() {
  try {
    await buildTable();
    await validate();
  } finally {
    await client.close();
  }
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
