/**
 * CTF (Conditional Token Framework) event decoder.
 *
 * Decodes PositionSplit, PositionsMerge, and PayoutRedemption events
 * from the ConditionalTokenFramework contract on Polygon.
 * Target table: pm_ctf_events
 *
 * Extracted from: scripts/migration/backfill-ctf-gap.ts
 */

import { ethers } from 'ethers'
import type { RpcLog, CTFRow } from '../types'

export const CTF_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'

export const CTF_TOPICS = {
  PositionSplit: '0x2e6bb91f8cbcda0c93623c54d0403a43514fabc40084ec96b6d5379a74786298',
  PositionsMerge: '0x6f13ca62553fcc2bcd2372180a43949c1e4cebba603901ede2f4e14f36b282ca',
  PayoutRedemption: '0x2682012a4a4f1973119f1c9b90745d1bd91fa2bab387344f044cb3586864d18d',
}

/** All 3 topic hashes as an array for eth_getLogs filter */
export const CTF_TOPIC_FILTER = [
  CTF_TOPICS.PositionSplit,
  CTF_TOPICS.PositionsMerge,
  CTF_TOPICS.PayoutRedemption,
]

const iface = new ethers.Interface([
  'event PositionSplit(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)',
  'event PositionsMerge(address indexed stakeholder, address collateralToken, bytes32 indexed parentCollectionId, bytes32 indexed conditionId, uint256[] partition, uint256 amount)',
  'event PayoutRedemption(address indexed redeemer, address indexed collateralToken, bytes32 indexed parentCollectionId, bytes32 conditionId, uint256[] indexSets, uint256 payout)',
])

/**
 * Decode a single CTF log into a CTFRow.
 * Returns null if the log cannot be decoded.
 */
export function decodeCTFEvent(
  log: RpcLog,
  timestampFn: (blockNumber: number) => string,
): CTFRow | null {
  const topic0 = log.topics[0]
  let eventName: string

  if (topic0 === CTF_TOPICS.PositionSplit) eventName = 'PositionSplit'
  else if (topic0 === CTF_TOPICS.PositionsMerge) eventName = 'PositionsMerge'
  else if (topic0 === CTF_TOPICS.PayoutRedemption) eventName = 'PayoutRedemption'
  else return null

  try {
    const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
    if (!parsed) return null

    const blockNumber = parseInt(log.blockNumber, 16)
    const logIndex = parseInt(log.logIndex, 16)

    if (eventName === 'PayoutRedemption') {
      return {
        event_type: eventName,
        user_address: parsed.args.redeemer.toLowerCase(),
        collateral_token: parsed.args.collateralToken.toLowerCase(),
        parent_collection_id: parsed.args.parentCollectionId,
        condition_id: parsed.args.conditionId,
        partition_index_sets: JSON.stringify(parsed.args.indexSets.map((n: bigint) => n.toString())),
        amount_or_payout: parsed.args.payout.toString(),
        event_timestamp: timestampFn(blockNumber),
        block_number: blockNumber,
        tx_hash: log.transactionHash.slice(2),
        id: `${log.transactionHash}_${logIndex}`,
      }
    }

    return {
      event_type: eventName,
      user_address: parsed.args.stakeholder.toLowerCase(),
      collateral_token: parsed.args.collateralToken.toLowerCase(),
      parent_collection_id: parsed.args.parentCollectionId,
      condition_id: parsed.args.conditionId,
      partition_index_sets: JSON.stringify(parsed.args.partition.map((n: bigint) => n.toString())),
      amount_or_payout: parsed.args.amount.toString(),
      event_timestamp: timestampFn(blockNumber),
      block_number: blockNumber,
      tx_hash: log.transactionHash.slice(2),
      id: `${log.transactionHash}_${logIndex}`,
    }
  } catch {
    return null
  }
}
