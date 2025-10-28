#!/usr/bin/env tsx
/**
 * Test Pipeline - Small Scale
 *
 * PURPOSE:
 * Test the full overnight pipeline with just 5 wallets to verify everything works
 * before launching the full 8-12 hour production run.
 *
 * This runs all 4 phases but limits:
 * - Phase 2 (Goldsky): Only 5 wallets (instead of 2,838)
 * - Phase 3 (Enrichment): Only data from those 5 wallets
 * - Phase 4 (Reports): Only those 5 wallets in rankings
 *
 * Expected duration: 15-30 minutes total
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET_COUNT = 5
const PLAN_LOG = resolve(process.cwd(), 'runtime/test-pipeline.plan.jsonl')
const SUMMARY_FILE = resolve(process.cwd(), 'runtime/test-pipeline.summary.json')

interface PhaseResult {
  phase: string
  status: 'success' | 'failed'
  duration_minutes: number
  error?: string
}

/**
 * Get 5 random wallets from trades_raw for testing
 */
async function getTestWallets(): Promise<string[]> {
  console.log('🔍 Selecting 5 test wallets from ClickHouse...\n')

  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet_address
      FROM trades_raw
      ORDER BY rand()
      LIMIT ${TEST_WALLET_COUNT}
    `,
    format: 'JSONEachRow'
  })

  const rows = await result.json() as Array<{ wallet_address: string }>
  const wallets = rows.map(r => r.wallet_address)

  console.log('✅ Test wallets selected:')
  wallets.forEach((w, i) => console.log(`   ${i + 1}. ${w}`))
  console.log('')

  return wallets
}

/**
 * Create test version of goldsky loader with wallet filter
 */
async function createTestGoldskyLoader(testWallets: string[]): Promise<string> {
  const testFilePath = resolve(process.cwd(), 'scripts/goldsky-full-historical-load-TEST.ts')

  // Read original script
  const originalContent = fs.readFileSync(
    resolve(process.cwd(), 'scripts/goldsky-full-historical-load.ts'),
    'utf-8'
  )

  // Modify getTargetWallets to return only test wallets
  const modifiedContent = originalContent.replace(
    'async function getTargetWallets(): Promise<string[]> {',
    `async function getTargetWallets(): Promise<string[]> {
  // TEST MODE: Return predefined test wallets
  const testWallets = ${JSON.stringify(testWallets, null, 2)}
  console.log('[TEST MODE] Using ${testWallets.length} predefined test wallets')
  return testWallets

  /* ORIGINAL CODE (disabled for test):
`
  ).replace(
    '  return wallets\n}',
    '  return wallets\n  */\n}'
  )

  fs.writeFileSync(testFilePath, modifiedContent)
  return testFilePath
}

