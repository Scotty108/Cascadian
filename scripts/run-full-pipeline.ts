/**
 * Full Data Pipeline Orchestrator
 *
 * Runs the complete TSI data pipeline in sequence:
 * 1. Bulk sync wallet trades to ClickHouse (2-4 hours)
 * 2. Enrich trades with P&L data (30-60 min)
 * 3. Calculate Tier 1 metrics (2-5 min)
 *
 * Usage: npx tsx scripts/run-full-pipeline.ts
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'

interface PipelineStep {
  name: string
  script: string
  estimatedTime: string
  required: boolean
}

const PIPELINE_STEPS: PipelineStep[] = [
  {
    name: 'Bulk Sync Wallet Trades',
    script: 'scripts/sync-all-wallets-bulk.ts',
    estimatedTime: '2-4 hours',
    required: true,
  },
  {
    name: 'Enrich Trades with P&L',
    script: 'scripts/enrich-trades.ts',
    estimatedTime: '30-60 minutes',
    required: true,
  },
  {
    name: 'Calculate Tier 1 Metrics',
    script: 'scripts/calculate-tier1-metrics.ts',
    estimatedTime: '2-5 minutes',
    required: true,
  },
]

function printBanner() {
  console.log('\n')
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║                                                           ║')
  console.log('║        🚀 TSI DATA PIPELINE ORCHESTRATOR 🚀              ║')
  console.log('║                                                           ║')
  console.log('║  Automated execution of the full data pipeline           ║')
  console.log('║                                                           ║')
  console.log('╚═══════════════════════════════════════════════════════════╝\n')
}

function printPipelineOverview() {
  console.log('📋 PIPELINE STEPS:\n')
  PIPELINE_STEPS.forEach((step, i) => {
    console.log(`${i + 1}. ${step.name}`)
    console.log(`   Script: ${step.script}`)
    console.log(`   Estimated: ${step.estimatedTime}`)
    console.log()
  })

  const totalEstimate = '3-5 hours'
  console.log(`⏱️  Total Estimated Time: ${totalEstimate}\n`)
  console.log('═══════════════════════════════════════════════════════════\n')
}

async function runStep(step: PipelineStep, stepNumber: number): Promise<boolean> {
  console.log('\n┌─────────────────────────────────────────────────────────┐')
  console.log(`│  STEP ${stepNumber}/${PIPELINE_STEPS.length}: ${step.name.padEnd(48)}│`)
  console.log('└─────────────────────────────────────────────────────────┘\n')

  // Verify script exists
  if (!existsSync(step.script)) {
    console.error(`❌ Script not found: ${step.script}`)
    return false
  }

  console.log(`📂 Script: ${step.script}`)
  console.log(`⏱️  Estimated time: ${step.estimatedTime}`)
  console.log(`🚀 Starting...\n`)

  const startTime = Date.now()

  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', step.script], {
      stdio: 'inherit',
      shell: true,
    })

    child.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

      if (code === 0) {
        console.log(`\n✅ Step ${stepNumber} completed successfully in ${elapsed} minutes`)
        resolve(true)
      } else {
        console.error(`\n❌ Step ${stepNumber} failed with code ${code}`)
        resolve(false)
      }
    })

    child.on('error', (error) => {
      console.error(`\n❌ Error running step ${stepNumber}:`, error.message)
      resolve(false)
    })
  })
}

async function main() {
  printBanner()
  printPipelineOverview()

  console.log('⚠️  This will run for 3-5 hours. You can safely close this terminal.')
  console.log('   Logs will be displayed in real-time.\n')

  const pipelineStartTime = Date.now()
  const results: { step: string; success: boolean; time: number }[] = []

  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    const step = PIPELINE_STEPS[i]
    const stepStartTime = Date.now()

    const success = await runStep(step, i + 1)
    const stepTime = (Date.now() - stepStartTime) / 1000 / 60

    results.push({
      step: step.name,
      success,
      time: stepTime,
    })

    if (!success && step.required) {
      console.error('\n❌ PIPELINE FAILED: Required step failed')
      console.error(`   Failed step: ${step.name}`)
      console.error('   Cannot continue to next steps\n')
      printSummary(results, pipelineStartTime)
      process.exit(1)
    }

    if (i < PIPELINE_STEPS.length - 1) {
      console.log('\n⏭️  Moving to next step...\n')
    }
  }

  printSummary(results, pipelineStartTime)
}

function printSummary(
  results: { step: string; success: boolean; time: number }[],
  pipelineStartTime: number
) {
  console.log('\n')
  console.log('═══════════════════════════════════════════════════════════')
  console.log('           📊 PIPELINE EXECUTION SUMMARY 📊                ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const totalTime = (Date.now() - pipelineStartTime) / 1000 / 60

  results.forEach((result, i) => {
    const icon = result.success ? '✅' : '❌'
    console.log(`${i + 1}. ${icon} ${result.step}`)
    console.log(`   Time: ${result.time.toFixed(1)} minutes`)
    console.log()
  })

  const successful = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length

  console.log('═══════════════════════════════════════════════════════════')
  console.log(`✅ Successful: ${successful}/${results.length}`)
  console.log(`❌ Failed: ${failed}/${results.length}`)
  console.log(`⏱️  Total Time: ${totalTime.toFixed(1)} minutes (${(totalTime / 60).toFixed(2)} hours)`)
  console.log('═══════════════════════════════════════════════════════════\n')

  if (failed === 0) {
    console.log('🎉 PIPELINE COMPLETED SUCCESSFULLY! 🎉\n')
    console.log('📝 NEXT STEPS:\n')
    console.log('1. Refresh your browser')
    console.log('2. Visit the demo pages:')
    console.log('   - /demo/tsi-signals')
    console.log('   - /demo/top-wallets')
    console.log('   - /demo/category-leaderboard')
    console.log('3. Verify real data is loading\n')
    console.log('✨ Your TSI Momentum Trading System is now LIVE! ✨\n')
  } else {
    console.log('⚠️  PIPELINE COMPLETED WITH ERRORS\n')
    console.log('📝 Check the logs above for error details\n')
  }
}

// Handle CTRL+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Pipeline interrupted by user (CTRL+C)')
  console.log('   You can restart the pipeline at any time\n')
  process.exit(0)
})

main().catch((error) => {
  console.error('\n❌ Fatal pipeline error:', error)
  process.exit(1)
})
