/**
 * Polygon RPC client with automatic failover across 3 free providers.
 *
 * Layer 1 of redundancy: if the primary RPC is down or rate-limited,
 * we transparently fall through to the next provider.
 */

import type { RpcLog } from './types'

interface RpcEndpoint {
  url: string
  maxBlockRange: number
}

const RPC_ENDPOINTS: RpcEndpoint[] = [
  { url: 'https://polygon.drpc.org', maxBlockRange: 10_000 },
  { url: 'https://polygon-pokt.nodies.app', maxBlockRange: 500 },
  { url: 'https://polygon.gateway.tenderly.co', maxBlockRange: 500 },
]

const RPC_TIMEOUT_MS = 30_000

/**
 * Make an RPC call with automatic failover across all providers.
 * Throws only if ALL providers fail.
 */
export async function rpcCallWithFailover(method: string, params: unknown[]): Promise<any> {
  const errors: string[] = []

  for (const rpc of RPC_ENDPOINTS) {
    try {
      const resp = await fetch(rpc.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      })
      const data = await resp.json()
      if (data.error) {
        throw new Error(`RPC error: ${data.error.message}`)
      }
      return data.result
    } catch (err: any) {
      const msg = err.message?.slice(0, 120) || 'unknown'
      errors.push(`${rpc.url}: ${msg}`)
      continue
    }
  }

  throw new Error(`All ${RPC_ENDPOINTS.length} RPCs failed: ${errors.join(' | ')}`)
}

/**
 * Get the current chain tip block number.
 */
export async function getChainTip(): Promise<number> {
  const hex = await rpcCallWithFailover('eth_blockNumber', [])
  return parseInt(hex, 16)
}

/**
 * Fetch logs for a set of addresses and topics across a block range.
 * Automatically splits the range if it exceeds the primary provider's limit,
 * falling back to smaller ranges for providers with tighter limits.
 */
export async function fetchLogs(
  addresses: string | string[],
  topics: (string | string[])[],
  fromBlock: number,
  toBlock: number,
): Promise<RpcLog[]> {
  const addressParam = Array.isArray(addresses) ? addresses : [addresses]

  // Try the primary RPC first with its full block range capability
  const primary = RPC_ENDPOINTS[0]
  const range = toBlock - fromBlock

  if (range <= primary.maxBlockRange) {
    // Single request — use failover
    return await rpcCallWithFailover('eth_getLogs', [{
      address: addressParam.length === 1 ? addressParam[0] : addressParam,
      topics,
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
    }]) || []
  }

  // Range too large — chunk it using the smallest safe range (500 blocks)
  const chunkSize = 500
  const allLogs: RpcLog[] = []

  for (let block = fromBlock; block <= toBlock; block += chunkSize) {
    const end = Math.min(block + chunkSize - 1, toBlock)
    const logs = await rpcCallWithFailover('eth_getLogs', [{
      address: addressParam.length === 1 ? addressParam[0] : addressParam,
      topics,
      fromBlock: '0x' + block.toString(16),
      toBlock: '0x' + end.toString(16),
    }]) || []
    allLogs.push(...logs)
  }

  return allLogs
}
