#!/usr/bin/env npx tsx
/**
 * Finalize All Data Pipeline Outputs
 *
 * Master script that runs all finalization steps after background jobs complete:
 * 1. Verify dimension build completed successfully
 * 2. Finalize market_id lookup results (JSONL → JSON)
 * 3. Generate wallet category breakdown
 *
 * Prerequisites:
 * - Dimension build job must be complete (markets_dim_seed.json + events_dim_seed.json)
 * - Market_id backfill job must be complete (market_id_lookup_results.jsonl)
 *
 * Outputs:
 * - data/market_id_lookup_results.json
 * - data/wallet_category_breakdown.json
 * - Final summary report
 */

import { resolve } from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'

interface JobStatus {
  name: string
  complete: boolean
  outputFile: string
  reason?: string
}

/**
 * Check if dimension build job completed
 */
function checkDimensionBuildStatus(): JobStatus {
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const eventsPath = resolve(process.cwd(), 'data/events_dim_seed.json')
  const logPath = resolve(process.cwd(), 'data/dimension-build.log')

  if (!fs.existsSync(marketsPath)) {
    return {
      name: 'Dimension Build',
      complete: false,
      outputFile: marketsPath,
      reason: 'markets_dim_seed.json not found'
    }
  }

  if (!fs.existsSync(eventsPath)) {
    return {
      name: 'Dimension Build',
      complete: false,
      outputFile: eventsPath,
      reason: 'events_dim_seed.json not found'
    }
  }

  // Check log for completion message
  if (fs.existsSync(logPath)) {
    const log = fs.readFileSync(logPath, 'utf-8')
    if (!log.includes('✅ DIMENSION BUILD COMPLETE')) {
      return {
        name: 'Dimension Build',
        complete: false,
        outputFile: logPath,
        reason: 'Job still running (no completion marker in log)'
      }
    }
  }

  // Verify files are not empty
  const marketsSize = fs.statSync(marketsPath).size
  const eventsSize = fs.statSync(eventsPath).size

  if (marketsSize < 100 || eventsSize < 100) {
    return {
      name: 'Dimension Build',
      complete: false,
      outputFile: marketsPath,
      reason: 'Output files are too small (may be incomplete)'
    }
  }

  return {
    name: 'Dimension Build',
    complete: true,
    outputFile: marketsPath
  }
}

/**
 * Check if market_id backfill job completed
 */
function checkBackfillStatus(): JobStatus {
  const jsonlPath = resolve(process.cwd(), 'data/market_id_lookup_results.jsonl')
  const logPath = resolve(process.cwd(), 'data/backfill-run.log')

  if (!fs.existsSync(jsonlPath)) {
    return {
      name: 'Market_ID Backfill',
      complete: false,
      outputFile: jsonlPath,
      reason: 'market_id_lookup_results.jsonl not found'
    }
  }

  // Check log for completion message
  if (fs.existsSync(logPath)) {
    const log = fs.readFileSync(logPath, 'utf-8')
    if (!log.includes('✅ BATCH LOOKUP COMPLETE')) {
      return {
        name: 'Market_ID Backfill',
        complete: false,
        outputFile: logPath,
        reason: 'Job still running (no completion marker in log)'
      }
    }
  }

  // Count lines in JSONL
  const content = fs.readFileSync(jsonlPath, 'utf-8')
  const lines = content.trim().split('\n').filter(l => l).length

  if (lines < 1000) {
    return {
      name: 'Market_ID Backfill',
      complete: false,
      outputFile: jsonlPath,
      reason: `Only ${lines} mappings found (expected ~44K)`
    }
  }

  return {
    name: 'Market_ID Backfill',
    complete: true,
    outputFile: jsonlPath
  }
}

/**
 * Run a script and capture output
 */
function runScript(scriptPath: string, description: string): boolean {
  try {
    console.log(`\n▶️  ${description}`)
    console.log('─'.repeat(50))

    const output = execSync(`npx tsx ${scriptPath}`, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: 'inherit'
    })

    console.log('─'.repeat(50))
    console.log(`✅ ${description} completed\n`)
    return true
  } catch (error) {
    console.error(`❌ ${description} failed:`, error)
    return false
  }
}

