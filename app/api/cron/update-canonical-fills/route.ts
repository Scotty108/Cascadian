import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { sendCronFailureAlert } from '@/lib/alerts/discord'

const OVERLAP_BLOCKS = 1000 // ~3 min overlap to catch late arrivals
const MAX_BLOCKS_PER_RUN = 50000 // Limit blocks per run to prevent timeout (~2.5 hours of blocks)

interface Watermark {
  source: string
  last_block_number: number
  last_event_time: string
}

async function getWatermarks(): Promise<Map<string, Watermark>> {
  const result = await clickhouse.query({
    query: `SELECT source, last_block_number, last_event_time FROM pm_ingest_watermarks_v1 FINAL`,
    format: 'JSONEachRow'
  })
  const rows = await result.json() as Watermark[]
  const map = new Map<string, Watermark>()
  for (const row of rows) {
    map.set(row.source, row)
  }
  return map
}

async function updateWatermark(source: string, lastBlock: number, lastTime: string, rowsProcessed: number) {
  await clickhouse.command({
    query: `
      INSERT INTO pm_ingest_watermarks_v1 (source, last_block_number, last_event_time, rows_processed)
      VALUES ('${source}', ${lastBlock}, '${lastTime}', ${rowsProcessed})
    `
  })
}

async function getLatestBlock(source: string): Promise<{ block: number; time: string }> {
  let query = ''
  if (source === 'clob') {
    query = `SELECT max(block_number) as block, max(trade_time) as time FROM pm_trader_events_v3`
  } else if (source === 'ctf') {
    query = `SELECT max(block_number) as block, max(event_timestamp) as time FROM pm_ctf_split_merge_expanded`
  } else if (source === 'negrisk') {
    query = `SELECT max(block_number) as block, max(block_timestamp) as time FROM vw_negrisk_conversions`
  }

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const rows = await result.json() as any[]
  return { block: rows[0]?.block || 0, time: rows[0]?.time || '2020-01-01' }
}

async function processCLOB(watermark: Watermark | undefined): Promise<number> {
  const latest = await getLatestBlock('clob')
  const startBlock = watermark ? Math.max(0, watermark.last_block_number - OVERLAP_BLOCKS) : 0
  // Cap end block to prevent timeout
  const endBlock = Math.min(latest.block, startBlock + MAX_BLOCKS_PER_RUN)

  if (startBlock >= endBlock) {
    return 0
  }

  // Skip self-fill detection to avoid memory issues - process all fills
  await clickhouse.command({
    query: `
      INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
      SELECT
        concat('clob_', event_id) as fill_id,
        trade_time as event_time,
        block_number,
        transaction_hash as tx_hash,
        trader_wallet as wallet,
        m.condition_id,
        m.outcome_index,
        CASE WHEN side = 'buy' THEN token_amount / 1e6 ELSE -token_amount / 1e6 END as tokens_delta,
        CASE WHEN side = 'buy' THEN -usdc_amount / 1e6 ELSE usdc_amount / 1e6 END as usdc_delta,
        'clob' as source,
        0 as is_self_fill,
        role = 'maker' as is_maker
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE t.block_number > ${startBlock} AND t.block_number <= ${endBlock}
        AND m.condition_id != ''
      SETTINGS max_memory_usage = 8000000000
    `
  })

  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source = 'clob' AND block_number > ${startBlock} AND block_number <= ${endBlock}`,
    format: 'JSONEachRow'
  })
  const rows = await countResult.json() as any[]
  const count = rows[0]?.cnt || 0

  // Update watermark to endBlock (not latest) so we catch up incrementally
  await updateWatermark('clob', endBlock, latest.time, count)
  return count
}

async function processCTF(watermark: Watermark | undefined): Promise<number> {
  const latest = await getLatestBlock('ctf')
  const startBlock = watermark ? Math.max(0, watermark.last_block_number - OVERLAP_BLOCKS) : 0
  const endBlock = Math.min(latest.block, startBlock + MAX_BLOCKS_PER_RUN)

  if (startBlock >= endBlock) {
    return 0
  }

  // CTF Tokens
  await clickhouse.command({
    query: `
      INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
      SELECT
        concat('ctf_', id) as fill_id,
        event_timestamp as event_time,
        block_number,
        tx_hash,
        wallet,
        condition_id,
        outcome_index,
        shares_delta as tokens_delta,
        0 as usdc_delta,
        'ctf_token' as source,
        0 as is_self_fill,
        0 as is_maker
      FROM pm_ctf_split_merge_expanded
      WHERE block_number > ${startBlock} AND block_number <= ${endBlock}
        AND condition_id != ''
      SETTINGS max_memory_usage = 8000000000
    `
  })

  // CTF Cash - use subquery to avoid alias conflict
  await clickhouse.command({
    query: `
      INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
      SELECT
        concat('ctf_cash_', condition_id, '_', tx_hash) as fill_id,
        min_event_time as event_time,
        min_block as block_number,
        tx_hash,
        wallet,
        condition_id,
        0 as outcome_index,
        0 as tokens_delta,
        cash_sum / 2 as usdc_delta,
        'ctf_cash' as source,
        0 as is_self_fill,
        0 as is_maker
      FROM (
        SELECT
          wallet,
          condition_id,
          tx_hash,
          min(event_timestamp) as min_event_time,
          min(block_number) as min_block,
          sum(cash_delta) as cash_sum
        FROM pm_ctf_split_merge_expanded
        WHERE block_number > ${startBlock} AND block_number <= ${endBlock}
          AND condition_id != ''
          AND cash_delta != 0
        GROUP BY wallet, condition_id, tx_hash
      )
      SETTINGS max_memory_usage = 8000000000
    `
  })

  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source IN ('ctf_token', 'ctf_cash') AND block_number > ${startBlock} AND block_number <= ${endBlock}`,
    format: 'JSONEachRow'
  })
  const rows = await countResult.json() as any[]
  const count = rows[0]?.cnt || 0

  await updateWatermark('ctf', endBlock, latest.time, count)
  return count
}

