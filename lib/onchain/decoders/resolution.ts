/**
 * ConditionResolution event decoder.
 *
 * Decodes ConditionResolution events from the CTF contract.
 * These fire when a market resolves (oracle reports outcome).
 * Target table: pm_condition_resolutions
 *
 * Extracted from: scripts/sync-resolutions-incremental.ts
 */

import { ethers } from 'ethers'
import type { RpcLog, ResolutionRow } from '../types'

const CONDITION_RESOLUTION_ABI = [
  'event ConditionResolution(bytes32 indexed conditionId, address indexed oracle, bytes32 indexed questionId, uint outcomeSlotCount, uint256[] payoutNumerators)',
]

const iface = new ethers.Interface(CONDITION_RESOLUTION_ABI)

export const CONDITION_RESOLUTION_TOPIC = iface.getEvent('ConditionResolution')!.topicHash

// Same contract as CTF events
export const RESOLUTION_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'

/**
 * Decode a ConditionResolution log into a ResolutionRow.
 * Returns null if the event cannot be decoded or has zero payout denominator.
 */
export function decodeResolutionEvent(
  log: RpcLog,
  timestampFn: (blockNumber: number) => string,
): ResolutionRow | null {
  try {
    const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
    if (!parsed) return null

    const conditionId = parsed.args[0] as string // conditionId (bytes32)
    const payoutNumerators = parsed.args[4] as bigint[] // payoutNumerators array
    const payoutDenominator = payoutNumerators.reduce((sum, n) => sum + n, 0n)

    if (payoutDenominator === 0n) return null

    const blockNumber = parseInt(log.blockNumber, 16)

    return {
      condition_id: conditionId.toLowerCase().replace('0x', ''),
      payout_numerators: JSON.stringify(payoutNumerators.map(n => n.toString())),
      payout_denominator: payoutDenominator.toString(),
      resolved_at: timestampFn(blockNumber),
      block_number: blockNumber,
      tx_hash: log.transactionHash,
      is_deleted: 0,
    }
  } catch {
    return null
  }
}
