#!/usr/bin/env npx tsx

/**
 * GATE B FULL RECOVERY - Master Orchestrator
 *
 * Executes complete 4-step recovery process to raise Gate B (CID coverage) from 39.21% to ≥85%
 *
 * Steps:
 * 1. Setup SQL views and staging table
 * 2. Blockchain backfill (fetch missing ERC-1155 events)
 * 3. Patch fact_trades_clean
 * 4. Verify gates
 *
 * Estimated runtime: 30-90 minutes depending on blockchain RPC performance
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function runScript(scriptPath: string, description: string): Promise<void> {
  console.log('\n' + '='.repeat(100))
  console.log(`Running: ${description}`)
  console.log('='.repeat(100))

  try {
    const { stdout, stderr } = await execAsync(`npx tsx ${scriptPath}`, {
      cwd: process.cwd(),
      maxBuffer: 50 * 1024 * 1024 // 50MB buffer for large outputs
    })

    if (stdout) console.log(stdout)
    if (stderr) console.error(stderr)

  } catch (error: any) {
    console.error(`❌ Step failed: ${description}`)
    console.error(error.message)
    throw error
  }
}

async function main() {
  const startTime = Date.now()

  console.log('╔' + '═'.repeat(98) + '╗')
  console.log('║' + ' '.repeat(25) + 'GATE B FULL RECOVERY - Master Orchestrator' + ' '.repeat(31) + '║')
  console.log('╚' + '═'.repeat(98) + '╝')

  console.log('\nTarget: Raise Gate B (CID coverage) from 39.21% to ≥85%')
  console.log('Method: Targeted ERC-1155 blockchain backfill')
  console.log('\nEstimated runtime: 30-90 minutes')
  console.log('\nStarting at:', new Date().toISOString())

  try {
    // Step 1: Setup Views
    await runScript(
      'scripts/gate-b-step1-setup-views.ts',
      'STEP 1: Setup SQL Views and Staging Table'
    )

    // Step 2: Blockchain Backfill
    await runScript(
      'scripts/gate-b-step2-blockchain-backfill.ts',
      'STEP 2: Blockchain Backfill Worker'
    )

    // Step 3: Patch Fact Table
    await runScript(
      'scripts/gate-b-step3-patch-fact-table.ts',
      'STEP 3: Patch fact_trades_clean'
    )

    // Step 4: Verify Gates
    await runScript(
      'scripts/gate-b-step4-verify-gates.ts',
      'STEP 4: Verify Gates A & B'
    )

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

    console.log('\n' + '╔' + '═'.repeat(98) + '╗')
    console.log('║' + ' '.repeat(37) + 'RECOVERY COMPLETE' + ' '.repeat(43) + '║')
    console.log('╚' + '═'.repeat(98) + '╝')
    console.log(`\nTotal time elapsed: ${elapsed} minutes`)
    console.log(`Completed at: ${new Date().toISOString()}`)
    console.log(`\n🎉 Gate B recovery process finished successfully!`)
    console.log(`\nCheck the final output above for Gate B percentage.`)

  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

    console.log('\n' + '╔' + '═'.repeat(98) + '╗')
    console.log('║' + ' '.repeat(40) + 'RECOVERY FAILED' + ' '.repeat(43) + '║')
    console.log('╚' + '═'.repeat(98) + '╝')
    console.log(`\nFailed at: ${new Date().toISOString()}`)
    console.log(`Time elapsed before failure: ${elapsed} minutes`)
    console.log(`\nError: ${(error as any).message}`)
    console.log(`\n💡 Recovery process is checkpointed. You can re-run to resume from last successful step.`)

    process.exit(1)
  }
}

main().catch(console.error)
