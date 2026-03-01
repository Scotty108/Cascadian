/**
 * Self-Hosted On-Chain Data Ingestion — Catchup Cron
 *
 * Runs every 15 minutes. Only activates when any watermark is >5,000 blocks
 * behind chain tip (~2.8 hours of Polygon data). Handles recovery from:
 * - Vercel outages
 * - RPC provider outages
 * - Sustained primary cron failures
 *
 * Processes up to 50,000 blocks per run with a time guard (exit at 4 min).
 * Returns partial progress so the next invocation picks up where it left off.
 */

import { NextResponse } from 'next/server'
import { verifyCronRequest } from '@/lib/cron/verifyCronRequest'
import { logCronExecution } from '@/lib/alerts/cron-tracker'
import { sendCronFailureAlert } from '@/lib/alerts/discord'
import { clickhouse } from '@/lib/clickhouse/client'
import { getChainTip, fetchLogs } from '@/lib/onchain/rpc'
import { getOnchainWatermark, updateOnchainWatermark } from '@/lib/onchain/watermark'
import { initTimestamp } from '@/lib/onchain/timestamp'
import {
  decodeOrderFilled,
  extractTokenIds,
  loadTokenMapForBatch,
  EXCHANGE_CONTRACTS,
  ORDER_FILLED_TOPIC,
} from '@/lib/onchain/decoders/clob'
import {
  decodeCTFEvent,
  CTF_CONTRACT,
  CTF_TOPIC_FILTER,
} from '@/lib/onchain/decoders/ctf'
import {
  decodeNegRiskEvent,
  NEGRISK_ADAPTER,
  POSITIONS_CONVERTED_TOPIC,
} from '@/lib/onchain/decoders/negrisk'
import {
  decodeResolutionEvent,
  CONDITION_RESOLUTION_TOPIC,
  RESOLUTION_CONTRACT,
} from '@/lib/onchain/decoders/resolution'
import type { SourceResult, CanonicalFillRow, CTFRow, NegRiskRow, ResolutionRow } from '@/lib/onchain/types'

export const runtime = 'nodejs'
export const maxDuration = 300

// Only activate when watermark is >5,000 blocks behind tip (~2.8 hours)
const ACTIVATION_THRESHOLD = 5_000

// Process up to 50,000 blocks per source per run
const MAX_BLOCKS_CATCHUP = 50_000

// Chunk size: process 2,000 blocks at a time to stay within RPC limits
const CHUNK_SIZE = 2_000

// Time guard: stop processing at 240 seconds to stay under Vercel's 5-min limit
const TIME_GUARD_MS = 240_000

// Layer 3: overlap blocks for late-arriving logs
const OVERLAP_BLOCKS = 10