async function main() {
  console.log('🎯 FINALIZING ALL DATA PIPELINE OUTPUTS')
  console.log('================================================\n')

  // Step 1: Check prerequisites
  console.log('📋 Checking prerequisites...\n')

  const dimensionStatus = checkDimensionBuildStatus()
  const backfillStatus = checkBackfillStatus()

  console.log(`   ${dimensionStatus.complete ? '✅' : '❌'} ${dimensionStatus.name}`)
  if (!dimensionStatus.complete) {
    console.log(`      Reason: ${dimensionStatus.reason}`)
  }

  console.log(`   ${backfillStatus.complete ? '✅' : '❌'} ${backfillStatus.name}`)
  if (!backfillStatus.complete) {
    console.log(`      Reason: ${backfillStatus.reason}`)
  }

  console.log('')

  // Abort if prerequisites not met
  if (!dimensionStatus.complete || !backfillStatus.complete) {
    console.error('❌ Prerequisites not met. Please wait for background jobs to complete.')
    console.error('\nRun this command to check progress:')
    console.error('   npx tsx scripts/check-progress.ts\n')
    process.exit(1)
  }

  console.log('✅ All prerequisites met. Starting finalization...\n')

  // Step 2: Finalize market_id lookup
  const step1Success = runScript(
    'scripts/finalize-market-id-lookup.ts',
    'Step 1: Finalize Market_ID Lookup'
  )

  if (!step1Success) {
    console.error('❌ Failed at Step 1. Aborting.\n')
    process.exit(1)
  }

  // Step 3: Generate wallet category breakdown
  const step2Success = runScript(
    'scripts/generate-wallet-category-breakdown.ts',
    'Step 2: Generate Wallet Category Breakdown'
  )

  if (!step2Success) {
    console.error('❌ Failed at Step 2. Aborting.\n')
    process.exit(1)
  }

  // Step 4: Generate final summary
  console.log('\n▶️  Step 3: Generating Final Summary')
  console.log('─'.repeat(50))

  const dataDir = resolve(process.cwd(), 'data')

  // List all output files
  const outputs = [
    'markets_dim_seed.json',
    'events_dim_seed.json',
    'market_id_lookup_results.json',
    'wallet_category_breakdown.json'
  ]

  console.log('\n📊 Final Output Files:\n')

  for (const filename of outputs) {
    const filepath = resolve(dataDir, filename)
    if (fs.existsSync(filepath)) {
      const stats = fs.statSync(filepath)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
      console.log(`   ✅ ${filename} (${sizeMB} MB)`)
    } else {
      console.log(`   ❌ ${filename} (NOT FOUND)`)
    }
  }

  console.log('')
  console.log('─'.repeat(50))
  console.log('✅ Step 3: Final Summary completed\n')

  // Read wallet category breakdown for summary stats
  const walletCategoryPath = resolve(dataDir, 'wallet_category_breakdown.json')
  if (fs.existsSync(walletCategoryPath)) {
    const data = JSON.parse(fs.readFileSync(walletCategoryPath, 'utf-8'))

    console.log('📈 WALLET COVERAGE SUMMARY')
    console.log('================================================\n')

    // Calculate coverage distribution
    const wallets = data.wallets || []
    const coverage50Plus = wallets.filter((w: any) => w.overall_stats.coverage_pct >= 50).length
    const coverage80Plus = wallets.filter((w: any) => w.overall_stats.coverage_pct >= 80).length
    const coverage95Plus = wallets.filter((w: any) => w.overall_stats.coverage_pct >= 95).length

    console.log(`Total wallets: ${wallets.length}`)
    console.log(`Wallets with ≥50% coverage: ${coverage50Plus} (${((coverage50Plus / wallets.length) * 100).toFixed(1)}%)`)
    console.log(`Wallets with ≥80% coverage: ${coverage80Plus} (${((coverage80Plus / wallets.length) * 100).toFixed(1)}%)`)
    console.log(`Wallets with ≥95% coverage: ${coverage95Plus} (${((coverage95Plus / wallets.length) * 100).toFixed(1)}%)`)
    console.log('')

    // Show sample wallet summaries
    console.log('📝 SAMPLE WALLET SUMMARIES:\n')
    const samples = wallets.slice(0, 5)
    for (const wallet of samples) {
      console.log(`   ${wallet.summary_text}`)
    }
    console.log('')
  }

  console.log('================================================')
  console.log('🎉 ALL FINALIZATION STEPS COMPLETE!')
  console.log('================================================\n')

  console.log('Next steps:')
  console.log('1. Review data/market_id_lookup_results.json for condition→market mappings')
  console.log('2. Review data/wallet_category_breakdown.json for per-wallet category P&L')
  console.log('3. Apply backfill to ClickHouse (when ready):')
  console.log('   npx tsx scripts/apply-market-id-backfill.ts')
  console.log('')
}

main().catch(console.error)
