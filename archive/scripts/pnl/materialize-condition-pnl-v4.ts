// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * materialize-condition-pnl-v4.ts
 *
 * Materializes the condition-level PnL view into a permanent table.
 * This is the CANONICAL PnL source for the platform.
 *
 * METHODOLOGY:
 * -----------
 * total_pnl = net_cash_flow + resolution_payout
 *
 * Where:
 * - net_cash_flow = sum(cash_delta_usdc) from trading
 * - resolution_payout = sum(max(0, net_shares) * outcome_won) per outcome
 *
 * NOTE: Numbers differ from Polymarket UI due to different data sources.
 * Our data is internally consistent and uses the correct accounting identity.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 3600000, // 60 minutes
})

const TABLE_NAME = 'pm_wallet_condition_pnl_v4'

async function runCommand(description: string, query: string): Promise<void> {
  console.log(`
[${new Date().toISOString()}] ${description}...`)
  const startTime = Date.now()
  try {
    await clickhouse.command({
      query,
      clickhouse_settings: { wait_end_of_query: 1, max_execution_time: 3600 },
    })
    console.log(`  Done in ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
  } catch (error) {
    console.error(`  FAILED after ${((Date.now() - startTime) / 1000).toFixed(2)}s`)
    throw error
  }
}

async function runQuery<T>(description: string, query: string): Promise<T[]> {
  console.log(`
[${new Date().toISOString()}] ${description}...`)
  const startTime = Date.now()
  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data = (await result.json()) as T[]
  console.log(`  Done in ${((Date.now() - startTime) / 1000).toFixed(2)}s (${data.length} rows)`)
  return data
}

function formatUSD(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`
  return `${sign}$${abs.toFixed(2)}`
}

async function main() {
  console.log('='.repeat(80))
  console.log('MATERIALIZING pm_wallet_condition_pnl_v4')
  console.log('='.repeat(80))
  console.log(`Started: ${new Date().toISOString()}`)

  // Step 1: Create temp table from view
  await runCommand('Creating temp table from view', `
    CREATE TABLE ${TABLE_NAME}_temp
    ENGINE = SharedMergeTree
    ORDER BY (wallet_address, condition_id)
    AS SELECT
      wallet_address,
      condition_id,
      net_cash_flow_usdc,
      total_fees_usdc,
      total_bought_usdc,
      total_sold_usdc,
      resolution_payout_usdc,
      total_pnl_usdc,
      now() as computed_at
    FROM vw_pm_wallet_condition_pnl_v4
  `)

  // Step 2: Get stats from temp table
  const stats = await runQuery<{
    total_rows: string
    unique_wallets: string
    unique_conditions: string
    total_pnl: string
    total_gains: string
    total_losses: string
  }>('Getting table statistics', `
    SELECT
      count() as total_rows,
      uniqExact(wallet_address) as unique_wallets,
      uniqExact(condition_id) as unique_conditions,
      sum(total_pnl_usdc) as total_pnl,
      sum(greatest(total_pnl_usdc, 0)) as total_gains,
      sum(least(total_pnl_usdc, 0)) as total_losses
    FROM ${TABLE_NAME}_temp
  `)

  if (stats.length > 0) {
    const s = stats[0]
    console.log('
=== TABLE STATISTICS ===')
    console.log(`  Total rows:      ${parseInt(s.total_rows).toLocaleString()}`)
    console.log(`  Unique wallets:  ${parseInt(s.unique_wallets).toLocaleString()}`)
    console.log(`  Unique conditions: ${parseInt(s.unique_conditions).toLocaleString()}`)
    console.log(`  Total PnL:       ${formatUSD(parseFloat(s.total_pnl))}`)
    console.log(`  Total Gains:     ${formatUSD(parseFloat(s.total_gains))}`)
    console.log(`  Total Losses:    ${formatUSD(parseFloat(s.total_losses))}`)
  }

  // Step 3: Verify identity holds (sample check)
  const identityCheck = await runQuery<{ wallet: string; identity_diff: string }>('Verifying identity for sample wallets', `
    SELECT
      wallet_address as wallet,
      abs(sum(net_cash_flow_usdc) + sum(resolution_payout_usdc) - sum(total_pnl_usdc)) as identity_diff
    FROM ${TABLE_NAME}_temp
    GROUP BY wallet_address
    HAVING identity_diff > 1
    LIMIT 10
  `)

  if (identityCheck.length > 0) {
    console.error('
!!! IDENTITY CHECK FAILED FOR SOME WALLETS !!!')
    for (const w of identityCheck) {
      console.error(`  ${w.wallet}: diff = ${w.identity_diff}`)
    }
  } else {
    console.log('
  Identity check PASSED for all wallets')
  }

  // Step 4: Drop old table and rename
  await runCommand('Dropping old table if exists', `DROP TABLE IF EXISTS ${TABLE_NAME}`)
  await runCommand('Renaming temp table', `RENAME TABLE ${TABLE_NAME}_temp TO ${TABLE_NAME}`)

  // Step 5: Verify calibration wallets
  console.log('
=== CALIBRATION WALLET CHECK ===')

  const wallets = [
    { addr: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', name: 'Theo' },
    { addr: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', name: 'Sports' },
  ]

  for (const w of wallets) {
    const result = await runQuery<{
      total_pnl: string
      gains: string
      losses: string
      conditions: string
    }>(`Checking ${w.name}`, `
      SELECT
        sum(total_pnl_usdc) as total_pnl,
        sum(greatest(total_pnl_usdc, 0)) as gains,
        sum(least(total_pnl_usdc, 0)) as losses,
        count() as conditions
      FROM ${TABLE_NAME}
      WHERE wallet_address = '${w.addr}'
    `)

    if (result.length > 0) {
      const r = result[0]
      console.log(`
  ${w.name}:`)
      console.log(`    Conditions: ${r.conditions}`)
      console.log(`    Total PnL:  ${formatUSD(parseFloat(r.total_pnl))}`)
      console.log(`    Gains:      ${formatUSD(parseFloat(r.gains))}`)
      console.log(`    Losses:     ${formatUSD(parseFloat(r.losses))}`)
    }
  }

  console.log('
' + '='.repeat(80))
  console.log('MATERIALIZATION COMPLETE')
  console.log('='.repeat(80))
  console.log(`Table: ${TABLE_NAME}`)
  console.log(`Finished: ${new Date().toISOString()}`)

  await clickhouse.close()
}

main().catch(console.error)