export async function GET(request: Request) {
  const startTime = Date.now()
  const results: Record<string, SourceResult & { timedOut?: boolean; remaining?: number }> = {}

  try {
    const auth = verifyCronRequest(request, 'ingest-onchain-catchup')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.reason }, { status: 401 })
    }

    const tipBlock = await getChainTip()
    const tsCtx = await initTimestamp(tipBlock)

    // Check which sources are behind
    const sources = [
      { key: 'onchain_clob', name: 'clob' },
      { key: 'onchain_ctf', name: 'ctf' },
      { key: 'onchain_negrisk', name: 'negrisk' },
      { key: 'onchain_resolution', name: 'resolution' },
    ]

    let anyBehind = false
    for (const src of sources) {
      const wm = await getOnchainWatermark(src.key)
      const wmBlock = wm?.last_block_number || tipBlock
      const blocksBehind = tipBlock - wmBlock
      if (blocksBehind > ACTIVATION_THRESHOLD) {
        anyBehind = true
        break
      }
    }

    if (!anyBehind) {
      return NextResponse.json({
        success: true,
        message: 'All sources within threshold, no catchup needed',
        block: tipBlock,
      })
    }

    // ===== Process each source with chunking and time guard =====

    // 1. CLOB Fills
    try {
      const wm = await getOnchainWatermark('onchain_clob')
      const wmBlock = wm?.last_block_number || tipBlock
      const blocksBehind = tipBlock - wmBlock

      if (blocksBehind > ACTIVATION_THRESHOLD) {
        const fromBlock = Math.max(0, wmBlock - OVERLAP_BLOCKS)
        const maxTo = Math.min(tipBlock, wmBlock + MAX_BLOCKS_CATCHUP)
        let cursor = fromBlock
        let totalRows = 0
        let timedOut = false

        while (cursor < maxTo) {
          if (Date.now() - startTime > TIME_GUARD_MS) {
            timedOut = true
            break
          }

          const chunkEnd = Math.min(cursor + CHUNK_SIZE, maxTo)
          const logs = await fetchLogs(EXCHANGE_CONTRACTS, [ORDER_FILLED_TOPIC], cursor, chunkEnd)

          if (logs.length > 0) {
            const tokenIds = extractTokenIds(logs)
            const tokenMap = await loadTokenMapForBatch(tokenIds)

            const rows: CanonicalFillRow[] = []
            for (const log of logs) {
              rows.push(...decodeOrderFilled(log, log.address, tokenMap, tsCtx.interpolate))
            }

            if (rows.length > 0) {
              await clickhouse.insert({
                table: 'pm_canonical_fills_v4',
                values: rows,
                format: 'JSONEachRow',
              })
              totalRows += rows.length
            }
          }

          await updateOnchainWatermark('onchain_clob', chunkEnd, tsCtx.interpolate(chunkEnd), totalRows)
          cursor = chunkEnd
        }

        results.clob = {
          rows: totalRows,
          fromBlock,
          toBlock: cursor,
          timedOut,
          remaining: timedOut ? maxTo - cursor : 0,
        }
      } else {
        results.clob = { rows: 0 }
      }
    } catch (err: any) {
      results.clob = { rows: 0, error: err.message?.slice(0, 200) }
    }

    // 2. CTF Events
    try {
      const wm = await getOnchainWatermark('onchain_ctf')
      const wmBlock = wm?.last_block_number || tipBlock
      const blocksBehind = tipBlock - wmBlock

      if (blocksBehind > ACTIVATION_THRESHOLD) {
        const fromBlock = Math.max(0, wmBlock - OVERLAP_BLOCKS)
        const maxTo = Math.min(tipBlock, wmBlock + MAX_BLOCKS_CATCHUP)
        let cursor = fromBlock
        let totalRows = 0
        let timedOut = false

        while (cursor < maxTo) {
          if (Date.now() - startTime > TIME_GUARD_MS) {
            timedOut = true
            break
          }

          const chunkEnd = Math.min(cursor + CHUNK_SIZE, maxTo)
          const logs = await fetchLogs(CTF_CONTRACT, [CTF_TOPIC_FILTER], cursor, chunkEnd)

          if (logs.length > 0) {
            const rows: CTFRow[] = []
            for (const log of logs) {
              const row = decodeCTFEvent(log, tsCtx.interpolate)
              if (row) rows.push(row)
            }

            if (rows.length > 0) {
              await clickhouse.insert({
                table: 'pm_ctf_events',
                values: rows,
                format: 'JSONEachRow',
              })
              totalRows += rows.length
            }
          }

          await updateOnchainWatermark('onchain_ctf', chunkEnd, tsCtx.interpolate(chunkEnd), totalRows)
          cursor = chunkEnd
        }

        results.ctf = {
          rows: totalRows,
          fromBlock,
          toBlock: cursor,
          timedOut,
          remaining: timedOut ? maxTo - cursor : 0,
        }
      } else {
        results.ctf = { rows: 0 }
      }
    } catch (err: any) {
      results.ctf = { rows: 0, error: err.message?.slice(0, 200) }
    }

    // 3. NegRisk Conversions
    try {
      const wm = await getOnchainWatermark('onchain_negrisk')
      const wmBlock = wm?.last_block_number || tipBlock
      const blocksBehind = tipBlock - wmBlock

      if (blocksBehind > ACTIVATION_THRESHOLD) {
        const fromBlock = Math.max(0, wmBlock - OVERLAP_BLOCKS)
        const maxTo = Math.min(tipBlock, wmBlock + MAX_BLOCKS_CATCHUP)
        let cursor = fromBlock
        let totalRows = 0
        let timedOut = false

        while (cursor < maxTo) {
          if (Date.now() - startTime > TIME_GUARD_MS) {
            timedOut = true
            break
          }

          const chunkEnd = Math.min(cursor + CHUNK_SIZE, maxTo)
          const logs = await fetchLogs(NEGRISK_ADAPTER, [POSITIONS_CONVERTED_TOPIC], cursor, chunkEnd)

          if (logs.length > 0) {
            const rows: NegRiskRow[] = []
            for (const log of logs) {
              rows.push(decodeNegRiskEvent(log, tsCtx.interpolate))
            }

            if (rows.length > 0) {
              await clickhouse.insert({
                table: 'pm_neg_risk_conversions_v1',
                values: rows,
                format: 'JSONEachRow',
              })
              totalRows += rows.length
            }
          }

          await updateOnchainWatermark('onchain_negrisk', chunkEnd, tsCtx.interpolate(chunkEnd), totalRows)
          cursor = chunkEnd
        }

        results.negrisk = {
          rows: totalRows,
          fromBlock,
          toBlock: cursor,
          timedOut,
          remaining: timedOut ? maxTo - cursor : 0,
        }
      } else {
        results.negrisk = { rows: 0 }
      }
    } catch (err: any) {
      results.negrisk = { rows: 0, error: err.message?.slice(0, 200) }
    }

    // 4. Condition Resolutions
    try {
      const wm = await getOnchainWatermark('onchain_resolution')
      const wmBlock = wm?.last_block_number || tipBlock
      const blocksBehind = tipBlock - wmBlock

      if (blocksBehind > ACTIVATION_THRESHOLD) {
        const fromBlock = Math.max(0, wmBlock - OVERLAP_BLOCKS)
        const maxTo = Math.min(tipBlock, wmBlock + MAX_BLOCKS_CATCHUP)
        let cursor = fromBlock
        let totalRows = 0
        let timedOut = false

        while (cursor < maxTo) {
          if (Date.now() - startTime > TIME_GUARD_MS) {
            timedOut = true
            break
          }

          const chunkEnd = Math.min(cursor + CHUNK_SIZE, maxTo)
          const logs = await fetchLogs(RESOLUTION_CONTRACT, [CONDITION_RESOLUTION_TOPIC], cursor, chunkEnd)

          if (logs.length > 0) {
            const rows: ResolutionRow[] = []
            for (const log of logs) {
              const row = decodeResolutionEvent(log, tsCtx.interpolate)
              if (row) rows.push(row)
            }

            if (rows.length > 0) {
              await clickhouse.insert({
                table: 'pm_condition_resolutions',
                values: rows,
                format: 'JSONEachRow',
              })
              totalRows += rows.length
            }
          }

          await updateOnchainWatermark('onchain_resolution', chunkEnd, tsCtx.interpolate(chunkEnd), totalRows)
          cursor = chunkEnd
        }

        results.resolution = {
          rows: totalRows,
          fromBlock,
          toBlock: cursor,
          timedOut,
          remaining: timedOut ? maxTo - cursor : 0,
        }
      } else {
        results.resolution = { rows: 0 }
      }
    } catch (err: any) {
      results.resolution = { rows: 0, error: err.message?.slice(0, 200) }
    }

    // ===== Log results =====
    const durationMs = Date.now() - startTime
    const hasErrors = Object.values(results).some(r => r.error)
    const totalRows = Object.values(results).reduce((sum, r) => sum + r.rows, 0)
    const anyTimedOut = Object.values(results).some(r => r.timedOut)

    await logCronExecution({
      cron_name: 'ingest-onchain-catchup',
      status: hasErrors ? 'failure' : 'success',
      duration_ms: durationMs,
      details: { block: tipBlock, totalRows, anyTimedOut, ...results },
    })

    if (hasErrors) {
      const errorSources = Object.entries(results)
        .filter(([, v]) => v.error)
        .map(([k, v]) => `${k}: ${v.error}`)
        .join('; ')
      await sendCronFailureAlert({
        cronName: 'ingest-onchain-catchup',
        error: `Catchup partial failure at block ${tipBlock}: ${errorSources}`,
      })
    }

    return NextResponse.json({
      success: !hasErrors,
      block: tipBlock,
      totalRows,
      anyTimedOut,
      results,
      elapsed_ms: durationMs,
    })
  } catch (error) {
    const durationMs = Date.now() - startTime
    console.error('ingest-onchain-catchup fatal error:', error)

    await logCronExecution({
      cron_name: 'ingest-onchain-catchup',
      status: 'failure',
      duration_ms: durationMs,
      error_message: String(error),
    })
    await sendCronFailureAlert({
      cronName: 'ingest-onchain-catchup',
      error: String(error),
    })

    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 },
    )
  }
}
