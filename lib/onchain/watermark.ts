/**
 * Watermark management for on-chain ingestion.
 *
 * Layer 2 of redundancy: watermarks only advance AFTER successful
 * ClickHouse insert. If the cron crashes, next run resumes from
 * the last successful position.
 *
 * Uses existing pm_ingest_watermarks_v1 table (SharedReplacingMergeTree).
 */

import { clickhouse } from '@/lib/clickhouse/client'
import type { OnchainWatermark } from './types'

/**
 * Read the current watermark for a given source.
 * Returns null if no watermark exists (first run).
 */
export async function getOnchainWatermark(source: string): Promise<OnchainWatermark | null> {
  const result = await clickhouse.query({
    query: `
      SELECT source, last_block_number, last_event_time, rows_processed
      FROM pm_ingest_watermarks_v1 FINAL
      WHERE source = '${source}'
    `,
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as OnchainWatermark[]
  return rows.length > 0 ? rows[0] : null
}

/**
 * Update the watermark after a successful insert.
 * Uses INSERT (not UPDATE) — ReplacingMergeTree deduplicates by source key.
 */
export async function updateOnchainWatermark(
  source: string,
  lastBlock: number,
  lastTime: string,
  rowsProcessed: number,
): Promise<void> {
  await clickhouse.command({
    query: `
      INSERT INTO pm_ingest_watermarks_v1 (source, last_block_number, last_event_time, rows_processed)
      VALUES ('${source}', ${lastBlock}, '${lastTime}', ${rowsProcessed})
    `,
  })
}

/**
 * Read all on-chain watermarks at once (for health checks and catchup logic).
 */
export async function getAllOnchainWatermarks(): Promise<Map<string, OnchainWatermark>> {
  const result = await clickhouse.query({
    query: `
      SELECT source, last_block_number, last_event_time, rows_processed
      FROM pm_ingest_watermarks_v1 FINAL
      WHERE source LIKE 'onchain_%'
    `,
    format: 'JSONEachRow',
  })
  const rows = (await result.json()) as OnchainWatermark[]
  const map = new Map<string, OnchainWatermark>()
  for (const row of rows) {
    map.set(row.source, row)
  }
  return map
}
