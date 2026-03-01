/**
 * CLOB OrderFilled event decoder.
 *
 * Decodes OrderFilled events from both CTFExchange and NegRiskExchange contracts.
 * Each event produces 2 canonical fill rows (maker + taker), or 1 if self-fill.
 * Writes directly to pm_canonical_fills_v4.
 *
 * Extracted from: scripts/migration/backfill-clob-gap.ts
 */

import { ethers } from 'ethers'
import { clickhouse } from '@/lib/clickhouse/client'
import type { RpcLog, CanonicalFillRow } from '../types'

export const EXCHANGE_CONTRACTS = [
  '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', // CTFExchange
  '0xC5d563A36AE78145C45a50134d48A1215220f80a', // NegRiskExchange
]

const iface = new ethers.Interface([
  'event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)',
])

export const ORDER_FILLED_TOPIC = iface.getEvent('OrderFilled')!.topicHash

/**
 * Decode a single OrderFilled log into canonical fill rows.
 * Returns 2 rows (maker + taker), or 1 if self-fill (maker === taker).
 * Returns empty array if token is not in the map.
 */
export function decodeOrderFilled(
  log: RpcLog,
  exchangeAddr: string,
  tokenMap: Map<string, { condition_id: string; outcome_index: number }>,
  timestampFn: (blockNumber: number) => string,
): CanonicalFillRow[] {
  try {
    const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
    if (!parsed) return []

    const blockNumber = parseInt(log.blockNumber, 16)
    const logIndex = parseInt(log.logIndex, 16)
    const timestamp = timestampFn(blockNumber)

    const maker = parsed.args.maker.toLowerCase()
    const taker = parsed.args.taker.toLowerCase()
    const makerAssetId = parsed.args.makerAssetId.toString()
    const takerAssetId = parsed.args.takerAssetId.toString()
    const makerAmountFilled = Number(parsed.args.makerAmountFilled)
    const takerAmountFilled = Number(parsed.args.takerAmountFilled)

    const makerIsBuyer = makerAssetId === '0'
    const tokenId = makerIsBuyer ? takerAssetId : makerAssetId
    const usdcAmount = makerIsBuyer ? makerAmountFilled : takerAmountFilled
    const tokenAmount = makerIsBuyer ? takerAmountFilled : makerAmountFilled

    const mapping = tokenMap.get(tokenId)
    if (!mapping) return [] // Unmapped token — skip, fix-unmapped-tokens cron will catch it

    const isNegRisk = exchangeAddr.toLowerCase() === EXCHANGE_CONTRACTS[1].toLowerCase()
    const source = isNegRisk ? 'negrisk' : 'clob'
    const txHash = log.transactionHash.slice(2)
    const baseId = `${txHash}_${logIndex}`
    const isSelfFill = maker === taker ? 1 : 0

    const rows: CanonicalFillRow[] = [{
      fill_id: `onchain_${baseId}_m`,
      event_time: timestamp,
      block_number: blockNumber,
      tx_hash: txHash,
      wallet: maker,
      condition_id: mapping.condition_id,
      outcome_index: mapping.outcome_index,
      tokens_delta: makerIsBuyer ? tokenAmount / 1e6 : -tokenAmount / 1e6,
      usdc_delta: makerIsBuyer ? -usdcAmount / 1e6 : usdcAmount / 1e6,
      source,
      is_self_fill: isSelfFill,
      is_maker: 1,
    }]

    if (!isSelfFill) {
      rows.push({
        fill_id: `onchain_${baseId}_t`,
        event_time: timestamp,
        block_number: blockNumber,
        tx_hash: txHash,
        wallet: taker,
        condition_id: mapping.condition_id,
        outcome_index: mapping.outcome_index,
        tokens_delta: makerIsBuyer ? -tokenAmount / 1e6 : tokenAmount / 1e6,
        usdc_delta: makerIsBuyer ? usdcAmount / 1e6 : -usdcAmount / 1e6,
        source,
        is_self_fill: 0,
        is_maker: 0,
      })
    }

    return rows
  } catch {
    return []
  }
}

/**
 * Extract unique token IDs from a batch of OrderFilled logs.
 * Used to batch-query the token map for just the tokens we need.
 */
export function extractTokenIds(logs: RpcLog[]): string[] {
  const tokenIds = new Set<string>()
  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
      if (!parsed) continue
      const makerAssetId = parsed.args.makerAssetId.toString()
      const takerAssetId = parsed.args.takerAssetId.toString()
      if (makerAssetId !== '0') tokenIds.add(makerAssetId)
      if (takerAssetId !== '0') tokenIds.add(takerAssetId)
    } catch {
      continue
    }
  }
  return [...tokenIds]
}

/**
 * Batch-load token mappings from ClickHouse for a set of token IDs.
 * This runs once per cron invocation with just the tokens seen in this batch.
 */
export async function loadTokenMapForBatch(
  tokenIds: string[],
): Promise<Map<string, { condition_id: string; outcome_index: number }>> {
  const map = new Map<string, { condition_id: string; outcome_index: number }>()
  if (tokenIds.length === 0) return map

  const escapedIds = tokenIds.map(id => `'${id}'`).join(',')
  const result = await clickhouse.query({
    query: `
      SELECT token_id_dec, condition_id, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (${escapedIds})
        AND condition_id != ''
    `,
    format: 'JSONEachRow',
  })

  const rows = (await result.json()) as { token_id_dec: string; condition_id: string; outcome_index: number }[]
  for (const row of rows) {
    map.set(row.token_id_dec, { condition_id: row.condition_id, outcome_index: row.outcome_index })
  }
  return map
}
