/**
 * Block timestamp interpolation for Polygon.
 *
 * Fetches the actual timestamp for one reference block (the chain tip),
 * then interpolates timestamps for other blocks using Polygon's ~2s/block average.
 * Accuracy: ±5 seconds, which is sufficient for all our tables.
 *
 * Costs 1 RPC call per cron invocation.
 */

import { rpcCallWithFailover } from './rpc'

const SECS_PER_BLOCK = 2.0 // Polygon average

export interface TimestampContext {
  tipBlock: number
  tipTimestamp: number
  interpolate: (blockNumber: number) => string
}

/**
 * Initialize timestamp interpolation from the chain tip.
 * Call once per cron invocation, then use `ctx.interpolate(blockNumber)` for each event.
 */
export async function initTimestamp(tipBlock: number): Promise<TimestampContext> {
  const block = await rpcCallWithFailover(
    'eth_getBlockByNumber',
    ['0x' + tipBlock.toString(16), false],
  )
  const tipTimestamp = parseInt(block.timestamp, 16)

  return {
    tipBlock,
    tipTimestamp,
    interpolate: (blockNumber: number): string => {
      const ts = tipTimestamp - Math.round((tipBlock - blockNumber) * SECS_PER_BLOCK)
      return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19)
    },
  }
}
