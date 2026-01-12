import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

const RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || ''
const CTF_CONTRACT = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045'
const BLOCKS_PER_REQUEST = 500
const MAX_BLOCKS_PER_RUN = 2000 // ~50 seconds of processing, fits Vercel timeout

interface TransferRow {
  tx_hash: string
  log_index: number
  block_number: number
  block_timestamp: string
  contract: string
  token_id: string
  from_address: string
  to_address: string
  value: string
  operator: string
  is_deleted: number
}

async function getLatestBlock(): Promise<number> {
  const resp = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: []
    })
  })
  const data = await resp.json()
  return parseInt(data.result, 16)
}

async function fetchTransfers(fromBlock: number, toBlock: number): Promise<any[]> {
  const resp = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.random(),
      method: 'alchemy_getAssetTransfers',
      params: [{
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
        contractAddresses: [CTF_CONTRACT],
        category: ['erc1155'],
        maxCount: '0x3e8',
        withMetadata: true,
        excludeZeroValue: false
      }]
    })
  })

  const data = await resp.json()
  if (data.error) throw new Error(data.error.message)
  return data.result?.transfers || []
}

function convertToRows(transfers: any[]): TransferRow[] {
  const rows: TransferRow[] = []
  for (const t of transfers) {
    const blockNum = parseInt(t.blockNum, 16)
    // Convert ISO timestamp to ClickHouse DateTime format (YYYY-MM-DD HH:MM:SS)
    const isoTimestamp = t.metadata?.blockTimestamp || '1970-01-01T00:00:00Z'
    const timestamp = isoTimestamp.replace('T', ' ').replace('Z', '').split('.')[0]
    const logIndex = t.uniqueId?.split(':')[2] ? parseInt(t.uniqueId.split(':')[2]) : 0

    if (t.erc1155Metadata) {
      for (const token of t.erc1155Metadata) {
        rows.push({
          tx_hash: t.hash,
          log_index: logIndex,
          block_number: blockNum,
          block_timestamp: timestamp,
          contract: t.rawContract.address,
          token_id: token.tokenId,
          from_address: t.from,
          to_address: t.to,
          value: token.value,
          operator: t.from,
          is_deleted: 0
        })
      }
    }
  }
  return rows
}

export async function GET() {
  const startTime = Date.now()

  try {
    if (!RPC_URL) {
      return NextResponse.json({ error: 'ALCHEMY_POLYGON_RPC_URL not configured' }, { status: 500 })
    }

    // Get current state
    const result = await clickhouse.query({
      query: 'SELECT max(block_number) as max_block FROM pm_erc1155_transfers WHERE is_deleted = 0',
      format: 'JSONEachRow'
    })
    const current = (await result.json() as any[])[0]
    const startBlock = Number(current.max_block) + 1

    const latestBlock = await getLatestBlock()
    const blocksToProcess = Math.min(latestBlock - startBlock, MAX_BLOCKS_PER_RUN)

    if (blocksToProcess <= 0) {
      return NextResponse.json({
        status: 'up_to_date',
        lastBlock: startBlock - 1,
        chainBlock: latestBlock
      })
    }

    const endBlock = startBlock + blocksToProcess
    let totalInserted = 0

    // Process in chunks
    for (let block = startBlock; block < endBlock; block += BLOCKS_PER_REQUEST) {
      const chunkEnd = Math.min(block + BLOCKS_PER_REQUEST - 1, endBlock - 1)

      const transfers = await fetchTransfers(block, chunkEnd)
      const rows = convertToRows(transfers)

      if (rows.length > 0) {
        await clickhouse.insert({
          table: 'pm_erc1155_transfers',
          values: rows,
          format: 'JSONEachRow'
        })
        totalInserted += rows.length
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 100))
    }

    const duration = (Date.now() - startTime) / 1000

    return NextResponse.json({
      status: 'success',
      blocksProcessed: blocksToProcess,
      rowsInserted: totalInserted,
      fromBlock: startBlock,
      toBlock: endBlock - 1,
      chainBlock: latestBlock,
      durationSeconds: duration
    })

  } catch (error: any) {
    const duration = (Date.now() - startTime) / 1000
    console.error('ERC1155 sync error:', {
      message: error.message,
      stack: error.stack?.slice(0, 500),
      duration,
      rpcConfigured: !!RPC_URL
    })
    return NextResponse.json({
      error: error.message,
      details: error.stack?.split('\n')[0],
      durationSeconds: duration,
      rpcConfigured: !!RPC_URL
    }, { status: 500 })
  }
}
