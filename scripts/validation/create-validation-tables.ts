/**
 * Create validation infrastructure tables for PnL engine testing
 *
 * Tables created:
 * 1. pm_validation_wallets_v1 - Fixed cohort of 200-500 wallets
 * 2. pm_pnl_baseline_api_v1 - Cached Polymarket API results
 * 3. pm_pnl_engine_results_v1 - Engine outputs for comparison
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { clickhouse } from '../../lib/clickhouse/client'

async function createTables() {
  console.log('Creating validation infrastructure tables...\n')

  // Table 1: pm_validation_wallets_v1
  console.log('1. Creating pm_validation_wallets_v1...')
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_validation_wallets_v1 (
        wallet String,
        cohort_tag String,
        trade_count UInt32,
        added_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(added_at)
      ORDER BY wallet
    `
  })
  console.log('   Done.\n')

  // Table 2: pm_pnl_baseline_api_v1
  console.log('2. Creating pm_pnl_baseline_api_v1...')
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_pnl_baseline_api_v1 (
        wallet String,
        pnl Float64,
        fetched_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(fetched_at)
      ORDER BY wallet
    `
  })
  console.log('   Done.\n')

  // Table 3: pm_pnl_engine_results_v1
  console.log('3. Creating pm_pnl_engine_results_v1...')
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_pnl_engine_results_v1 (
        engine String,
        wallet String,
        pnl_total Float64,
        pnl_realized Float64,
        pnl_unrealized Float64,
        runtime_ms UInt32,
        status String DEFAULT 'ok',
        computed_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(computed_at)
      ORDER BY (engine, wallet)
    `
  })
  console.log('   Done.\n')

  console.log('All tables created successfully!')
}

async function populateValidationWallets() {
  console.log('\nPopulating pm_validation_wallets_v1...\n')

  // Clear existing data for clean population
  console.log('Clearing existing data...')
  await clickhouse.command({
    query: `TRUNCATE TABLE pm_validation_wallets_v1`
  })

  // 1. Insert known passing V1 wallets
  const passV1Wallets = [
    '0x105a54a721d475a5d2faaf7902c55475758ba63c',
    '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc',
    '0xee81df87bc51eebc6a050bb70638c5e56063ef68',
    '0x7412897ad6ea781b68e2ac2f8cf3fad3502f85d0'
  ]

  console.log('Inserting 4 known passing V1 wallets (pass_v1)...')

  // Get trade counts for pass_v1 wallets
  const passV1Result = await clickhouse.query({
    query: `
      SELECT
        trader_wallet as wallet,
        count(DISTINCT event_id) as trade_count
      FROM pm_trader_events_v2
      WHERE trader_wallet IN (${passV1Wallets.map(w => `'${w}'`).join(',')})
        AND is_deleted = 0
      GROUP BY trader_wallet
    `,
    format: 'JSONEachRow'
  })
  const passV1Data = await passV1Result.json() as Array<{wallet: string, trade_count: number}>

  // Create a map for trade counts
  const passV1Counts = new Map(passV1Data.map(r => [r.wallet, Number(r.trade_count)]))

  await clickhouse.insert({
    table: 'pm_validation_wallets_v1',
    values: passV1Wallets.map(wallet => ({
      wallet,
      cohort_tag: 'pass_v1',
      trade_count: passV1Counts.get(wallet) || 0
    })),
    format: 'JSONEachRow'
  })
  console.log(`   Inserted ${passV1Wallets.length} pass_v1 wallets`)

  // 2. Insert known failing V1 wallets
  const failV1Wallets = [
    '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4',
    '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0',
    '0x0015c5a76490d303e837d79dd5cf6a3825e4d5b0'
  ]

  console.log('Inserting 3 known failing V1 wallets (fail_v1)...')

  // Get trade counts for fail_v1 wallets
  const failV1Result = await clickhouse.query({
    query: `
      SELECT
        trader_wallet as wallet,
        count(DISTINCT event_id) as trade_count
      FROM pm_trader_events_v2
      WHERE trader_wallet IN (${failV1Wallets.map(w => `'${w}'`).join(',')})
        AND is_deleted = 0
      GROUP BY trader_wallet
    `,
    format: 'JSONEachRow'
  })
  const failV1Data = await failV1Result.json() as Array<{wallet: string, trade_count: number}>

  // Create a map for trade counts
  const failV1Counts = new Map(failV1Data.map(r => [r.wallet, Number(r.trade_count)]))

  await clickhouse.insert({
    table: 'pm_validation_wallets_v1',
    values: failV1Wallets.map(wallet => ({
      wallet,
      cohort_tag: 'fail_v1',
      trade_count: failV1Counts.get(wallet) || 0
    })),
    format: 'JSONEachRow'
  })
  console.log(`   Inserted ${failV1Wallets.length} fail_v1 wallets`)

  // 3. Insert 100 random from pm_wallets_perfect_tier with trade_count >= 30
  console.log('Inserting 100 random wallets from pm_wallets_perfect_tier (trade_count >= 30)...')

  // First check if pm_wallets_perfect_tier exists and its schema
  const perfectTierCheck = await clickhouse.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = currentDatabase()
        AND table = 'pm_wallets_perfect_tier'
    `,
    format: 'JSONEachRow'
  })
  const perfectTierColumns = await perfectTierCheck.json() as Array<{name: string, type: string}>

  if (perfectTierColumns.length === 0) {
    console.log('   WARNING: pm_wallets_perfect_tier does not exist, skipping...')
  } else {
    // Check if trade_count column exists
    const hasTradeCount = perfectTierColumns.some(c => c.name === 'trade_count')
    const hasTradesColumn = perfectTierColumns.some(c => c.name === 'trades')
    const tradeCountCol = hasTradeCount ? 'trade_count' : (hasTradesColumn ? 'trades' : null)

    console.log(`   Found columns: ${perfectTierColumns.map(c => c.name).join(', ')}`)
    console.log(`   Using trade count column: ${tradeCountCol || 'NONE'}`)

    if (tradeCountCol) {
      const perfectTierResult = await clickhouse.query({
        query: `
          SELECT
            wallet,
            ${tradeCountCol} as trade_count
          FROM pm_wallets_perfect_tier
          WHERE ${tradeCountCol} >= 30
          ORDER BY rand()
          LIMIT 100
        `,
        format: 'JSONEachRow'
      })
      const perfectTierData = await perfectTierResult.json() as Array<{wallet: string, trade_count: number}>

      if (perfectTierData.length > 0) {
        await clickhouse.insert({
          table: 'pm_validation_wallets_v1',
          values: perfectTierData.map(row => ({
            wallet: row.wallet,
            cohort_tag: 'random_perfect_tier',
            trade_count: Number(row.trade_count)
          })),
          format: 'JSONEachRow'
        })
        console.log(`   Inserted ${perfectTierData.length} random_perfect_tier wallets`)
      } else {
        console.log('   WARNING: No wallets found with trade_count >= 30 in pm_wallets_perfect_tier')
      }
    } else {
      // Fall back to joining with pm_trader_events_v2
      console.log('   No trade_count column found, computing from pm_trader_events_v2...')
      const perfectTierResult = await clickhouse.query({
        query: `
          SELECT
            pt.wallet,
            count(DISTINCT te.event_id) as trade_count
          FROM pm_wallets_perfect_tier pt
          JOIN pm_trader_events_v2 te ON pt.wallet = te.trader_wallet
          WHERE te.is_deleted = 0
          GROUP BY pt.wallet
          HAVING trade_count >= 30
          ORDER BY rand()
          LIMIT 100
        `,
        format: 'JSONEachRow'
      })
      const perfectTierData = await perfectTierResult.json() as Array<{wallet: string, trade_count: number}>

      if (perfectTierData.length > 0) {
        await clickhouse.insert({
          table: 'pm_validation_wallets_v1',
          values: perfectTierData.map(row => ({
            wallet: row.wallet,
            cohort_tag: 'random_perfect_tier',
            trade_count: Number(row.trade_count)
          })),
          format: 'JSONEachRow'
        })
        console.log(`   Inserted ${perfectTierData.length} random_perfect_tier wallets`)
      } else {
        console.log('   WARNING: No wallets found with trade_count >= 30')
      }
    }
  }

  // 4. Insert 100 random from pm_copy_trading_candidates_v1 with trade_count >= 30
  console.log('Inserting 100 random wallets from pm_copy_trading_candidates_v1 (trade_count >= 30)...')

  // First check if pm_copy_trading_candidates_v1 exists and its schema
  const copyTradingCheck = await clickhouse.query({
    query: `
      SELECT name, type
      FROM system.columns
      WHERE database = currentDatabase()
        AND table = 'pm_copy_trading_candidates_v1'
    `,
    format: 'JSONEachRow'
  })
  const copyTradingColumns = await copyTradingCheck.json() as Array<{name: string, type: string}>

  if (copyTradingColumns.length === 0) {
    console.log('   WARNING: pm_copy_trading_candidates_v1 does not exist, skipping...')
  } else {
    // Check if trade_count column exists
    const hasTradeCount = copyTradingColumns.some(c => c.name === 'trade_count')
    const hasTradesColumn = copyTradingColumns.some(c => c.name === 'trades')
    const tradeCountCol = hasTradeCount ? 'trade_count' : (hasTradesColumn ? 'trades' : null)

    console.log(`   Found columns: ${copyTradingColumns.map(c => c.name).join(', ')}`)
    console.log(`   Using trade count column: ${tradeCountCol || 'NONE'}`)

    if (tradeCountCol) {
      const copyTradingResult = await clickhouse.query({
        query: `
          SELECT
            wallet,
            ${tradeCountCol} as trade_count
          FROM pm_copy_trading_candidates_v1
          WHERE ${tradeCountCol} >= 30
          ORDER BY rand()
          LIMIT 100
        `,
        format: 'JSONEachRow'
      })
      const copyTradingData = await copyTradingResult.json() as Array<{wallet: string, trade_count: number}>

      if (copyTradingData.length > 0) {
        await clickhouse.insert({
          table: 'pm_validation_wallets_v1',
          values: copyTradingData.map(row => ({
            wallet: row.wallet,
            cohort_tag: 'random_copy_trading',
            trade_count: Number(row.trade_count)
          })),
          format: 'JSONEachRow'
        })
        console.log(`   Inserted ${copyTradingData.length} random_copy_trading wallets`)
      } else {
        console.log('   WARNING: No wallets found with trade_count >= 30 in pm_copy_trading_candidates_v1')
      }
    } else {
      // Fall back to joining with pm_trader_events_v2
      console.log('   No trade_count column found, computing from pm_trader_events_v2...')
      const copyTradingResult = await clickhouse.query({
        query: `
          SELECT
            ct.wallet,
            count(DISTINCT te.event_id) as trade_count
          FROM pm_copy_trading_candidates_v1 ct
          JOIN pm_trader_events_v2 te ON ct.wallet = te.trader_wallet
          WHERE te.is_deleted = 0
          GROUP BY ct.wallet
          HAVING trade_count >= 30
          ORDER BY rand()
          LIMIT 100
        `,
        format: 'JSONEachRow'
      })
      const copyTradingData = await copyTradingResult.json() as Array<{wallet: string, trade_count: number}>

      if (copyTradingData.length > 0) {
        await clickhouse.insert({
          table: 'pm_validation_wallets_v1',
          values: copyTradingData.map(row => ({
            wallet: row.wallet,
            cohort_tag: 'random_copy_trading',
            trade_count: Number(row.trade_count)
          })),
          format: 'JSONEachRow'
        })
        console.log(`   Inserted ${copyTradingData.length} random_copy_trading wallets`)
      } else {
        console.log('   WARNING: No wallets found with trade_count >= 30')
      }
    }
  }

  // Summary
  console.log('\n--- Summary ---')
  const summaryResult = await clickhouse.query({
    query: `
      SELECT
        cohort_tag,
        count() as count,
        round(avg(trade_count), 1) as avg_trade_count,
        min(trade_count) as min_trade_count,
        max(trade_count) as max_trade_count
      FROM pm_validation_wallets_v1 FINAL
      GROUP BY cohort_tag
      ORDER BY cohort_tag
    `,
    format: 'JSONEachRow'
  })
  const summaryData = await summaryResult.json() as Array<{
    cohort_tag: string,
    count: number,
    avg_trade_count: number,
    min_trade_count: number,
    max_trade_count: number
  }>

  console.log('\nCohort breakdown:')
  let totalWallets = 0
  for (const row of summaryData) {
    console.log(`  ${row.cohort_tag}: ${row.count} wallets (trades: min=${row.min_trade_count}, avg=${row.avg_trade_count}, max=${row.max_trade_count})`)
    totalWallets += Number(row.count)
  }
  console.log(`\nTotal wallets in validation cohort: ${totalWallets}`)
}

async function verifyTables() {
  console.log('\n\n=== Verification ===\n')

  // Check all tables exist
  const tablesResult = await clickhouse.query({
    query: `
      SELECT
        name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database = currentDatabase()
        AND name IN ('pm_validation_wallets_v1', 'pm_pnl_baseline_api_v1', 'pm_pnl_engine_results_v1')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  })
  const tables = await tablesResult.json() as Array<{name: string, engine: string, total_rows: number, size: string}>

  console.log('Tables created:')
  for (const t of tables) {
    console.log(`  ${t.name}: ${t.total_rows} rows, ${t.size}, engine=${t.engine}`)
  }

  // Show sample from validation wallets
  console.log('\nSample wallets from pm_validation_wallets_v1:')
  const sampleResult = await clickhouse.query({
    query: `
      SELECT wallet, cohort_tag, trade_count
      FROM pm_validation_wallets_v1 FINAL
      ORDER BY cohort_tag, wallet
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })
  const samples = await sampleResult.json() as Array<{wallet: string, cohort_tag: string, trade_count: number}>

  for (const s of samples) {
    console.log(`  ${s.cohort_tag}: ${s.wallet} (${s.trade_count} trades)`)
  }
}

async function main() {
  try {
    await createTables()
    await populateValidationWallets()
    await verifyTables()
    console.log('\n\nDone!')
    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