export async function main() {
  const pipelineStart = new Date()
  console.log('🧪 TEST PIPELINE - Small Scale (5 wallets)\n')
  console.log('This will test all 4 phases with minimal data\n')
  console.log('Expected duration: 15-30 minutes\n')
  console.log('═'.repeat(80) + '\n')

  const phaseResults: PhaseResult[] = []

  try {
    // Get test wallets
    const testWallets = await getTestWallets()

    // Create test version of Goldsky loader
    console.log('📝 Creating test version of goldsky loader...')
    const testLoaderPath = await createTestGoldskyLoader(testWallets)
    console.log(`✅ Test loader created: ${testLoaderPath}\n`)

    // Phase 1: Pre-test baseline
    try {
      console.log('🔍 Phase 1: Pre-test baseline snapshot')
      const startTime = Date.now()

      const { main: verifyMain } = await import('./verify-pre-overnight-state.js')
      await verifyMain()

      const duration = (Date.now() - startTime) / 1000 / 60
      console.log(`✅ Phase 1 complete (${duration.toFixed(1)} minutes)\n`)

      phaseResults.push({
        phase: 'Phase 1: Pre-test baseline',
        status: 'success',
        duration_minutes: parseFloat(duration.toFixed(1))
      })
    } catch (error: any) {
      console.error(`❌ Phase 1 failed:`, error.message)
      console.log('Continuing to next phase...\n')

      phaseResults.push({
        phase: 'Phase 1: Pre-test baseline',
        status: 'failed',
        duration_minutes: 0,
        error: error.message
      })
    }

    // Phase 2: Goldsky load (TEST - 5 wallets only)
    try {
      console.log('🌊 Phase 2: Goldsky historical load (5 wallets - TEST MODE)')
      const startTime = Date.now()

      const { main: goldskyMain } = await import('./goldsky-full-historical-load-TEST.js')
      await goldskyMain()

      const duration = (Date.now() - startTime) / 1000 / 60
      console.log(`✅ Phase 2 complete (${duration.toFixed(1)} minutes)\n`)

      phaseResults.push({
        phase: 'Phase 2: Goldsky load (5 wallets)',
        status: 'success',
        duration_minutes: parseFloat(duration.toFixed(1))
      })
    } catch (error: any) {
      console.error(`❌ Phase 2 failed:`, error.message)
      console.log('Continuing to next phase...\n')

      phaseResults.push({
        phase: 'Phase 2: Goldsky load (5 wallets)',
        status: 'failed',
        duration_minutes: 0,
        error: error.message
      })
    }

    // Phase 3: Full enrichment
    try {
      console.log('🔧 Phase 3: Full enrichment pass')
      const startTime = Date.now()

      const { main: enrichmentMain } = await import('./full-enrichment-pass.js')
      await enrichmentMain()

      const duration = (Date.now() - startTime) / 1000 / 60
      console.log(`✅ Phase 3 complete (${duration.toFixed(1)} minutes)\n`)

      phaseResults.push({
        phase: 'Phase 3: Full enrichment',
        status: 'success',
        duration_minutes: parseFloat(duration.toFixed(1))
      })
    } catch (error: any) {
      console.error(`❌ Phase 3 failed:`, error.message)
      console.log('Continuing to next phase...\n')

      phaseResults.push({
        phase: 'Phase 3: Full enrichment',
        status: 'failed',
        duration_minutes: 0,
        error: error.message
      })
    }

    // Phase 4: Generate reports
    try {
      console.log('📊 Phase 4: Generate final reports')
      const startTime = Date.now()

      const { main: reportsMain } = await import('./generate-final-reports.js')
      await reportsMain()

      const duration = (Date.now() - startTime) / 1000 / 60
      console.log(`✅ Phase 4 complete (${duration.toFixed(1)} minutes)\n`)

      phaseResults.push({
        phase: 'Phase 4: Generate reports',
        status: 'success',
        duration_minutes: parseFloat(duration.toFixed(1))
      })
    } catch (error: any) {
      console.error(`❌ Phase 4 failed:`, error.message)
      console.log('Continuing to summary...\n')

      phaseResults.push({
        phase: 'Phase 4: Generate reports',
        status: 'failed',
        duration_minutes: 0,
        error: error.message
      })
    }

  } catch (error: any) {
    console.error('❌ Test pipeline failed:', error.message)
    console.error(error.stack)
  }

  // Final summary
  const pipelineEnd = new Date()
  const totalMinutes = (pipelineEnd.getTime() - pipelineStart.getTime()) / 1000 / 60
  const totalHours = totalMinutes / 60

  const successfulPhases = phaseResults.filter(p => p.status === 'success').length
  const failedPhases = phaseResults.filter(p => p.status === 'failed').length

  let overallStatus: 'success' | 'partial' | 'failed'
  if (failedPhases === 0) {
    overallStatus = 'success'
  } else if (successfulPhases > 0) {
    overallStatus = 'partial'
  } else {
    overallStatus = 'failed'
  }

  // Scan for generated files
  const runtimeDir = resolve(process.cwd(), 'runtime')
  const allFiles = fs.existsSync(runtimeDir) ? fs.readdirSync(runtimeDir) : []
  const filesGenerated = allFiles.filter(f =>
    f.includes('test-pipeline') ||
    f.includes('final-summary') ||
    f.includes('progress.jsonl') ||
    f.includes('baseline')
  ).map(f => `runtime/${f}`)

  const summary = {
    pipeline_start: pipelineStart.toISOString(),
    pipeline_end: pipelineEnd.toISOString(),
    total_duration_minutes: parseFloat(totalMinutes.toFixed(1)),
    total_duration_hours: parseFloat(totalHours.toFixed(2)),
    phase_results: phaseResults,
    overall_status: overallStatus,
    successful_phases: successfulPhases,
    failed_phases: failedPhases,
    test_wallet_count: TEST_WALLET_COUNT,
    files_generated: filesGenerated
  }

  // Write summary
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2))

  // Console output
  console.log('═'.repeat(80))
  console.log('🧪 TEST PIPELINE COMPLETE')
  console.log('═'.repeat(80))
  console.log('')
  console.log(`Overall Status: ${overallStatus.toUpperCase()}`)
  console.log(`Total Duration: ${totalHours.toFixed(2)} hours (${totalMinutes.toFixed(1)} minutes)`)
  console.log(`Successful Phases: ${successfulPhases}/${phaseResults.length}`)
  console.log(`Failed Phases: ${failedPhases}/${phaseResults.length}`)
  console.log(`Test Wallets: ${TEST_WALLET_COUNT}`)
  console.log('')
  console.log('Phase Results:')
  console.log('─'.repeat(80))

  phaseResults.forEach(result => {
    const icon = result.status === 'success' ? '✅' : '❌'
    console.log(`${icon} ${result.phase}`)
    console.log(`   Duration: ${result.duration_minutes} minutes`)
    console.log(`   Status: ${result.status}`)
    if (result.error) {
      console.log(`   Error: ${result.error}`)
    }
    console.log('')
  })

  console.log('Files Generated:')
  console.log('─'.repeat(80))
  filesGenerated.forEach(file => console.log(`   - ${file}`))
  console.log('')

  console.log(`Summary saved to: ${SUMMARY_FILE}`)
  console.log('')

  if (overallStatus === 'success') {
    console.log('✅ TEST PASSED - Ready for full overnight run!')
    console.log('')
    console.log('To launch full production run:')
    console.log('  nohup npx tsx scripts/overnight-orchestrator.ts >> runtime/overnight-orchestrator.console.log 2>&1 &')
  } else if (overallStatus === 'partial') {
    console.log('⚠️  TEST PARTIALLY PASSED - Some phases failed, review errors above')
  } else {
    console.log('❌ TEST FAILED - Fix errors before production run')
  }

  console.log('')

  return summary
}

// DO NOT auto-execute
// Call main() explicitly when ready
