import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'
import { sendCronFailureAlert } from '@/lib/alerts/discord'

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
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const resp = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_blockNumber',
        params: []
      }),
      signal: controller.signal
    })
    const data = await resp.json()
    if (data.error) throw new Error(`RPC error: ${data.error.message}`)
    if (!data.result) throw new Error('No result from eth_blockNumber')
    return parseInt(data.result, 16)
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchTransfers(fromBlock: number, toBlock: number): Promise<any[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
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
      }),
      signal: controller.signal
    })

    const data = await resp.json()
    if (data.error) throw new Error(`Alchemy error: ${data.error.message}`)
    return data.result?.transfers || []
  } finally {
    clearTimeout(timeout)
  }
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
  const diagnostics: Record<string, any> = { startTime: new Date().toISOString() }

  try {
    if (!RPC_URL) {
      await sendCronFailureAlert({ cronName: 'sync-erc1155', error: 'ALCHEMY_POLYGON_RPC_URL not configured' })
      return NextResponse.json({ error: 'ALCHEMY_POLYGON_RPC_URL not configured', rpcUrlLength: 0 }, { status: 500 })
    }
    diagnostics.rpcUrlConfigured = true
    diagnostics.rpcUrlLength = RPC_URL.length

    // Get current state
    let startBlock: number
    try {
      const result = await clickhouse.query({
        query: 'SELECT max(block_number) as max_block FROM pm_erc1155_transfers WHERE is_deleted = 0',
        format: 'JSONEachRow'
      })
      const current = (await result.json() as any[])[0]
      startBlock = Number(current.max_block) + 1
      diagnostics.startBlock = startBlock
    } catch (dbErr: any) {
      await sendCronFailureAlert({ cronName: 'sync-erc1155', error: 'Failed to query ClickHouse', details: { message: dbErr.message, diagnostics } })
      return NextResponse.json({
        error: 'Failed to query ClickHouse',
        details: dbErr.message,
        diagnostics
      }, { status: 500 })
    }

    let latestBlock: number
    try {
      latestBlock = await getLatestBlock()
      diagnostics.latestBlock = latestBlock
    } catch (rpcErr: any) {
      await sendCronFailureAlert({ cronName: 'sync-erc1155', error: 'Failed to get latest block from RPC', details: { message: rpcErr.message, isAbortError: rpcErr.name === 'AbortError', diagnostics } })
      return NextResponse.json({
        error: 'Failed to get latest block from RPC',
        details: rpcErr.message,
        isAbortError: rpcErr.name === 'AbortError',
        diagnostics
      }, { status: 500 })
    }
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
    diagnostics.blocksToProcess = blocksToProcess
    diagnostics.endBlock = endBlock
    let chunksProcessed = 0

    // Process in chunks
    for (let block = startBlock; block < endBlock; block += BLOCKS_PER_REQUEST) {
      const chunkEnd = Math.min(block + BLOCKS_PER_REQUEST - 1, endBlock - 1)
      diagnostics.currentChunk = { start: block, end: chunkEnd }

      let transfers: any[]
      try {
        transfers = await fetchTransfers(block, chunkEnd)
        diagnostics.lastFetchSuccess = true
      } catch (fetchErr: any) {
        await sendCronFailureAlert({ cronName: 'sync-erc1155', error: 'Failed to fetch transfers from RPC', details: { message: fetchErr.message, isAbortError: fetchErr.name === 'AbortError', chunkStart: block, chunkEnd, chunksProcessed } })
        return NextResponse.json({
          error: 'Failed to fetch transfers from RPC',
          details: fetchErr.message,
          isAbortError: fetchErr.name === 'AbortError',
          chunkStart: block,
          chunkEnd,
          chunksProcessed,
          diagnostics
        }, { status: 500 })
      }

      const rows = convertToRows(transfers)

      if (rows.length > 0) {
        try {
          await clickhouse.insert({
            table: 'pm_erc1155_transfers',
            values: rows,
            format: 'JSONEachRow'
          })
          totalInserted += rows.length
        } catch (insertErr: any) {
          await sendCronFailureAlert({ cronName: 'sync-erc1155', error: 'Failed to insert rows to ClickHouse', details: { message: insertErr.message, rowsAttempted: rows.length, chunksProcessed } })
          return NextResponse.json({
            error: 'Failed to insert rows to ClickHouse',
            details: insertErr.message,
            rowsAttempted: rows.length,
            chunksProcessed,
            diagnostics
          }, { status: 500 })
        }
      }

      chunksProcessed++
      // Rate limit
      await new Promise(r => setTimeout(r, 100))
    }
    diagnostics.chunksProcessed = chunksProcessed

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
      rpcConfigured: !!RPC_URL,
      diagnostics
    })
    await sendCronFailureAlert({ cronName: 'sync-erc1155', error: error.message, details: { stack: error.stack?.split('\n')[0], durationSeconds: duration, rpcConfigured: !!RPC_URL, diagnostics } })
    return NextResponse.json({
      error: error.message,
      details: error.stack?.split('\n')[0],
      durationSeconds: duration,
      rpcConfigured: !!RPC_URL,
      diagnostics
    }, { status: 500 })
  }
}
