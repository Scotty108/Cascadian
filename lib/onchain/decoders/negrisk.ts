/**
 * NegRisk PositionsConverted event decoder.
 *
 * Decodes PositionsConverted events from the NegRisk Adapter contract.
 * This is the simplest decoder — pure topic/data parsing, no ethers.Interface needed.
 * Target table: pm_neg_risk_conversions_v1
 *
 * Extracted from: scripts/migration/backfill-negrisk-gap.ts
 */

import type { RpcLog, NegRiskRow } from '../types'

export const NEGRISK_ADAPTER = '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296'

export const POSITIONS_CONVERTED_TOPIC =
  '0xb03d19dddbc72a87e735ff0ea3b57bef133ebe44e1894284916a84044deb367e'

/**
 * Decode a PositionsConverted log into a NegRiskRow.
 *
 * Event: PositionsConverted(address indexed stakeholder, bytes32 indexed marketId, uint256 indexed indexSet, uint256 amount)
 * - topics[1] = stakeholder (address, padded to 32 bytes)
 * - topics[2] = marketId (bytes32)
 * - topics[3] = indexSet (uint256)
 * - data = amount (uint256)
 */
export function decodeNegRiskEvent(
  log: RpcLog,
  timestampFn: (blockNumber: number) => string,
): NegRiskRow {
  const blockNumber = parseInt(log.blockNumber, 16)
  const logIndex = parseInt(log.logIndex, 16)
  const stakeholder = '0x' + log.topics[1].slice(26).toLowerCase()
  const marketId = log.topics[2]
  const indexSet = BigInt(log.topics[3]).toString()
  const amount = BigInt(log.data).toString()

  return {
    event_type: 'PositionsConverted',
    user_address: stakeholder,
    market_id: marketId,
    index_set: indexSet,
    amount,
    event_timestamp: timestampFn(blockNumber),
    block_number: blockNumber,
    tx_hash: log.transactionHash.slice(2),
    id: `${log.transactionHash}_${logIndex}`,
  }
}
