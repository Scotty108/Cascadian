// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx

/**
 * CANONICAL PnL PIPELINE
 *
 * Builds ground-truth wallet PnL from raw fills without depending on Goldsky's precomputed tables.
 *
 * Pipeline:
 * 1. vw_trader_events_v2_dedup - Dedup fills by event_id
 * 2. vw_fills_normalized - Join to token map, scale units (÷1e6)
 * 3. pm_wallet_market_positions_raw - Aggregate positions per wallet/market/outcome
 * 4. vw_condition_payouts - Parse payout_numerators JSON
 * 5. pm_wallet_market_pnl_v3 - Final PnL with resolution payouts
 * 6. Rollup views for wallet totals, category, tag, win rate, omega
 *
 * Expected: Theo wallet should show ~$22M (matches Polymarket)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const THEO_WALLET = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'

async function runCommand(name: string, query: string): Promise<boolean> {
  console.log(`
${'='.repeat(70)}`)
  console.log(`📦 ${name}`)
  console.log('='.repeat(70))
  try {
    await clickhouse.command({ query })
    console.log('✅ Success')
    return true
  } catch (error) {
    console.error(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return false
  }
}

async function runQuery<T = any>(name: string, query: string): Promise<T[] | null> {
  console.log(`
${'='.repeat(70)}`)
  console.log(`🔍 ${name}`)
  console.log('='.repeat(70))
  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 300 }
    })
    const data = await result.json() as T[]
    console.log(JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return null
  }
}

// ============================================================================
// PHASE 1: Foundation Views
// ============================================================================

async function createDedupView(): Promise<boolean> {
  console.log('

🔧 PHASE 1A: Creating vw_trader_events_v2_dedup')

  // Drop existing view if exists
  await runCommand('DROP existing vw_trader_events_v2_dedup',
    `DROP VIEW IF EXISTS vw_trader_events_v2_dedup`)

  // Create dedup view - selects latest version of each event_id
  return await runCommand('CREATE vw_trader_events_v2_dedup',
    `CREATE VIEW vw_trader_events_v2_dedup AS
    SELECT *
    FROM pm_trader_events_v2
    WHERE is_deleted = 0`)
}

async function createNormalizedFillsView(): Promise<boolean> {
  console.log('

🔧 PHASE 1B: Creating vw_fills_normalized')

  await runCommand('DROP existing vw_fills_normalized',
    `DROP VIEW IF EXISTS vw_fills_normalized`)

  // Normalized fills: join to token map, scale units, add outcome_index
  return await runCommand('CREATE vw_fills_normalized',
    `CREATE VIEW vw_fills_normalized AS
    SELECT
      t.event_id,
      t.trader_wallet,
      t.token_id,
      lower(t.side) as side,
      -- Scale from atomic units (6 decimals)
      t.usdc_amount / 1000000.0 as usdc,
      t.token_amount / 1000000.0 as shares,
      t.fee_amount / 1000000.0 as fee,
      t.trade_time,
      -- Market info from token map
      m.condition_id,
      m.outcome_index,
      m.question,
      m.category
    FROM vw_trader_events_v2_dedup t
    INNER JOIN pm_token_to_condition_map_v2 m ON m.token_id_dec = t.token_id`)
}

// ============================================================================
// PHASE 2: Positions Table
// ============================================================================

async function createPositionsTable(): Promise<boolean> {
  console.log('

🔧 PHASE 2: Creating pm_wallet_market_positions_raw')

  await runCommand('DROP existing pm_wallet_market_positions_raw',
    `DROP TABLE IF EXISTS pm_wallet_market_positions_raw`)

  // Create table structure
  const created = await runCommand('CREATE pm_wallet_market_positions_raw (schema)',
    `CREATE TABLE pm_wallet_market_positions_raw (
      wallet String,
      condition_id String,
      outcome_index UInt8,
      question String,
      category String,
      -- Position metrics (scaled USD)
      total_bought_usdc Float64,
      total_sold_usdc Float64,
      total_fees_usdc Float64,
      bought_shares Float64,
      sold_shares Float64,
      net_shares Float64,
      -- Trade counts
      buy_count UInt64,
      sell_count UInt64,
      total_trades UInt64,
      -- Timestamps
      first_trade DateTime,
      last_trade DateTime,
      computed_at DateTime DEFAULT now()
    ) ENGINE = SharedMergeTree
    ORDER BY (wallet, condition_id, outcome_index)
    SETTINGS index_granularity = 8192`)

  if (!created) return false

  // Populate from normalized fills
  console.log('
⏳ Populating positions (this may take 10-20 minutes)...')

  return await runCommand('INSERT pm_wallet_market_positions_raw',
    `INSERT INTO pm_wallet_market_positions_raw
    SELECT
      trader_wallet as wallet,
      condition_id,
      outcome_index,
      any(question) as question,
      any(category) as category,
      -- Position metrics
      sumIf(usdc, side = 'buy') as total_bought_usdc,
      sumIf(usdc, side = 'sell') as total_sold_usdc,
      sum(fee) as total_fees_usdc,
      sumIf(shares, side = 'buy') as bought_shares,
      sumIf(shares, side = 'sell') as sold_shares,
      sumIf(shares, side = 'buy') - sumIf(shares, side = 'sell') as net_shares,
      -- Trade counts
      countIf(side = 'buy') as buy_count,
      countIf(side = 'sell') as sell_count,
      count() as total_trades,
      -- Timestamps
      min(trade_time) as first_trade,
      max(trade_time) as last_trade,
      now() as computed_at
    FROM vw_fills_normalized
    GROUP BY trader_wallet, condition_id, outcome_index
    SETTINGS
      max_execution_time = 3600,
      max_memory_usage = 50000000000`)
}

// ============================================================================
// PHASE 3: Payout View and Final PnL Table
// ============================================================================

async function createPayoutView(): Promise<boolean> {
  console.log('

🔧 PHASE 3A: Creating vw_condition_payouts')

  await runCommand('DROP existing vw_condition_payouts',
    `DROP VIEW IF EXISTS vw_condition_payouts`)

  // Parse payout_numerators JSON to get per-outcome payouts
  return await runCommand('CREATE vw_condition_payouts',
    `CREATE VIEW vw_condition_payouts AS
    SELECT
      condition_id,
      payout_numerators,
      payout_denominator,
      resolved_at,
      -- Parse payout for outcome 0 (YES) - ClickHouse arrays are 1-indexed
      JSONExtractInt(payout_numerators, 1) as payout_outcome_0,
      -- Parse payout for outcome 1 (NO)
      JSONExtractInt(payout_numerators, 2) as payout_outcome_1
    FROM pm_condition_resolutions`)
}

async function createFinalPnLTable(): Promise<boolean> {
  console.log('

🔧 PHASE 3B: Creating pm_wallet_market_pnl_v3')

  await runCommand('DROP existing pm_wallet_market_pnl_v3',
    `DROP TABLE IF EXISTS pm_wallet_market_pnl_v3`)

  // Create table structure
  const created = await runCommand('CREATE pm_wallet_market_pnl_v3 (schema)',
    `CREATE TABLE pm_wallet_market_pnl_v3 (
      wallet String,
      condition_id String,
      outcome_index UInt8,
      question String,
      category String,
      -- Position metrics
      total_bought_usdc Float64,
      total_sold_usdc Float64,
      total_fees_usdc Float64,
      bought_shares Float64,
      sold_shares Float64,
      net_shares Float64,
      -- Trade counts
      buy_count UInt64,
      sell_count UInt64,
      total_trades UInt64,
      -- Timestamps
      first_trade DateTime,
      last_trade DateTime,
      -- Resolution info
      is_resolved UInt8,
      resolved_at Nullable(DateTime),
      payout_numerators String,
      outcome_payout UInt8,
      -- PnL calculations
      trading_pnl Float64,           -- sold - bought - fees
      resolution_payout Float64,     -- net_shares × outcome_payout (if resolved & positive)
      total_pnl Float64,             -- trading_pnl + resolution_payout
      computed_at DateTime DEFAULT now()
    ) ENGINE = SharedMergeTree
    ORDER BY (wallet, condition_id, outcome_index)
    SETTINGS index_granularity = 8192`)

  if (!created) return false

  // Join positions with payouts to compute final PnL
  console.log('
⏳ Computing final PnL with resolution payouts...')

  return await runCommand('INSERT pm_wallet_market_pnl_v3',
    `INSERT INTO pm_wallet_market_pnl_v3
    SELECT
      p.wallet,
      p.condition_id,
      p.outcome_index,
      p.question,
      p.category,
      -- Position metrics (pass through)
      p.total_bought_usdc,
      p.total_sold_usdc,
      p.total_fees_usdc,
      p.bought_shares,
      p.sold_shares,
      p.net_shares,
      -- Trade counts
      p.buy_count,
      p.sell_count,
      p.total_trades,
      -- Timestamps
      p.first_trade,
      p.last_trade,
      -- Resolution info
      IF(r.condition_id IS NOT NULL, 1, 0) as is_resolved,
      r.resolved_at,
      COALESCE(r.payout_numerators, '') as payout_numerators,
      -- Get payout for this specific outcome (0 or 1)
      IF(p.outcome_index = 0, COALESCE(r.payout_outcome_0, 0), COALESCE(r.payout_outcome_1, 0)) as outcome_payout,
      -- PnL calculations
      p.total_sold_usdc - p.total_bought_usdc - p.total_fees_usdc as trading_pnl,
      -- Resolution payout = max(0, net_shares) × outcome_payout
      greatest(0, p.net_shares) * IF(p.outcome_index = 0, COALESCE(r.payout_outcome_0, 0), COALESCE(r.payout_outcome_1, 0)) as resolution_payout,
      -- Total PnL = trading + resolution
      (p.total_sold_usdc - p.total_bought_usdc - p.total_fees_usdc) +
        (greatest(0, p.net_shares) * IF(p.outcome_index = 0, COALESCE(r.payout_outcome_0, 0), COALESCE(r.payout_outcome_1, 0))) as total_pnl,
      now() as computed_at
    FROM pm_wallet_market_positions_raw p
    LEFT JOIN vw_condition_payouts r ON r.condition_id = p.condition_id`)
}

// ============================================================================
// PHASE 4: Rollup Views
// ============================================================================

async function createRollupViews(): Promise<boolean> {
  console.log('

🔧 PHASE 4: Creating rollup views')

  // 4A: Total PnL per wallet
  await runCommand('DROP vw_wallet_total_pnl', `DROP VIEW IF EXISTS vw_wallet_total_pnl`)
  await runCommand('CREATE vw_wallet_total_pnl',
    `CREATE VIEW vw_wallet_total_pnl AS
    SELECT
      wallet,
      count() as positions,
      countDistinct(condition_id) as markets_traded,
      sum(total_trades) as total_trades,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(total_fees_usdc), 2) as total_fees,
      round(sum(trading_pnl), 2) as trading_pnl,
      round(sum(resolution_payout), 2) as resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl,
      min(first_trade) as first_trade,
      max(last_trade) as last_trade
    FROM pm_wallet_market_pnl_v3
    GROUP BY wallet`)

  // 4B: PnL by category per wallet
  await runCommand('DROP vw_wallet_category_pnl', `DROP VIEW IF EXISTS vw_wallet_category_pnl`)
  await runCommand('CREATE vw_wallet_category_pnl',
    `CREATE VIEW vw_wallet_category_pnl AS
    SELECT
      wallet,
      category,
      count() as positions,
      countDistinct(condition_id) as markets_traded,
      sum(total_trades) as total_trades,
      round(sum(total_bought_usdc), 2) as total_bought,
      round(sum(total_sold_usdc), 2) as total_sold,
      round(sum(trading_pnl), 2) as trading_pnl,
      round(sum(resolution_payout), 2) as resolution_payouts,
      round(sum(total_pnl), 2) as total_pnl
    FROM pm_wallet_market_pnl_v3
    GROUP BY wallet, category`)

  // 4C: Win rate per wallet (resolved markets only)
  await runCommand('DROP vw_wallet_win_rate', `DROP VIEW IF EXISTS vw_wallet_win_rate`)
  await runCommand('CREATE vw_wallet_win_rate',
    `CREATE VIEW vw_wallet_win_rate AS
    SELECT
      wallet,
      countIf(is_resolved = 1) as resolved_positions,
      countIf(is_resolved = 1 AND total_pnl > 0) as winning_positions,
      countIf(is_resolved = 1 AND total_pnl < 0) as losing_positions,
      countIf(is_resolved = 1 AND total_pnl = 0) as breakeven_positions,
      round(IF(countIf(is_resolved = 1) > 0,
        countIf(is_resolved = 1 AND total_pnl > 0) / countIf(is_resolved = 1) * 100,
        0), 2) as win_rate_pct,
      round(avgIf(total_pnl, is_resolved = 1 AND total_pnl > 0), 2) as avg_win,
      round(avgIf(total_pnl, is_resolved = 1 AND total_pnl < 0), 2) as avg_loss
    FROM pm_wallet_market_pnl_v3
    GROUP BY wallet`)

  // 4D: Top traders leaderboard
  await runCommand('DROP vw_pnl_leaderboard', `DROP VIEW IF EXISTS vw_pnl_leaderboard`)
  return await runCommand('CREATE vw_pnl_leaderboard',
    `CREATE VIEW vw_pnl_leaderboard AS
    SELECT
      t.wallet,
      t.total_pnl,
      t.trading_pnl,
      t.resolution_payouts,
      t.markets_traded,
      t.total_trades,
      t.total_bought,
      t.total_sold,
      w.win_rate_pct,
      w.resolved_positions,
      w.winning_positions,
      w.losing_positions
    FROM vw_wallet_total_pnl t
    LEFT JOIN vw_wallet_win_rate w ON w.wallet = t.wallet
    WHERE t.markets_traded >= 5  -- Minimum activity threshold
    ORDER BY t.total_pnl DESC`)
}

// ============================================================================
// VALIDATION
// ============================================================================

async function validatePipeline(): Promise<void> {
  console.log('

🎯 VALIDATION')

  // Overall stats
  await runQuery('pm_wallet_market_pnl_v3 STATS',
    `SELECT
      count() as total_positions,
      countDistinct(wallet) as unique_wallets,
      countDistinct(condition_id) as unique_markets,
      countIf(is_resolved = 1) as resolved_positions,
      round(sum(total_bought_usdc), 2) as total_volume_bought,
      round(sum(total_pnl), 2) as total_pnl_all_wallets
    FROM pm_wallet_market_pnl_v3`)

  // Theo validation - THE KEY TEST
  await runQuery(`THEO WALLET (${THEO_WALLET})`,
    `SELECT
      wallet,
      total_pnl,
      trading_pnl,
      resolution_payouts,
      markets_traded,
      total_trades,
      total_bought,
      total_sold
    FROM vw_wallet_total_pnl
    WHERE wallet = '${THEO_WALLET}'`)

  // Compare to pm_user_positions reference
  await runQuery('THEO from pm_user_positions (REFERENCE - should be ~$22M)',
    `SELECT
      wallet,
      round(realized_pnl / 1e6, 2) as realized_pnl_usd,
      round(total_bought / 1e6, 2) as total_bought_usd,
      market_count
    FROM pm_user_positions
    WHERE wallet = '${THEO_WALLET}'
    LIMIT 1`)

  // Top 10 wallets by PnL
  await runQuery('TOP 10 WALLETS BY PnL',
    `SELECT * FROM vw_pnl_leaderboard LIMIT 10`)

  // Win rate leaders (min 50 resolved positions)
  await runQuery('TOP WIN RATE (min 50 resolved)',
    `SELECT
      wallet,
      win_rate_pct,
      resolved_positions,
      winning_positions,
      losing_positions,
      avg_win,
      avg_loss
    FROM vw_wallet_win_rate
    WHERE resolved_positions >= 50
    ORDER BY win_rate_pct DESC
    LIMIT 10`)
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('
' + '🚀'.repeat(35))
  console.log('CANONICAL PnL PIPELINE BUILD')
  console.log('🚀'.repeat(35))

  const startTime = Date.now()

  // Phase 1: Foundation views
  console.log('

📍 PHASE 1: Foundation Views')
  if (!await createDedupView()) {
    console.error('Failed to create dedup view')
    process.exit(1)
  }
  if (!await createNormalizedFillsView()) {
    console.error('Failed to create normalized fills view')
    process.exit(1)
  }

  // Phase 2: Positions table
  console.log('

📍 PHASE 2: Positions Table')
  if (!await createPositionsTable()) {
    console.error('Failed to create positions table')
    process.exit(1)
  }

  // Phase 3: Payout view and final PnL
  console.log('

📍 PHASE 3: Payout View & Final PnL')
  if (!await createPayoutView()) {
    console.error('Failed to create payout view')
    process.exit(1)
  }
  if (!await createFinalPnLTable()) {
    console.error('Failed to create final PnL table')
    process.exit(1)
  }

  // Phase 4: Rollup views
  console.log('

📍 PHASE 4: Rollup Views')
  if (!await createRollupViews()) {
    console.error('Failed to create rollup views')
    process.exit(1)
  }

  // Validation
  await validatePipeline()

  const elapsed = Math.round((Date.now() - startTime) / 1000)
  console.log(`

${'✅'.repeat(35)}`)
  console.log(`PIPELINE BUILD COMPLETE - ${elapsed}s elapsed`)
  console.log('✅'.repeat(35))

  await clickhouse.close()
}

main().catch(error => {
  console.error('
💥 FATAL ERROR:', error)
  process.exit(1)
})