async function processNegRisk(watermark: Watermark | undefined): Promise<number> {
  const latest = await getLatestBlock('negrisk')
  const startBlock = watermark ? Math.max(0, watermark.last_block_number - OVERLAP_BLOCKS) : 0
  const endBlock = Math.min(latest.block, startBlock + MAX_BLOCKS_PER_RUN)

  if (startBlock >= endBlock) {
    return 0
  }

  await clickhouse.command({
    query: `
      INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
      SELECT
        concat('negrisk_', v.tx_hash, '_', v.token_id_hex) as fill_id,
        v.block_timestamp as event_time,
        v.block_number,
        v.tx_hash,
        v.wallet,
        m.condition_id,
        m.outcome_index,
        v.shares as tokens_delta,
        0 as usdc_delta,
        'negrisk' as source,
        0 as is_self_fill,
        0 as is_maker
      FROM vw_negrisk_conversions v
      JOIN pm_negrisk_token_map_v1 m ON v.token_id_hex = m.token_id_hex
      WHERE v.block_number > ${startBlock} AND v.block_number <= ${endBlock}
        AND m.condition_id != ''
      SETTINGS max_memory_usage = 8000000000
    `
  })

  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source = 'negrisk' AND block_number > ${startBlock} AND block_number <= ${endBlock}`,
    format: 'JSONEachRow'
  })
  const rows = await countResult.json() as any[]
  const count = rows[0]?.cnt || 0

  await updateWatermark('negrisk', endBlock, latest.time, count)
  return count
}

export async function GET() {
  const startTime = Date.now()

  try {
    const watermarks = await getWatermarks()

    const clobCount = await processCLOB(watermarks.get('clob'))
    const ctfCount = await processCTF(watermarks.get('ctf'))
    const nrCount = await processNegRisk(watermarks.get('negrisk'))

    const totalNew = clobCount + ctfCount + nrCount
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

    return NextResponse.json({
      success: true,
      fills_added: {
        clob: clobCount,
        ctf: ctfCount,
        negrisk: nrCount,
        total: totalNew
      },
      elapsed_seconds: parseFloat(elapsed)
    })
  } catch (error) {
    console.error('Canonical fills update error:', error)
    await sendCronFailureAlert({ cronName: 'update-canonical-fills', error: String(error) })
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    )
  }
}
