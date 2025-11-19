import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function isolateExecutorBloat() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET EXECUTOR BLOAT ISOLATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  // STEP 1: Check if base table exists, otherwise use view
  console.log('STEP 1: Checking available tables...\n');

  const tablesQuery = `
    SELECT name
    FROM system.tables
    WHERE database = currentDatabase()
      AND (name LIKE '%trades%canonical%' OR name LIKE '%pm_trades%')
    ORDER BY name
  `;

  const tablesResult = await clickhouse.query({ query: tablesQuery, format: 'JSONEachRow' });
  const tablesData = await tablesResult.json();

  console.log('Available trade tables:');
  for (const row of tablesData) {
    console.log(`  - ${row.name}`);
  }
  console.log();

  // STEP 2: Base wallet only (no clustering)
  console.log('STEP 2: Base wallet only (no clustering)...\n');

  const baseWalletQuery = `
    SELECT
      sumIf(usd_value, trade_direction = 'SELL') - sumIf(usd_value, trade_direction = 'BUY') AS trade_pnl,
      sum(usd_value) AS volume,
      count() AS trades,
      uniq(condition_id_norm_v3) AS markets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE condition_id_norm_v3 != ''
      AND wallet_address = '${XCN_CANONICAL}'
  `;

  const baseResult = await clickhouse.query({ query: baseWalletQuery, format: 'JSONEachRow' });
  const baseData = await baseResult.json();

  if (baseData.length > 0) {
    const b = baseData[0];
    console.log(`  Base wallet: ${XCN_CANONICAL}`);
    console.log(`  Trade P&L:   $${parseFloat(b.trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Volume:      $${parseFloat(b.volume).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Trades:      ${b.trades.toLocaleString()}`);
    console.log(`  Markets:     ${b.markets.toLocaleString()}\n`);

    if (Math.abs(b.trade_pnl) < 200000) {
      console.log('  ✅ BASE WALLET MATCHES UI SCALE (~$96k)!\n');
      console.log('  → DIAGNOSIS: Executor cluster over-attribution\n');
    } else {
      console.log('  ⚠️  Base wallet still high - may need different address\n');
    }
  }

  // STEP 3: Get executor wallet list
  console.log('STEP 3: Getting executor wallet list...\n');

  const executorsQuery = `
    SELECT
      executor_wallet,
      canonical_wallet
    FROM wallet_identity_overrides
    WHERE canonical_wallet = '${XCN_CANONICAL}'
    ORDER BY executor_wallet
  `;

  let executorsList = [];
  try {
    const execResult = await clickhouse.query({ query: executorsQuery, format: 'JSONEachRow' });
    const execData = await execResult.json();

    if (execData.length > 0) {
      console.log(`Found ${execData.length} executors in wallet_identity_overrides:\n`);
      for (const row of execData) {
        console.log(`  - ${row.executor_wallet}`);
        executorsList.push(row.executor_wallet);
      }
      console.log();
    } else {
      console.log('  No executors found in wallet_identity_overrides\n');
    }
  } catch (err) {
    console.log(`  ⚠️  wallet_identity_overrides table not found: ${err.message}\n`);
    console.log('  Will check wallet_raw field instead...\n');
  }

  // STEP 4: Per-executor breakdown using wallet_canonical filter
  console.log('STEP 4: Per-executor breakdown (via wallet_canonical)...\n');

  const perExecutorQuery = `
    SELECT
      wallet_address AS executor,
      sumIf(usd_value, trade_direction = 'BUY') AS cost_buy,
      sumIf(usd_value, trade_direction = 'SELL') AS proceeds_sell,
      proceeds_sell - cost_buy AS trade_pnl,
      count() AS trades,
      sum(usd_value) AS volume
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE condition_id_norm_v3 != ''
      AND wallet_canonical = '${XCN_CANONICAL}'
    GROUP BY executor
    ORDER BY ABS(trade_pnl) DESC
    LIMIT 20
  `;

  const execBreakdownResult = await clickhouse.query({ query: perExecutorQuery, format: 'JSONEachRow' });
  const execBreakdownData = await execBreakdownResult.json();

  if (execBreakdownData.length > 0) {
    console.log('Top executors by absolute trade P&L:\n');
    for (const row of execBreakdownData) {
      const pnl = parseFloat(row.trade_pnl);
      const volume = parseFloat(row.volume);
      console.log(`  ${row.executor}`);
      console.log(`    Trade P&L: $${pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`    Volume:    $${volume.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`    Trades:    ${row.trades.toLocaleString()}\n`);

      if (volume > 1000000000) {
        console.log(`    🔴 BLOAT EXECUTOR: Contributing $${(volume / 1e9).toFixed(2)}B\n`);
      }
    }
  }

  // STEP 5: Check if canonical wallet is base wallet
  console.log('STEP 5: Checking if canonical = base wallet...\n');

  const canonicalCheckQuery = `
    SELECT
      count() AS total_rows,
      countIf(wallet_canonical = wallet_address) AS canonical_is_base,
      countIf(wallet_canonical != wallet_address) AS canonical_is_executor
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_CANONICAL}'
  `;

  const canonicalResult = await clickhouse.query({ query: canonicalCheckQuery, format: 'JSONEachRow' });
  const canonicalData = await canonicalResult.json();

  if (canonicalData.length > 0) {
    const c = canonicalData[0];
    console.log(`  Total rows:              ${c.total_rows.toLocaleString()}`);
    console.log(`  Canonical = base wallet: ${c.canonical_is_base.toLocaleString()} (${((c.canonical_is_base / c.total_rows) * 100).toFixed(2)}%)`);
    console.log(`  Canonical = executor:    ${c.canonical_is_executor.toLocaleString()} (${((c.canonical_is_executor / c.total_rows) * 100).toFixed(2)}%)\n`);

    if (c.canonical_is_executor > c.total_rows * 0.9) {
      console.log('  🔴 MOST TRADES FROM EXECUTORS - cluster over-attribution likely\n');
    }
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DIAGNOSIS COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
}

isolateExecutorBloat()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
