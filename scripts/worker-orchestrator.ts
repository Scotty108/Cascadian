import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { spawn } from 'child_process'
import { clickhouse } from './lib/clickhouse/client'

/**
 * OVERNIGHT DATA PULLING ORCHESTRATOR
 *
 * Coordinates 8 parallel workers to pull all data needed in 5-6 hours:
 * - Worker 1-2: CLOB API (2 workers for market metadata)
 * - Worker 3-4: RPC Events (2 workers for blockchain data)
 * - Worker 5-6: Goldsky Subgraph (2 workers for indexed data)
 * - Worker 7: Data Reconciliation (merge + deduplicate)
 * - Worker 8: Enrichment Application (apply mappings to trades_raw)
 */

interface WorkerResult {
  name: string
  success: boolean
  message: string
  data?: any
  error?: string
  duration: number
}

const results: WorkerResult[] = []
const startTime = Date.now()

function log(msg: string) {
  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] ${msg}`)
}

async function runWorker(name: string, scriptPath: string): Promise<WorkerResult> {
  return new Promise((resolve) => {
    const workerStart = Date.now()
    log(`🚀 Starting ${name}...`)

    const worker = spawn('npx', ['tsx', scriptPath], {
      stdio: 'pipe',
      timeout: 1800000 // 30 minute timeout per worker
    })

    let output = ''
    let error = ''

    worker.stdout?.on('data', (data) => {
      output += data.toString()
      process.stdout.write(data) // Forward output to console
    })

    worker.stderr?.on('data', (data) => {
      error += data.toString()
      process.stderr.write(data)
    })

    worker.on('close', (code) => {
      const duration = Math.round((Date.now() - workerStart) / 1000)
      const success = code === 0

      log(`${success ? '✅' : '❌'} ${name} completed in ${duration}s`)

      resolve({
        name,
        success,
        message: success ? `${name} completed successfully` : `${name} failed with exit code ${code}`,
        data: output,
        error: error || undefined,
        duration
      })
    })

    worker.on('error', (err) => {
      const duration = Math.round((Date.now() - workerStart) / 1000)
      log(`❌ ${name} error: ${err.message}`)

      resolve({
        name,
        success: false,
        message: `${name} error: ${err.message}`,
        error: err.message,
        duration
      })
    })
  })
}

async function main() {
  try {
    console.log('═'.repeat(70))
    console.log('🌙 OVERNIGHT DATA PULLING ORCHESTRATOR')
    console.log('═'.repeat(70))
    console.log(`Start time: ${new Date().toLocaleString()}`)
    console.log('Target: Pull all data needed for 95%+ condition_id coverage')
    console.log('Timeline: 5-6 hours')
    console.log()

    // Step 1: Setup - Create intermediate tables
    log('📋 Step 1: Setting up intermediate tables...')

    try {
      // Tables will be created by individual workers
      log('✓ Ready for parallel worker execution')
    } catch (e: any) {
      log(`⚠️  Setup warning: ${e.message}`)
    }

    console.log()
    log('▶️  Starting parallel worker pool (8 workers)...')
    console.log()

    // Step 2: Run workers in parallel
    // Priority order: CLOB (highest coverage) → RPC (blockchain truth) → Goldsky (fallback)
    const workerPromises = [
      // CLOB API workers (highest priority) - using ultra-fast streaming version
      runWorker('CLOB-Worker-1', './worker-clob-ultra-fast.ts'),

      // RPC Event workers (medium priority)
      runWorker('RPC-Worker-1', './worker-rpc-events.ts'),

      // Goldsky workers (fallback)
      runWorker('Goldsky-Worker-1', './worker-goldsky.ts'),

      // Reconciliation will run after initial workers complete
      // runWorker('Reconciler', './worker-reconciler.ts'),

      // Enrichment will run after reconciliation
      // runWorker('Enricher', './worker-enrichment.ts')
    ]

    // Run all workers in parallel
    const workerResults = await Promise.all(workerPromises)
    results.push(...workerResults)

    console.log()
    console.log('═'.repeat(70))
    log('📊 WORKER RESULTS SUMMARY')
    console.log('═'.repeat(70))

    let successCount = 0
    let failCount = 0
    let totalDuration = 0

    for (const result of workerResults) {
      const status = result.success ? '✅' : '❌'
      console.log(`${status} ${result.name}: ${result.message} (${result.duration}s)`)

      if (result.success) {
        successCount++
      } else {
        failCount++
      }
      totalDuration = Math.max(totalDuration, result.duration)
    }

    console.log()
    console.log(`Total workers: ${workerResults.length}`)
    console.log(`Successful: ${successCount}`)
    console.log(`Failed: ${failCount}`)
    console.log(`Total time: ${totalDuration}s (${Math.round(totalDuration / 60)} minutes)`)
    console.log()

    // Step 3: Verify merged data
    if (successCount > 0) {
      log('🔍 Step 2: Verifying merged data...')

      try {
        // Check CLOB results
        const clobCheck = await clickhouse.query({
          query: 'SELECT COUNT(DISTINCT market_id) as cnt FROM clob_market_mapping'
        })

        const clobData = JSON.parse(await clobCheck.text()).data[0]
        console.log(`  CLOB mappings: ${clobData.cnt.toLocaleString()} markets`)

        // Test enrichment potential
        log('Testing enrichment potential...')

        const testResult = await clickhouse.query({
          query: `
SELECT
  COUNT(DISTINCT market_id) as unique_markets,
  COUNT(*) as total_rows
FROM trades_raw
WHERE condition_id = '' OR condition_id IS NULL
LIMIT 10000000
          `
        })

        const testData = JSON.parse(await testResult.text()).data[0]
        console.log(`  Markets missing condition_id: ${testData.unique_markets}`)
        console.log(`  Rows missing condition_id: ${testData.total_rows.toLocaleString()}`)
      } catch (e: any) {
        log(`⚠️  Verification warning: ${e.message}`)
      }
    }

    // Step 4: Summary
    console.log()
    console.log('═'.repeat(70))
    console.log('📈 ORCHESTRATOR SUMMARY')
    console.log('═'.repeat(70))
    console.log()

    const totalTime = Math.round((Date.now() - startTime) / 1000)
    const totalMinutes = Math.round(totalTime / 60)

    if (failCount === 0 && successCount > 0) {
      console.log('✅ ALL WORKERS COMPLETED SUCCESSFULLY')
      console.log()
      console.log(`Total execution time: ${totalTime}s (${totalMinutes} minutes)`)
      console.log(`Remaining time for enrichment: ~${Math.max(0, 360 - totalMinutes)} minutes`)
      console.log()
      console.log('Next: Apply merged mappings to all 160.9M trades')
    } else {
      console.log('⚠️  Some workers encountered issues')
      console.log()
      console.log('Please review worker output above for details')
    }

    console.log()
    console.log(`End time: ${new Date().toLocaleString()}`)

  } catch (e: any) {
    console.error('❌ ORCHESTRATOR ERROR:', e.message)
    process.exit(1)
  }
}

// Run orchestrator
main().then(() => {
  process.exit(results.every(r => r.success) ? 0 : 1)
})
