#!/usr/bin/env tsx
/**
 * Overnight Orchestrator (Master Runner)
 *
 * PURPOSE:
 * This is the ONLY script you nohup overnight.
 * It orchestrates all phases of the historical data load and enrichment.
 *
 * PHASES:
 * 1. verify-pre-overnight-state - Baseline snapshot before load
 * 2. goldsky-full-historical-load - Fetch 6-10M trades from Goldsky
 * 3. full-enrichment-pass - Complete enrichment including:
 *    - market_id backfill
 *    - resolution data refresh
 *    - P&L calculation
 *    - Resolution accuracy for ALL 2,838 wallets
 * 4. generate-final-reports - Demo-ready JSON outputs
 *
 * RESOLUTION ACCURACY:
 * Phase 3 (step E) recomputes wallet_resolution_outcomes for ALL wallets.
 * This is where we measure: "Were they actually right about outcomes?"
 * Resolution accuracy % = AVG(won) * 100, where won = 1 if final_side === resolved_outcome
 *
 * MONITORING:
 * - Logs to runtime/overnight-orchestrator.log
 * - Progress tracked in runtime/overnight-orchestrator.plan.jsonl
 * - Each phase logs to its own runtime/*.progress.jsonl
 *
 * USAGE:
 * nohup npx tsx scripts/overnight-orchestrator.ts >> runtime/overnight-orchestrator.console.log 2>&1 &
 * echo $! > runtime/overnight-orchestrator.pid
 *
 * ERROR HANDLING:
 * Each phase has try/catch error handling. If a phase fails, the orchestrator
 * logs the error and continues to the next phase. Final summary shows which
 * phases succeeded/failed with durations and error messages.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'

const PLAN_LOG = resolve(process.cwd(), 'runtime/overnight-orchestrator.plan.jsonl')
const SUMMARY_LOG = resolve(process.cwd(), 'runtime/overnight-orchestrator.summary.json')

interface OrchestratorPlan {
  timestamp: string
  estimated_duration_hours: number
  phases: Array<{
    phase: string
    description: string
    estimated_duration: string
    script: string
  }>
}

interface PhaseResult {
  phase: string
  status: 'success' | 'failed'
  duration_minutes: number
  error?: string
}

interface FinalSummary {
  pipeline_start: string
  pipeline_end: string
  total_duration_minutes: number
  total_duration_hours: number
  phase_results: PhaseResult[]
  overall_status: 'success' | 'partial' | 'failed'
  successful_phases: number
  failed_phases: number
  files_generated: string[]
}

/**
 * Main execution function
 *
 * Orchestrates all overnight phases in sequence.
 * Each phase has error handling and duration tracking.
 */
