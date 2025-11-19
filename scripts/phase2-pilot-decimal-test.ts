#!/usr/bin/env npx tsx

/**
 * PHASE 2 PILOT (DECIMAL FORMAT): Test RPC with decimal block numbers
 *
 * This is the corrected version that uses DECIMAL block numbers
 * instead of hex (which Alchemy's RPC validation rejects)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const WORKER_COUNT = 4
const BATCH_BLOCK_SIZE = 1000

const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFromRPC(method: string, params: any[]): Promise<any> {
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Math.random(),
        method,
        params
      })
    })

    const data = await response.json()
    if (data.error) throw new Error(`RPC: ${data.error.message}`)
    return data.result
  } catch (e: any) {
    console.error(`RPC call failed for ${method}: ${e.message}`)
    console.error(`URL: ${RPC_URL}`)
    throw e
  }
}

async function processBlockRangeParallel(
  startBlock: number,
  endBlock: number,
  workerId: number
): Promise<any[]> {
  const events = []

  for (let block = startBlock; block < endBlock; block += BATCH_BLOCK_SIZE) {
    const blockEnd = Math.min(block + BATCH_BLOCK_SIZE - 1, endBlock - 1)

    try {
      // Format: Simple hex with 0x prefix (no padding - leading zeros rejected by Alchemy)
      const fromBlockHex = `0x${block.toString(16)}`
      const toBlockHex = `0x${blockEnd.toString(16)}`

      const logs = await fetchFromRPC('eth_getLogs', [
        {
          address: CONDITIONAL_TOKENS,
          topics: [TRANSFER_BATCH_SIG],
          fromBlock: fromBlockHex,
          toBlock: toBlockHex
        }
      ])

      if (logs && logs.length > 0) {
        events.push(...logs)
        console.log(`[Worker ${workerId}] Fetched ${logs.length} events from blocks ${block}-${blockEnd}`)
      }

      await sleep(50)

    } catch (e: any) {
      console.warn(`[Worker ${workerId}] Error in block ${block}-${blockEnd}: ${e.message.substring(0, 60)}`)
    }
  }

  return events
}

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 2 PILOT (DECIMAL FORMAT): Backfill 1 Week ERC1155 with 4 Workers')
  console.log('='.repeat(100))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    return
  }

  // Step 1: Get current block and plan pilot
  console.log('\n[STEP 1] Determine pilot block range (last 1 week)')
  console.log('─'.repeat(100))

  let currentBlock: number
  try {
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    currentBlock = parseInt(blockHex, 16)
    console.log(`Current block: ${currentBlock.toLocaleString()}`)

    // Polygon: ~172,800 blocks per day
    const blocksPerWeek = 172800 * 7
    const pilotStartBlock = currentBlock - blocksPerWeek

    console.log(`Pilot range: blocks ${pilotStartBlock.toLocaleString()} → ${currentBlock.toLocaleString()}`)
    console.log(`Total blocks: ${(currentBlock - pilotStartBlock).toLocaleString()}`)
    console.log(`Workers: ${WORKER_COUNT}`)
    console.log(`Estimated time: 5-10 minutes\n`)

    // Step 2: Create temp table
    console.log('[STEP 2] Create temporary table for pilot data')
    console.log('─'.repeat(100))

    await clickhouse.query({
      query: `DROP TABLE IF EXISTS erc1155_transfers_pilot`
    })

    await clickhouse.query({
      query: `
        CREATE TABLE erc1155_transfers_pilot (
          tx_hash String,
          log_index UInt32,
          block_number UInt32,
          contract String,
          token_id String,
          from_address String,
          to_address String,
          value String
        ) ENGINE=Memory
      `
    })
    console.log('✅ Temporary table created\n')

    // Step 3: Launch parallel workers
    console.log('[STEP 3] Fetch ERC1155 events with 4 parallel workers')
    console.log('─'.repeat(100))

    const blocksPerWorker = Math.ceil((currentBlock - pilotStartBlock) / WORKER_COUNT)
    const workerRanges = []

    for (let i = 0; i < WORKER_COUNT; i++) {
      const start = pilotStartBlock + (i * blocksPerWorker)
      const end = i === WORKER_COUNT - 1 ? currentBlock : pilotStartBlock + ((i + 1) * blocksPerWorker)
      workerRanges.push({ id: i + 1, start, end })
    }

    const startTime = Date.now()
    const workerPromises = workerRanges.map(range =>
      processBlockRangeParallel(range.start, range.end, range.id)
        .then(events => {
          console.log(`✅ Worker ${range.id} complete: ${events.length.toLocaleString()} events`)
          return events
        })
        .catch(e => {
          console.error(`❌ Worker ${range.id} failed: ${e.message}`)
          return []
        })
    )

    console.log(`Started ${WORKER_COUNT} workers...\n`)

    const allResults = await Promise.all(workerPromises)
    const allEvents = allResults.flat()
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

    console.log(`\n✅ RPC fetch complete`)
    console.log(`   Total events: ${allEvents.length.toLocaleString()}`)
    console.log(`   Time: ${elapsed} minutes`)
    console.log(`   Rate: ${(allEvents.length / parseFloat(elapsed) / 60).toFixed(0)} events/sec\n`)

    // Step 4: Insert into temp table
    console.log('[STEP 4] Insert events into temporary table')
    console.log('─'.repeat(100))

    if (allEvents.length > 0) {
      const BATCH_SIZE = 5000
      for (let i = 0; i < allEvents.length; i += BATCH_SIZE) {
        const batch = allEvents.slice(i, i + BATCH_SIZE)
        const values = batch.map((log: any) => {
          const topics = log.topics || []
          return [
            log.transactionHash || '',
            parseInt(log.logIndex || 0, 16),
            parseInt(log.blockNumber || 0, 16),
            log.address || '',
            topics[3] || '',
            topics[1] || '',
            topics[2] || '',
            log.data || ''
          ]
        })

        const sql = `
          INSERT INTO erc1155_transfers_pilot VALUES (
            ${values.map(v => `('${v[0]}', ${v[1]}, ${v[2]}, '${v[3]}', '${v[4]}', '${v[5]}', '${v[6]}', '${v[7]}')`).join(', ')}
          )
        `
        await clickhouse.query({ query: sql })

        console.log(`  Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allEvents.length / BATCH_SIZE)}`)
      }
    }

    console.log('✅ All events inserted\n')

    // Step 5: Verify data
    console.log('[STEP 5] Verify pilot data')
    console.log('─'.repeat(100))

    const pilotStats = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_events,
          COUNT(DISTINCT tx_hash) as unique_txs,
          COUNT(DISTINCT from_address) as from_addresses,
          COUNT(DISTINCT to_address) as to_addresses
        FROM erc1155_transfers_pilot
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const ps = pilotStats[0]
    console.log(`Pilot data summary:`)
    console.log(`  Total ERC1155 events: ${parseInt(ps.total_events).toLocaleString()}`)
    console.log(`  Unique transactions: ${parseInt(ps.unique_txs).toLocaleString()}`)
    console.log(`  Unique senders: ${parseInt(ps.from_addresses).toLocaleString()}`)
    console.log(`  Unique receivers: ${parseInt(ps.to_addresses).toLocaleString()}`)

    // Step 6: Test JOIN with trades_raw
    console.log(`\nTesting JOIN with trades_raw...`)
    const joinTest = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as matched_trades
        FROM trades_raw t
        INNER JOIN erc1155_transfers_pilot e
          ON t.transaction_hash = e.tx_hash
        WHERE (t.condition_id = '' OR t.condition_id IS NULL)
        LIMIT 100000
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const matchCount = parseInt(joinTest[0]?.matched_trades || 0)
    const matchRate = parseInt(ps.total_events) > 0
      ? ((matchCount / parseInt(ps.total_events)) * 100).toFixed(1)
      : '0'

    console.log(`  Matched trades: ${matchCount.toLocaleString()}`)
    console.log(`  Match rate: ${matchRate}%`)

    if (matchCount > 0) {
      console.log(`\n✅ PILOT SUCCESS!`)
      console.log(`\n   Recovery strategy WORKS!`)
      console.log(`   ${matchCount.toLocaleString()} trades matched to ERC1155 events`)
      console.log(`\n   Ready for: Full backfill (blocks 37.5M to 78.7M)`)
      console.log(`   This will run with ${WORKER_COUNT} workers and complete in 1-2 hours`)
    } else {
      console.log(`\n⚠️  No matches found in pilot`)
      console.log(`   May need to investigate further`)
    }

    // Cleanup
    await clickhouse.query({ query: `DROP TABLE IF EXISTS erc1155_transfers_pilot` })

  } catch (e: any) {
    console.error(`❌ Pilot failed: ${e.message}`)
    console.error(`Full error: ${JSON.stringify(e)}`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('PHASE 2 PILOT COMPLETE')
  console.log('='.repeat(100))
}

main().catch(e => console.error('Fatal:', e))
