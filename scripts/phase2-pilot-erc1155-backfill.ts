#!/usr/bin/env npx tsx

/**
 * PHASE 2 PILOT: Backfill 1 Week of ERC1155 Data (Proof of Concept)
 *
 * Backfill recent 1 week of ERC1155 events to prove the recovery strategy works
 * If this succeeds, we'll do full backfill with confidence.
 *
 * Timeline: 15-30 minutes
 * Blocks: ~300k blocks (1 week on Polygon ~14.4M blocks/week, but we're doing ~300k recent)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const BATCH_BLOCK_SIZE = 1000  // Fetch 1000 blocks per request
const REQUEST_DELAY_MS = 100   // Rate limiting

// ERC1155 contract and event signatures
const CONDITIONAL_TOKENS = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const TRANSFER_SINGLE_SIG = '0xc3d58168c5ae7397731d063d5bbf3d657706970d3750a2271e5c3da0d4d6b8e'
const TRANSFER_BATCH_SIG = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchFromRPC(method: string, params: any[]): Promise<any> {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    })
  })

  const data = await response.json()
  if (data.error) throw new Error(`RPC: ${data.error.message}`)
  return data.result
}

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 2 PILOT: Backfill 1 Week of ERC1155 Data (Proof of Concept)')
  console.log('='.repeat(100))

  if (!RPC_URL) {
    console.error('❌ ALCHEMY_POLYGON_RPC_URL not set')
    return
  }

  // Step 1: Get current block and plan pilot backfill
  console.log('\n[STEP 1] Determine pilot block range (last 1 week)')
  console.log('─'.repeat(100))

  let currentBlock: number
  try {
    const blockHex = await fetchFromRPC('eth_blockNumber', [])
    currentBlock = parseInt(blockHex, 16)
    console.log(`Current block: ${currentBlock.toLocaleString()}`)

    // Polygon: ~2 blocks per second = 172,800 blocks per day
    const blocksPerWeek = 172800 * 7
    const pilotStartBlock = currentBlock - blocksPerWeek

    console.log(`Pilot range: blocks ${pilotStartBlock.toLocaleString()} → ${currentBlock.toLocaleString()}`)
    console.log(`Total blocks: ${(currentBlock - pilotStartBlock).toLocaleString()}`)
    console.log(`Estimated requests: ${Math.ceil((currentBlock - pilotStartBlock) / BATCH_BLOCK_SIZE).toLocaleString()}`)
    console.log(`Estimated time: 15-30 minutes\n`)

    // Create temporary table for pilot data
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

    // Step 3: Fetch ERC1155 events
    console.log('[STEP 3] Fetch ERC1155 TransferBatch events from RPC')
    console.log('─'.repeat(100))

    let totalEvents = 0
    let requestCount = 0
    const startTime = Date.now()

    for (let blockStart = pilotStartBlock; blockStart < currentBlock; blockStart += BATCH_BLOCK_SIZE) {
      const blockEnd = Math.min(blockStart + BATCH_BLOCK_SIZE - 1, currentBlock - 1)
      requestCount++

      try {
        const logs = await fetchFromRPC('eth_getLogs', [
          {
            address: CONDITIONAL_TOKENS,
            topics: [[TRANSFER_SINGLE_SIG, TRANSFER_BATCH_SIG]],
            fromBlock: `0x${blockStart.toString(16)}`,
            toBlock: `0x${blockEnd.toString(16)}`
          }
        ])

        if (logs && logs.length > 0) {
          totalEvents += logs.length

          // Insert into temporary table
          const values = logs.map((log: any) => {
            const topics = log.topics || []
            return [
              log.transactionHash,
              parseInt(log.logIndex || 0, 16),
              parseInt(log.blockNumber || 0, 16),
              log.address,
              log.topics[3] || '', // token_id in topics[3] for TransferBatch
              topics[1] || '', // from in topics[1]
              topics[2] || '', // to in topics[2]
              log.data || '' // value in data
            ]
          })

          if (values.length > 0) {
            const insertSQL = `
              INSERT INTO erc1155_transfers_pilot VALUES (
                ${values.map(v => `('${v[0]}', ${v[1]}, ${v[2]}, '${v[3]}', '${v[4]}', '${v[5]}', '${v[6]}', '${v[7]}')`).join(', ')}
              )
            `
            await clickhouse.query({ query: insertSQL })
          }
        }

        if (requestCount % 50 === 0) {
          console.log(`  [${requestCount}] Fetched ${totalEvents.toLocaleString()} events so far...`)
        }

        await sleep(REQUEST_DELAY_MS)

      } catch (e: any) {
        console.error(`  ⚠️  Block range ${blockStart}-${blockEnd}: ${e.message.substring(0, 50)}`)
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
    console.log(`\n✅ RPC fetch complete`)
    console.log(`   Total events fetched: ${totalEvents.toLocaleString()}`)
    console.log(`   Requests: ${requestCount.toLocaleString()}`)
    console.log(`   Time elapsed: ${elapsed} minutes\n`)

    // Step 4: Verify pilot data and test recovery logic
    console.log('[STEP 4] Verify pilot data and test recovery')
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

    // Test JOIN with trades_raw
    console.log(`\nTesting JOIN with trades_raw...`)
    const joinTest = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as matched_trades,
          COUNT(DISTINCT t.trade_id) as unique_trade_ids
        FROM trades_raw t
        INNER JOIN erc1155_transfers_pilot e
          ON t.transaction_hash = e.tx_hash
        WHERE t.condition_id = '' OR t.condition_id IS NULL
        LIMIT 100000
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const jt = joinTest[0]
    const matchCount = parseInt(jt.matched_trades)
    const matchRate = (matchCount / parseInt(ps.total_events) * 100).toFixed(1)

    console.log(`  Matched trades: ${matchCount.toLocaleString()}`)
    console.log(`  Match rate: ${matchRate}%`)

    if (matchCount > 0) {
      console.log(`\n✅ PILOT SUCCESS!`)
      console.log(`   Recovery strategy works - ready for full backfill`)
      console.log(`   Proceed to: scripts/phase2-full-erc1155-backfill.ts`)
    } else {
      console.log(`\n⚠️  No matches found - may need to investigate`)
    }

    // Cleanup
    await clickhouse.query({ query: `DROP TABLE IF EXISTS erc1155_transfers_pilot` })

  } catch (e: any) {
    console.error(`❌ Pilot failed: ${e.message}`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('PHASE 2 PILOT COMPLETE')
  console.log('='.repeat(100))
}

main().catch(e => console.error('Fatal:', e))
