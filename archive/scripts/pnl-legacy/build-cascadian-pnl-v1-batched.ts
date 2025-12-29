/**
 * Build Cascadian PnL V1 Table - Batched Approach
 *
 * Builds the table in batches to avoid memory limits.
 * Uses INSERT SELECT with wallet ranges.
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
  request_timeout: 600000,
});

// Progress tracking
let processedBatches = 0;
let totalWallets = 0;

async function createEmptyTable() {
  console.log('Creating empty pm_cascadian_pnl_v1 table...');

  await client.command({
    query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v1_new'
  });

  const createTable = `
    CREATE TABLE pm_cascadian_pnl_v1_new (
      trader_wallet String,
      condition_id String,
      outcome_index UInt8,
      trade_cash_flow Float64,
      final_shares Float64,
      resolution_price Nullable(Float64),
      realized_pnl Float64,
      trade_count UInt32,
      first_trade DateTime64(3),
      last_trade DateTime64(3),
      resolved_at Nullable(DateTime64(3)),
      is_resolved UInt8
    )
    ENGINE = MergeTree()
    ORDER BY (trader_wallet, condition_id, outcome_index)
  `;

  await client.command({ query: createTable });
  console.log('   Empty table created');
}

async function getWalletBatches(batchSize: number = 5000): Promise<string[][]> {
  console.log('Getting wallet list...');

  const result = await client.query({
    query: `
      SELECT DISTINCT trader_wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      ORDER BY trader_wallet
    `,
    format: 'JSONEachRow'
  });

  const wallets = (await result.json() as {trader_wallet: string}[]).map(r => r.trader_wallet);

  totalWallets = wallets.length;
  console.log(`   Found ${totalWallets.toLocaleString()} unique wallets`);

  // Split into batches
  const batches: string[][] = [];
  for (let i = 0; i < wallets.length; i += batchSize) {
    batches.push(wallets.slice(i, i + batchSize));
  }
  console.log(`   Split into ${batches.length} batches of ~${batchSize} wallets each`);

  return batches;
}

async function processBatch(wallets: string[], batchNum: number, totalBatches: number) {
  const startTime = Date.now();

  // Create wallet list for IN clause
  const walletList = wallets.map(w => `'${w}'`).join(',');

  const insertQuery = `
    INSERT INTO pm_cascadian_pnl_v1_new
    WITH
      -- First filter raw data
      filtered_raw AS (
        SELECT event_id, trader_wallet, side, usdc_amount, token_amount, token_id, trade_time
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trader_wallet IN (${walletList})
      ),
      -- Then dedupe
      deduped_trades AS (
        SELECT
          event_id,
          any(trader_wallet) AS wallet,
          any(side) AS side,
          any(usdc_amount) AS usdc_amount,
          any(token_amount) AS token_amount,
          any(token_id) AS token_id,
          any(trade_time) AS trade_time
        FROM filtered_raw
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT
          t.event_id,
          t.wallet AS trader_wallet,
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
      aggregated AS (
        SELECT
          trader_wallet,
          condition_id,
          outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc_amount ELSE usdc_amount END) / 1000000.0 AS trade_cash_flow,
          SUM(CASE WHEN side = 'buy' THEN token_amount ELSE -token_amount END) / 1000000.0 AS final_shares,
          COUNT(*) AS trade_count,
          MIN(trade_time) AS first_trade,
          MAX(trade_time) AS last_trade
        FROM with_condition
        GROUP BY trader_wallet, condition_id, outcome_index
      ),
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
      trade_cash_flow + (final_shares * coalesce(resolution_price, 0)) AS realized_pnl,
      trade_count,
      first_trade,
      last_trade,
      resolved_at,
      CASE WHEN resolution_price IS NOT NULL THEN 1 ELSE 0 END AS is_resolved
    FROM with_resolution
  `;

  await client.command({ query: insertQuery });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  processedBatches++;
  const progress = ((processedBatches / totalBatches) * 100).toFixed(1);

  console.log(`   Batch ${batchNum}/${totalBatches} (${wallets.length} wallets) - ${elapsed}s - ${progress}% complete`);
}

async function swapTables() {
  console.log('');
  console.log('Swapping tables...');

  await client.command({
    query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v1_old'
  });

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
  await client.command({
    query: 'DROP TABLE IF EXISTS pm_cascadian_pnl_v1_old'
  });

  console.log('   Table swap complete');
}

async function createViews() {
  console.log('');
  console.log('Creating summary views...');

  // Wallet summary view
  const walletView = `
    CREATE OR REPLACE VIEW vw_pm_wallet_summary_v1 AS
    SELECT
      trader_wallet,
      SUM(CASE WHEN is_resolved = 1 THEN realized_pnl ELSE 0 END) AS total_realized_pnl,
      SUM(CASE WHEN is_resolved = 1 AND realized_pnl > 0 THEN realized_pnl ELSE 0 END) AS gross_profit,
      SUM(CASE WHEN is_resolved = 1 AND realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END) AS gross_loss,
      COUNT(DISTINCT CASE WHEN is_resolved = 1 THEN condition_id END) AS resolved_markets,
      COUNT(DISTINCT CASE WHEN is_resolved = 1 AND realized_pnl > 0 THEN condition_id END) AS winning_markets,
      COUNT(DISTINCT CASE WHEN is_resolved = 1 AND realized_pnl < 0 THEN condition_id END) AS losing_markets,
      SUM(trade_count) AS total_trades,
      CASE
        WHEN COUNT(DISTINCT CASE WHEN is_resolved = 1 THEN condition_id END) > 0
        THEN COUNT(DISTINCT CASE WHEN is_resolved = 1 AND realized_pnl > 0 THEN condition_id END) * 1.0
             / COUNT(DISTINCT CASE WHEN is_resolved = 1 THEN condition_id END)
        ELSE 0
      END AS win_rate,
      CASE
        WHEN SUM(CASE WHEN is_resolved = 1 AND realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END) > 0
        THEN SUM(CASE WHEN is_resolved = 1 AND realized_pnl > 0 THEN realized_pnl ELSE 0 END)
             / SUM(CASE WHEN is_resolved = 1 AND realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END)
        ELSE NULL
      END AS profit_factor,
      MIN(first_trade) AS first_trade,
      MAX(last_trade) AS last_trade
    FROM pm_cascadian_pnl_v1
    GROUP BY trader_wallet
  `;
  await client.command({ query: walletView });
  console.log('   Created vw_pm_wallet_summary_v1');

  // Market summary view
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
}

async function validate() {
  console.log('');
  console.log('=== VALIDATION ===');

  // Row count
  const countResult = await client.query({
    query: 'SELECT COUNT(*) as cnt, COUNT(DISTINCT trader_wallet) as wallets FROM pm_cascadian_pnl_v1',
    format: 'JSONEachRow'
  });
  const counts = (await countResult.json() as any[])[0];
  console.log(`   Total rows: ${counts?.cnt?.toLocaleString()}`);
  console.log(`   Unique wallets: ${counts?.wallets?.toLocaleString()}`);

  // W2 PnL
  console.log('');
  console.log('1. W2 PnL (expected ~$4,405-4,418):');
  const w2Result = await client.query({
    query: `
      SELECT total_realized_pnl, resolved_markets, win_rate, profit_factor
      FROM vw_pm_wallet_summary_v1
      WHERE trader_wallet = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838'
    `,
    format: 'JSONEachRow'
  });
  const w2 = (await w2Result.json() as any[])[0];
  console.log('   PnL: $' + (w2?.total_realized_pnl?.toFixed(2) || 'N/A'));
  console.log('   Markets: ' + w2?.resolved_markets);
  console.log('   Win Rate: ' + ((w2?.win_rate || 0) * 100).toFixed(1) + '%');

  // Zero-sum check
  console.log('');
  console.log('2. Zero-sum validation:');
  const zsResult = await client.query({
    query: `
      SELECT
        COUNT(*) as total_markets,
        SUM(CASE WHEN ABS(market_pnl_sum) > 1.0 THEN 1 ELSE 0 END) as non_zero_markets,
        AVG(ABS(market_pnl_sum)) as avg_deviation,
        MAX(ABS(market_pnl_sum)) as max_deviation
      FROM vw_pm_market_summary_v1
      WHERE is_resolved = 1
    `,
    format: 'JSONEachRow'
  });
  const zs = (await zsResult.json() as any[])[0];
  console.log('   Resolved markets: ' + zs?.total_markets?.toLocaleString());
  console.log('   Non-zero sum (>$1): ' + zs?.non_zero_markets);
  console.log('   Avg deviation: $' + zs?.avg_deviation?.toFixed(6));
  console.log('   Max deviation: $' + zs?.max_deviation?.toFixed(2));

  // Top 5 leaderboard
  console.log('');
  console.log('3. Top 5 leaderboard:');
  const lbResult = await client.query({
    query: `
      SELECT trader_wallet, total_realized_pnl, resolved_markets, win_rate
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
      '   ' + row.trader_wallet.slice(0, 10) + '... ' +
      '$' + row.total_realized_pnl.toFixed(2).padStart(12) + ' | ' +
      row.resolved_markets + ' mkts | ' +
      (row.win_rate * 100).toFixed(1) + '%'
    );
  }

  // Query performance
  console.log('');
  console.log('4. Query performance:');
  const start = Date.now();
  await client.query({
    query: `SELECT * FROM pm_cascadian_pnl_v1 WHERE trader_wallet = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838'`,
    format: 'JSONEachRow'
  });
  console.log('   Single wallet query: ' + (Date.now() - start) + 'ms');
}

async function main() {
  const startTime = Date.now();
  console.log('=== CASCADIAN PNL V1 TABLE BUILD (BATCHED) ===');
  console.log('');

  try {
    await createEmptyTable();

    const batches = await getWalletBatches(2000);  // 2000 wallets per batch

    console.log('');
    console.log('Processing batches...');

    for (let i = 0; i < batches.length; i++) {
      await processBatch(batches[i], i + 1, batches.length);
    }

    await swapTables();
    await createViews();
    await validate();

    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log('');
    console.log(`=== BUILD COMPLETE (${totalTime} minutes) ===`);
  } finally {
    await client.close();
  }
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