export async function main() {
  const pipelineStart = Date.now()
  const pipelineStartISO = new Date().toISOString()

  console.log('🌙 Overnight Orchestrator Starting\n')

  const plan: OrchestratorPlan = {
    timestamp: pipelineStartISO,
    estimated_duration_hours: 10,
    phases: [
      {
        phase: 'Phase 1',
        description: 'Pre-overnight state verification (baseline snapshot)',
        estimated_duration: '5 minutes',
        script: 'scripts/verify-pre-overnight-state.ts'
      },
      {
        phase: 'Phase 2',
        description: 'Goldsky full historical trade load (fetch 6-10M trades)',
        estimated_duration: '6-8 hours',
        script: 'scripts/goldsky-full-historical-load.ts'
      },
      {
        phase: 'Phase 3',
        description: 'Full enrichment pass (market_id, P&L, resolutions) and recompute wallet_resolution_outcomes for ALL wallets with resolution accuracy (% of times they were on the correct side when markets actually resolved)',
        estimated_duration: '2-3 hours',
        script: 'scripts/full-enrichment-pass.ts'
      },
      {
        phase: 'Phase 4',
        description: 'Generate final reports (emit final JSON including global avg resolution accuracy and per-wallet conviction accuracy)',
        estimated_duration: '10 minutes',
        script: 'scripts/generate-final-reports.ts'
      }
    ]
  }

  // Write plan to JSONL
  const planLine = JSON.stringify(plan) + '\n'
  fs.appendFileSync(PLAN_LOG, planLine)

  console.log('📋 Overnight Load Plan:')
  console.log(`   Estimated Duration: ${plan.estimated_duration_hours} hours`)
  console.log('')

  for (const phase of plan.phases) {
    console.log(`   ${phase.phase}: ${phase.description}`)
    console.log(`      Script: ${phase.script}`)
    console.log(`      Duration: ${phase.estimated_duration}`)
    console.log('')
  }

  console.log('🔑 Key Deliverable: Resolution Accuracy')
  console.log('   Phase 3 (Step E) will recompute wallet_resolution_outcomes for ALL wallets.')
  console.log('   This measures: "Were they actually right about outcomes?"')
  console.log('   Formula: resolution_accuracy_pct = AVG(won) * 100')
  console.log('   Where won = 1 if final_side === resolved_outcome, else 0')
  console.log('')

  console.log('🚀 Starting Execution\n')

  // Track results for each phase
  const phaseResults: PhaseResult[] = []

  // ============================================================================
  // PHASE 1: PRE-OVERNIGHT VERIFICATION
  // ============================================================================
  try {
    console.log('🔍 Phase 1: Pre-overnight verification')
    const startTime = Date.now()
    const { main: verifyMain } = await import('./verify-pre-overnight-state.js')
    await verifyMain()
    const duration = (Date.now() - startTime) / 1000 / 60
    console.log(`✅ Phase 1 complete (${duration.toFixed(1)} minutes)\n`)
    phaseResults.push({
      phase: 'Phase 1: Pre-overnight verification',
      status: 'success',
      duration_minutes: parseFloat(duration.toFixed(1))
    })
  } catch (error) {
    const duration = (Date.now() - pipelineStart) / 1000 / 60
    console.error(`❌ Phase 1 failed:`, error)
    console.log('Continuing to next phase...\n')
    phaseResults.push({
      phase: 'Phase 1: Pre-overnight verification',
      status: 'failed',
      duration_minutes: parseFloat(duration.toFixed(1)),
      error: error instanceof Error ? error.message : String(error)
    })
  }

  // ============================================================================
  // PHASE 2: GOLDSKY HISTORICAL LOAD
  // ============================================================================
  try {
    console.log('🌊 Phase 2: Goldsky historical load')
    const startTime = Date.now()
    const { main: goldskyMain } = await import('./goldsky-full-historical-load.js')
    await goldskyMain()
    const duration = (Date.now() - startTime) / 1000 / 60
    console.log(`✅ Phase 2 complete (${duration.toFixed(1)} minutes)\n`)
    phaseResults.push({
      phase: 'Phase 2: Goldsky historical load',
      status: 'success',
      duration_minutes: parseFloat(duration.toFixed(1))
    })
  } catch (error) {
    const duration = (Date.now() - pipelineStart) / 1000 / 60
    console.error(`❌ Phase 2 failed:`, error)
    console.log('Continuing to next phase...\n')
    phaseResults.push({
      phase: 'Phase 2: Goldsky historical load',
      status: 'failed',
      duration_minutes: parseFloat(duration.toFixed(1)),
      error: error instanceof Error ? error.message : String(error)
    })
  }

  // ============================================================================
  // PHASE 3: FULL ENRICHMENT PASS
  // ============================================================================
  try {
    console.log('🔧 Phase 3: Full enrichment pass')
    const startTime = Date.now()
    const { main: enrichmentMain } = await import('./full-enrichment-pass.js')
    await enrichmentMain()
    const duration = (Date.now() - startTime) / 1000 / 60
    console.log(`✅ Phase 3 complete (${duration.toFixed(1)} minutes)\n`)
    phaseResults.push({
      phase: 'Phase 3: Full enrichment pass',
      status: 'success',
      duration_minutes: parseFloat(duration.toFixed(1))
    })
  } catch (error) {
    const duration = (Date.now() - pipelineStart) / 1000 / 60
    console.error(`❌ Phase 3 failed:`, error)
    console.log('Continuing to next phase...\n')
    phaseResults.push({
      phase: 'Phase 3: Full enrichment pass',
      status: 'failed',
      duration_minutes: parseFloat(duration.toFixed(1)),
      error: error instanceof Error ? error.message : String(error)
    })
  }

  // ============================================================================
  // PHASE 4: GENERATE FINAL REPORTS
  // ============================================================================
  try {
    console.log('📊 Phase 4: Generate final reports')
    const startTime = Date.now()
    const { main: reportsMain } = await import('./generate-final-reports.js')
    await reportsMain()
    const duration = (Date.now() - startTime) / 1000 / 60
    console.log(`✅ Phase 4 complete (${duration.toFixed(1)} minutes)\n`)
    phaseResults.push({
      phase: 'Phase 4: Generate final reports',
      status: 'success',
      duration_minutes: parseFloat(duration.toFixed(1))
    })
  } catch (error) {
    const duration = (Date.now() - pipelineStart) / 1000 / 60
    console.error(`❌ Phase 4 failed:`, error)
    console.log('Continuing to summary...\n')
    phaseResults.push({
      phase: 'Phase 4: Generate final reports',
      status: 'failed',
      duration_minutes: parseFloat(duration.toFixed(1)),
      error: error instanceof Error ? error.message : String(error)
    })
  }

  // ============================================================================
  // FINAL SUMMARY
  // ============================================================================
  const pipelineEnd = Date.now()
  const totalDurationMinutes = (pipelineEnd - pipelineStart) / 1000 / 60
  const totalDurationHours = totalDurationMinutes / 60

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

  // Collect generated files
  const runtimeDir = resolve(process.cwd(), 'runtime')
  const filesGenerated: string[] = []

  try {
    const files = fs.readdirSync(runtimeDir)
    files.forEach(file => {
      if (file.includes('final-summary') ||
          file.includes('progress.jsonl') ||
          file.includes('orchestrator')) {
        filesGenerated.push(`runtime/${file}`)
      }
    })
  } catch (error) {
    // If runtime dir doesn't exist or can't be read, just skip
  }

  const summary: FinalSummary = {
    pipeline_start: pipelineStartISO,
    pipeline_end: new Date().toISOString(),
    total_duration_minutes: parseFloat(totalDurationMinutes.toFixed(1)),
    total_duration_hours: parseFloat(totalDurationHours.toFixed(2)),
    phase_results: phaseResults,
    overall_status: overallStatus,
    successful_phases: successfulPhases,
    failed_phases: failedPhases,
    files_generated: filesGenerated
  }

  // Write summary to file
  fs.writeFileSync(SUMMARY_LOG, JSON.stringify(summary, null, 2))

  // Print final summary to console
  console.log('═'.repeat(80))
  console.log('🌙 OVERNIGHT PIPELINE COMPLETE')
  console.log('═'.repeat(80))
  console.log('')
  console.log(`Overall Status: ${overallStatus.toUpperCase()}`)
  console.log(`Total Duration: ${totalDurationHours.toFixed(2)} hours (${totalDurationMinutes.toFixed(1)} minutes)`)
  console.log(`Successful Phases: ${successfulPhases}/${phaseResults.length}`)
  console.log(`Failed Phases: ${failedPhases}/${phaseResults.length}`)
  console.log('')
  console.log('Phase Results:')
  console.log('─'.repeat(80))

  phaseResults.forEach((result, idx) => {
    const statusIcon = result.status === 'success' ? '✅' : '❌'
    console.log(`${statusIcon} ${result.phase}`)
    console.log(`   Duration: ${result.duration_minutes} minutes`)
    console.log(`   Status: ${result.status}`)
    if (result.error) {
      console.log(`   Error: ${result.error}`)
    }
    if (idx < phaseResults.length - 1) {
      console.log('')
    }
  })

  console.log('')
  console.log('Files Generated:')
  console.log('─'.repeat(80))
  if (filesGenerated.length > 0) {
    filesGenerated.forEach(file => {
      console.log(`   - ${file}`)
    })
  } else {
    console.log('   (No files detected in runtime directory)')
  }

  console.log('')
  console.log('Summary saved to: runtime/overnight-orchestrator.summary.json')
  console.log('Plan logged to: runtime/overnight-orchestrator.plan.jsonl')
  console.log('')
  console.log('═'.repeat(80))
}

// DO NOT auto-execute
// Call main() explicitly when ready
