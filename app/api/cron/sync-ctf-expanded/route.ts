/**
 * Cron: Sync CTF Split/Merge Expanded Table (Incremental)
 *
 * Incrementally syncs from pm_ctf_events to pm_ctf_split_merge_expanded.
 * Expands each Split/Merge event to per-outcome records (2 rows per event).
 *
 * Auth: Requires CRON_SECRET via Bearer token or query param
 * Frequency: Every 30 minutes
 */

import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const maxDuration = 60

const BUFFER_MINUTES = 10 // Overlap to catch late-arriving rows

interface SyncResult {
  success: boolean
  skipped: boolean
  sourceLatest: string
  targetLatestBefore: string
  targetLatestAfter: string
  rowsInserted: number
  freshnessGapMinutes: number
  durationMs: number
  error?: string
}

export async function GET() {
  const startTime = Date.now()

  try {
    // Get latest timestamps from both tables
    const [sourceResult, targetResult] = await Promise.all([
      clickhouse.query({
        query: `SELECT max(event_timestamp) as latest FROM pm_ctf_events WHERE event_type IN ('PositionSplit', 'PositionsMerge')`,
        format: 'JSONEachRow'
      }),
      clickhouse.query({
        query: `SELECT max(event_timestamp) as latest FROM pm_ctf_split_merge_expanded`,
        format: 'JSONEachRow'
      })
    ])

    const sourceLatest = ((await sourceResult.json()) as any[])[0]?.latest as string
    const targetLatestBefore = ((await targetResult.json()) as any[])[0]?.latest as string || '1970-01-01 00:00:00'

    // Check if sync is needed
    const sourceMs = new Date(sourceLatest + 'Z').getTime()
    const targetMs = new Date(targetLatestBefore + 'Z').getTime()
    const gapMinutes = (sourceMs - targetMs) / 1000 / 60

    if (gapMinutes <= 1) {
      const result: SyncResult = {
        success: true,
        skipped: true,
        sourceLatest,
        targetLatestBefore,
        targetLatestAfter: targetLatestBefore,
        rowsInserted: 0,
        freshnessGapMinutes: gapMinutes,
        durationMs: Date.now() - startTime
      }
      return NextResponse.json(result)
    }

    // Insert delta from pm_ctf_events to pm_ctf_split_merge_expanded
    // Uses arrayJoin to expand each event to both outcomes (0 and 1)
    const fromTime = targetLatestBefore

    await clickhouse.command({
      query: `
        INSERT INTO pm_ctf_split_merge_expanded
        SELECT
          lower(user_address) AS wallet,
          lower(
            CASE
              WHEN startsWith(condition_id, '0x') THEN substring(condition_id, 3)
              ELSE condition_id
            END
          ) AS condition_id,
          idx AS outcome_index,
          event_type,
          CASE
            WHEN event_type = 'PositionSplit' THEN -(toFloat64(amount_or_payout) / 1000000)
            WHEN event_type = 'PositionsMerge' THEN +(toFloat64(amount_or_payout) / 1000000)
            ELSE 0
          END AS cash_delta,
          CASE
            WHEN event_type = 'PositionSplit' THEN +(toFloat64(amount_or_payout) / 1000000)
            WHEN event_type = 'PositionsMerge' THEN -(toFloat64(amount_or_payout) / 1000000)
            ELSE 0
          END AS shares_delta,
          toUInt256(amount_or_payout) AS amount_raw,
          event_timestamp,
          block_number,
          tx_hash,
          concat(id, '_out', toString(idx)) AS id
        FROM pm_ctf_events
        ARRAY JOIN [0, 1] AS idx
        WHERE event_type IN ('PositionSplit', 'PositionsMerge')
          AND event_timestamp >= toDateTime('${fromTime}', 'UTC') - INTERVAL ${BUFFER_MINUTES} MINUTE
          AND event_timestamp <= toDateTime('${sourceLatest}', 'UTC')
        SETTINGS max_memory_usage = 4000000000
      `
    })

    // Count rows inserted
    const countResult = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM pm_ctf_split_merge_expanded
        WHERE event_timestamp >= toDateTime('${fromTime}', 'UTC') - INTERVAL ${BUFFER_MINUTES} MINUTE
      `,
      format: 'JSONEachRow'
    })
    const rowsInserted = Number(((await countResult.json()) as any[])[0]?.cnt || 0)

    // Verify new latest
    const targetAfterResult = await clickhouse.query({
      query: `SELECT max(event_timestamp) as latest FROM pm_ctf_split_merge_expanded`,
      format: 'JSONEachRow'
    })
    const targetLatestAfter = ((await targetAfterResult.json()) as any[])[0]?.latest as string

    const afterMs = new Date(targetLatestAfter + 'Z').getTime()
    const freshnessGapMinutes = (sourceMs - afterMs) / 1000 / 60

    const result: SyncResult = {
      success: true,
      skipped: false,
      sourceLatest,
      targetLatestBefore,
      targetLatestAfter,
      rowsInserted,
      freshnessGapMinutes,
      durationMs: Date.now() - startTime
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[sync-ctf-expanded] Error:', error)

    const result: SyncResult = {
      success: false,
      skipped: false,
      sourceLatest: '',
      targetLatestBefore: '',
      targetLatestAfter: '',
      rowsInserted: 0,
      freshnessGapMinutes: -1,
      durationMs: Date.now() - startTime,
      error: error.message
    }

    return NextResponse.json(result, { status: 500 })
  }
}
