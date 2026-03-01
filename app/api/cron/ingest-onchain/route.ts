/**
 * Self-Hosted On-Chain Data Ingestion — Primary Cron
 *
 * Runs every 1 minute. Ingests 4 event types from Polygon via free RPCs:
 * 1. CLOB fills (OrderFilled) → pm_canonical_fills_v4
 * 2. CTF events (Split/Merge/Redemption) → pm_ctf_events
 * 3. NegRisk conversions (PositionsConverted) → pm_neg_risk_conversions_v1
 * 4. Condition resolutions (ConditionResolution) → pm_condition_resolutions
 *
 * Each source processes independently (one failing doesn't block others).
 * Watermarks only advance after successful ClickHouse insert.
 *
 * Redundancy layers active in this handler:
 * - Layer 1: RPC failover (3 providers)
 * - Layer 2: Watermark-based resume
 * - Layer 3: Overlap blocks (re-process last 10)
 * - Layer 5: Discord alerts on failure
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

// Layer 3: re-process last 10 blocks for late-arriving logs and reorgs
const OVERLAP_BLOCKS = 10

// Normal mode: process up to ~50 blocks (~100s of Polygon data)
// Polygon produces ~30 blocks/min, so 50 blocks handles 1-min cron easily.
// Larger catchup is handled by the ingest-onchain-catchup cron.
const MAX_BLOCKS_NORMAL = 50

export async function GET(request: Request) {
  const startTime = Date.now()
  const results: Record<string, SourceResult> = {}

  try {
    const auth = verifyCronRequest(request, 'ingest-onchain')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.reason }, { status: 401 })
    }

    // Get chain tip and initialize timestamp interpolation (2 RPC calls)
    const tipBlock = await getChainTip()
    const tsCtx = await initTimestamp(tipBlock)

    // ===== 1. CLOB Fills =====
    try {
      const wm = await getOnchainWatermark('onchain_clob')
      if (!wm) {
        // First run: seed watermark at tip so next invocation starts from here
        await updateOnchainWatermark('onchain_clob', tipBlock, tsCtx.interpolate(tipBlock), 0)
        results.clob = { rows: 0, fromBlock: tipBlock, toBlock: tipBlock }
      }
      const wmBlock = wm?.last_block_number || tipBlock
      const fromBlock = wm ? Math.max(0, wmBlock - OVERLAP_BLOCKS) : tipBlock
      const toBlock = Math.min(tipBlock, wmBlock + MAX_BLOCKS_NORMAL)

      if (wm && fromBlock < toBlock) {
        // Fetch OrderFilled logs from both exchange contracts
        const logs = await fetchLogs(
          EXCHANGE_CONTRACTS,
          [ORDER_FILLED_TOPIC],
          fromBlock,
          toBlock,
        )

        let rowCount = 0
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
            rowCount = rows.length
          }
        }

        await updateOnchainWatermark('onchain_clob', toBlock, tsCtx.interpolate(toBlock), rowCount)
        results.clob = { rows: rowCount, fromBlock, toBlock }
      } else {
        results.clob = { rows: 0 }
      }
    } catch (err: any) {
      results.clob = { rows: 0, error: err.message?.slice(0, 200) }
    }

    // ===== 2. CTF Events =====
    try {
      const wm = await getOnchainWatermark('onchain_ctf')
      if (!wm) {
        await updateOnchainWatermark('onchain_ctf', tipBlock, tsCtx.interpolate(tipBlock), 0)
        results.ctf = { rows: 0, fromBlock: tipBlock, toBlock: tipBlock }
      }
      const wmBlock = wm?.last_block_number || tipBlock
      const fromBlock = wm ? Math.max(0, wmBlock - OVERLAP_BLOCKS) : tipBlock
      const toBlock = Math.min(tipBlock, wmBlock + MAX_BLOCKS_NORMAL)

      if (wm && fromBlock < toBlock) {
        const logs = await fetchLogs(
          CTF_CONTRACT,
          [CTF_TOPIC_FILTER],
          fromBlock,
          toBlock,
        )

        let rowCount = 0
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
            rowCount = rows.length
          }
        }

        await updateOnchainWatermark('onchain_ctf', toBlock, tsCtx.interpolate(toBlock), rowCount)
        results.ctf = { rows: rowCount, fromBlock, toBlock }
      } else {
        results.ctf = { rows: 0 }
      }
    } catch (err: any) {
      results.ctf = { rows: 0, error: err.message?.slice(0, 200) }
    }

    // ===== 3. NegRisk Conversions =====
    try {
      const wm = await getOnchainWatermark('onchain_negrisk')
      if (!wm) {
        await updateOnchainWatermark('onchain_negrisk', tipBlock, tsCtx.interpolate(tipBlock), 0)
        results.negrisk = { rows: 0, fromBlock: tipBlock, toBlock: tipBlock }
      }
      const wmBlock = wm?.last_block_number || tipBlock
      const fromBlock = wm ? Math.max(0, wmBlock - OVERLAP_BLOCKS) : tipBlock
      const toBlock = Math.min(tipBlock, wmBlock + MAX_BLOCKS_NORMAL)

      if (wm && fromBlock < toBlock) {
        const logs = await fetchLogs(
          NEGRISK_ADAPTER,
          [POSITIONS_CONVERTED_TOPIC],
          fromBlock,
          toBlock,
        )

        let rowCount = 0
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
            rowCount = rows.length
          }
        }

        await updateOnchainWatermark('onchain_negrisk', toBlock, tsCtx.interpolate(toBlock), rowCount)
        results.negrisk = { rows: rowCount, fromBlock, toBlock }
      } else {
        results.negrisk = { rows: 0 }
      }
    } catch (err: any) {
      results.negrisk = { rows: 0, error: err.message?.slice(0, 200) }
    }

    // ===== 4. Condition Resolutions =====
    try {
      const wm = await getOnchainWatermark('onchain_resolution')
      if (!wm) {
        await updateOnchainWatermark('onchain_resolution', tipBlock, tsCtx.interpolate(tipBlock), 0)
        results.resolution = { rows: 0, fromBlock: tipBlock, toBlock: tipBlock }
      }
      const wmBlock = wm?.last_block_number || tipBlock
      const fromBlock = wm ? Math.max(0, wmBlock - OVERLAP_BLOCKS) : tipBlock
      const toBlock = Math.min(tipBlock, wmBlock + MAX_BLOCKS_NORMAL)

      if (wm && fromBlock < toBlock) {
        const logs = await fetchLogs(
          RESOLUTION_CONTRACT,
          [CONDITION_RESOLUTION_TOPIC],
          fromBlock,
          toBlock,
        )

        let rowCount = 0
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
            rowCount = rows.length
          }
        }

        await updateOnchainWatermark('onchain_resolution', toBlock, tsCtx.interpolate(toBlock), rowCount)
        results.resolution = { rows: rowCount, fromBlock, toBlock }
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

    await logCronExecution({
      cron_name: 'ingest-onchain',
      status: hasErrors ? 'failure' : 'success',
      duration_ms: durationMs,
      details: { block: tipBlock, totalRows, ...results },
    })

    // Alert on partial failures (some sources errored but others succeeded)
    if (hasErrors) {
      const errorSources = Object.entries(results)
        .filter(([, v]) => v.error)
        .map(([k, v]) => `${k}: ${v.error}`)
        .join('; ')
      await sendCronFailureAlert({
        cronName: 'ingest-onchain',
        error: `Partial failure at block ${tipBlock}: ${errorSources}`,
      })
    }

    return NextResponse.json({
      success: !hasErrors,
      block: tipBlock,
      totalRows,
      results,
      elapsed_ms: durationMs,
    })
  } catch (error) {
    // Total failure — couldn't even get chain tip or init timestamp
    const durationMs = Date.now() - startTime
    console.error('ingest-onchain fatal error:', error)

    await logCronExecution({
      cron_name: 'ingest-onchain',
      status: 'failure',
      duration_ms: durationMs,
      error_message: String(error),
    })
    await sendCronFailureAlert({
      cronName: 'ingest-onchain',
      error: String(error),
    })

    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 },
    )
  }
}
