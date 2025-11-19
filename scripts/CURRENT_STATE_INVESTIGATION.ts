/**
 * CURRENT STATE INVESTIGATION
 * 
 * Goal: Get brutally honest assessment of what we HAVE vs what we NEED
 * for P&L calculation.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

// Load .env.local explicitly
dotenv.config({ path: path.join(__dirname, '.env.local') })

import { getClickHouseClient } from './lib/clickhouse/client'

const client = getClickHouseClient()

async function runQuery(name: string, query: string): Promise<any[]> {
  const separator = '='.repeat(80)
  const dashedLine = '-'.repeat(80)
  
  console.log(`\n${separator}`)
  console.log(`QUERY: ${name}`)
  console.log(separator)
  console.log(query.trim())
  console.log(dashedLine)
  
  try {
    const result = await client.query({ query, format: 'JSONEachRow' })
    const data = await result.json() as any[]
    console.log(JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error('ERROR:', error instanceof Error ? error.message : error)
    return []
  }
}

async function investigate() {
  const separator = '='.repeat(80)
  
  console.log('\n🔍 CURRENT STATE INVESTIGATION - P&L SYSTEM')
  console.log(separator)
  console.log('Timestamp:', new Date().toISOString())
  
  // SECTION 1: What data do we HAVE?
  console.log('\n\n📊 SECTION 1: WHAT DATA DO WE HAVE?\n')
  
  await runQuery('1.1: List All Databases', `
    SELECT name, engine
    FROM system.databases
    ORDER BY name
  `)
  
  await runQuery('1.2: Trades Table Status (vw_trades_canonical)', `
    SELECT 
      COUNT(*) as total_trades,
      MIN(block_timestamp) as earliest_trade,
      MAX(block_timestamp) as latest_trade,
      COUNT(DISTINCT wallet_address) as unique_wallets,
      COUNT(DISTINCT condition_id) as unique_condition_ids,
      COUNT(DISTINCT CASE WHEN condition_id != '' AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000' THEN condition_id END) as non_empty_condition_ids
    FROM cascadian_clean.vw_trades_canonical
  `)
  
  await runQuery('1.3: Resolution Tables in cascadian_clean', `
    SELECT 
      name,
      engine,
      total_rows,
      formatReadableSize(total_bytes) as size
    FROM system.tables
    WHERE database = 'cascadian_clean'
      AND (name LIKE '%resolution%' OR name LIKE '%payout%')
    ORDER BY total_rows DESC
  `)
  
  await runQuery('1.4: Resolution Tables in default database', `
    SELECT 
      name,
      engine,
      total_rows,
      formatReadableSize(total_bytes) as size
    FROM system.tables
    WHERE database = 'default'
      AND (name LIKE '%resolution%' OR name LIKE '%payout%')
    ORDER BY total_rows DESC
  `)
  
  await runQuery('1.5: P&L Views and Tables', `
    SELECT 
      database,
      name,
      engine,
      total_rows,
      formatReadableSize(total_bytes) as size
    FROM system.tables
    WHERE (name LIKE '%pnl%' OR name LIKE '%wallet_position%' OR name LIKE '%wallet_metric%')
    ORDER BY database, total_rows DESC
  `)
  
  // SECTION 2: What's ACTUALLY working?
  console.log('\n\n✅ SECTION 2: WHAT IS ACTUALLY WORKING?\n')
  
  await runQuery('2.1: Test vw_wallet_pnl_closed (if exists)', `
    SELECT 
      COUNT(*) as total_wallets,
      SUM(total_pnl_usd) as total_pnl,
      AVG(total_pnl_usd) as avg_pnl,
      COUNT(CASE WHEN total_pnl_usd > 0 THEN 1 END) as profitable_wallets,
      COUNT(CASE WHEN total_pnl_usd < 0 THEN 1 END) as losing_wallets
    FROM cascadian_clean.vw_wallet_pnl_closed
    LIMIT 1
  `)
  
  await runQuery('2.2: Sample Wallet P&L (burrito338)', `
    SELECT 
      wallet_address,
      total_pnl_usd,
      trading_pnl,
      unrealized_pnl,
      settled_positions,
      active_positions
    FROM cascadian_clean.vw_wallet_pnl_all
    WHERE lower(wallet_address) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    LIMIT 1
  `)
  
  await runQuery('2.3: Resolution Coverage Analysis', `
    SELECT 
      'market_resolutions_final' as source,
      COUNT(*) as total_resolutions,
      COUNT(DISTINCT condition_id) as unique_conditions
    FROM default.market_resolutions_final
    UNION ALL
    SELECT 
      'resolutions_by_cid' as source,
      COUNT(*) as total_resolutions,
      COUNT(DISTINCT cid_hex) as unique_conditions
    FROM cascadian_clean.resolutions_by_cid
  `)
  
  // SECTION 3: The REAL gap
  console.log('\n\n🔍 SECTION 3: THE REAL GAP\n')
  
  await runQuery('3.1: Trade-to-Resolution Join Coverage', `
    WITH trades AS (
      SELECT DISTINCT 
        lower(replaceAll(condition_id, '0x', '')) as cid_norm
      FROM cascadian_clean.vw_trades_canonical
      WHERE condition_id != ''
        AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    ),
    resolutions AS (
      SELECT DISTINCT
        lower(replaceAll(condition_id, '0x', '')) as cid_norm
      FROM default.market_resolutions_final
    )
    SELECT 
      (SELECT COUNT(*) FROM trades) as total_traded_conditions,
      (SELECT COUNT(*) FROM resolutions) as total_resolved_conditions,
      COUNT(*) as matching_conditions,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM trades), 2) as coverage_pct
    FROM trades t
    INNER JOIN resolutions r ON t.cid_norm = r.cid_norm
  `)
  
  await runQuery('3.2: Coverage by Trade Volume', `
    WITH trades_with_match AS (
      SELECT 
        t.condition_id,
        t.usdc_amount,
        CASE 
          WHEN r.condition_id IS NOT NULL THEN 1 
          ELSE 0 
        END as has_resolution
      FROM cascadian_clean.vw_trades_canonical t
      LEFT JOIN default.market_resolutions_final r 
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(replaceAll(r.condition_id, '0x', ''))
      WHERE t.condition_id != ''
        AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    )
    SELECT 
      COUNT(*) as total_trades,
      SUM(usdc_amount) as total_volume,
      SUM(CASE WHEN has_resolution = 1 THEN 1 ELSE 0 END) as trades_with_resolution,
      SUM(CASE WHEN has_resolution = 1 THEN usdc_amount ELSE 0 END) as volume_with_resolution,
      ROUND(SUM(CASE WHEN has_resolution = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as trade_coverage_pct,
      ROUND(SUM(CASE WHEN has_resolution = 1 THEN usdc_amount ELSE 0 END) * 100.0 / SUM(usdc_amount), 2) as volume_coverage_pct
    FROM trades_with_match
  `)
  
  // SECTION 4: Sanity Check
  console.log('\n\n🚀 SECTION 4: SANITY CHECK - CAN WE SHIP TODAY?\n')
  
  await runQuery('4.1: Top 10 Wallets by P&L (if calculable)', `
    SELECT 
      wallet_address,
      total_pnl_usd,
      trading_pnl,
      settled_positions,
      active_positions,
      win_rate_pct,
      roi_pct
    FROM cascadian_clean.vw_wallet_pnl_closed
    ORDER BY total_pnl_usd DESC
    LIMIT 10
  `)
  
  await runQuery('4.2: Modern Era P&L (June 2024+)', `
    WITH modern_trades AS (
      SELECT 
        t.wallet_address,
        t.condition_id,
        t.outcome_index,
        t.shares,
        t.usdc_amount as cost_basis,
        r.winning_index,
        r.payout_numerators,
        r.payout_denominator
      FROM cascadian_clean.vw_trades_canonical t
      LEFT JOIN default.market_resolutions_final r 
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(replaceAll(r.condition_id, '0x', ''))
      WHERE t.block_timestamp >= '2024-06-01'
        AND t.condition_id != ''
        AND r.condition_id IS NOT NULL
      LIMIT 1000
    )
    SELECT 
      COUNT(*) as sample_trades,
      COUNT(DISTINCT wallet_address) as sample_wallets,
      COUNT(CASE WHEN winning_index IS NOT NULL THEN 1 END) as calculable_pnl,
      ROUND(COUNT(CASE WHEN winning_index IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 2) as calculable_pct
    FROM modern_trades
  `)
  
  await runQuery('4.3: Wallet P&L Coverage Distribution', `
    WITH wallet_stats AS (
      SELECT 
        t.wallet_address,
        COUNT(*) as total_positions,
        COUNT(CASE WHEN r.condition_id IS NOT NULL THEN 1 END) as resolved_positions
      FROM cascadian_clean.vw_trades_canonical t
      LEFT JOIN default.market_resolutions_final r 
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(replaceAll(r.condition_id, '0x', ''))
      WHERE t.condition_id != ''
      GROUP BY t.wallet_address
    )
    SELECT 
      COUNT(*) as total_wallets,
      COUNT(CASE WHEN resolved_positions > 0 THEN 1 END) as wallets_with_some_pnl,
      ROUND(COUNT(CASE WHEN resolved_positions > 0 THEN 1 END) * 100.0 / COUNT(*), 2) as wallet_coverage_pct,
      AVG(resolved_positions * 100.0 / total_positions) as avg_position_coverage_pct
    FROM wallet_stats
  `)
  
  // SECTION 5: Sample P&L Test
  console.log('\n\n🧪 SECTION 5: SAMPLE P&L CALCULATION TEST\n')
  
  await runQuery('5.1: Test P&L Calculation on 10 Random Wallets', `
    WITH sample_wallets AS (
      SELECT DISTINCT wallet_address
      FROM cascadian_clean.vw_trades_canonical
      WHERE condition_id != ''
      ORDER BY rand()
      LIMIT 10
    ),
    wallet_pnl AS (
      SELECT 
        t.wallet_address,
        COUNT(DISTINCT t.condition_id) as total_positions,
        COUNT(DISTINCT CASE WHEN r.condition_id IS NOT NULL THEN t.condition_id END) as resolved_positions,
        SUM(CASE 
          WHEN r.winning_index IS NOT NULL 
          THEN t.shares * (arrayElement(r.payout_numerators, t.outcome_index + 1) / r.payout_denominator) - t.usdc_amount
          ELSE 0
        END) as total_pnl
      FROM cascadian_clean.vw_trades_canonical t
      INNER JOIN sample_wallets s ON t.wallet_address = s.wallet_address
      LEFT JOIN default.market_resolutions_final r 
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(replaceAll(r.condition_id, '0x', ''))
      WHERE t.condition_id != ''
      GROUP BY t.wallet_address
    )
    SELECT 
      wallet_address,
      total_positions,
      resolved_positions,
      ROUND(total_pnl, 2) as total_pnl_usd,
      ROUND(resolved_positions * 100.0 / total_positions, 2) as coverage_pct
    FROM wallet_pnl
    ORDER BY total_pnl_usd DESC
  `)
  
  console.log('\n' + separator)
  console.log('INVESTIGATION COMPLETE')
  console.log(separator)
}

investigate()
  .then(() => {
    console.log('\n✅ Investigation completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Investigation failed:', error)
    process.exit(1)
  })
