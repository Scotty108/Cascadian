import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client.js'

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723'
const EOA_LOWER = EOA.toLowerCase()
const PROXY_LOWER = PROXY.toLowerCase()

async function main() {
  console.log('=================================================================')
  console.log('DETAILED ERC1155 TRANSFER ANALYSIS: xcnstrategy')
  console.log('=================================================================\n')
  
  const whereClause = `(from_address IN ('${EOA_LOWER}', '${PROXY_LOWER}') OR to_address IN ('${EOA_LOWER}', '${PROXY_LOWER}'))`
  
  // Query 1: Count transfers by direction
  console.log('Query 1: Transfers by Direction')
  console.log('-------------------------------\n')
  
  const directionQuery = await clickhouse.query({
    query: `
      SELECT 
        CASE 
          WHEN from_address = '${EOA_LOWER}' THEN 'From EOA'
          WHEN from_address = '${PROXY_LOWER}' THEN 'From Proxy'
          WHEN to_address = '${EOA_LOWER}' THEN 'To EOA'
          WHEN to_address = '${PROXY_LOWER}' THEN 'To Proxy'
        END as direction,
        COUNT(*) as cnt,
        COUNT(DISTINCT token_id) as unique_tokens
      FROM erc1155_transfers
      WHERE ${whereClause}
      GROUP BY direction
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  })
  
  const directionData = await directionQuery.json()
  console.log('Direction Analysis:')
  for (const d of directionData as any[]) {
    console.log(`  ${d.direction}: ${d.cnt} transfers, ${d.unique_tokens} unique tokens`)
  }
  console.log()
  
  // Query 2: Time range
  console.log('Query 2: Time Range')
  console.log('-------------------\n')
  
  const timeQuery = await clickhouse.query({
    query: `
      SELECT 
        MIN(block_timestamp) as earliest,
        MAX(block_timestamp) as latest,
        COUNT(*) as total_transfers
      FROM erc1155_transfers
      WHERE ${whereClause}
    `,
    format: 'JSONEachRow'
  })
  
  const timeData = await timeQuery.json()
  const td = (timeData as any[])[0]
  console.log(`Earliest: ${td.earliest}`)
  console.log(`Latest: ${td.latest}`)
  console.log(`Total transfers: ${td.total_transfers}\n`)
  
  // Query 3: Sample transfers with details
  console.log('Query 3: Sample Transfers (10 most recent)')
  console.log('------------------------------------------\n')
  
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT 
        tx_hash,
        block_timestamp,
        token_id,
        from_address,
        to_address,
        value
      FROM erc1155_transfers
      WHERE ${whereClause}
      ORDER BY block_timestamp DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })
  
  const samples = await sampleQuery.json()
  console.log('Sample transfers:')
  let idx = 1
  for (const s of samples as any[]) {
    const direction = s.from_address === EOA_LOWER || s.from_address === PROXY_LOWER ? 'OUTBOUND' : 'INBOUND'
    console.log(`  ${idx}. [${s.block_timestamp}] ${direction}`)
    console.log(`     TxHash: ${s.tx_hash}`)
    console.log(`     Value (hex): ${s.value}`)
    console.log()
    idx++
  }
  
  // Query 4: Check mapping to pm_trades_canonical_v2
  console.log('Query 4: Mapping to pm_trades_canonical_v2')
  console.log('-------------------------------------------\n')
  
  const canonicalQuery = await clickhouse.query({
    query: `SELECT COUNT(*) as cnt FROM pm_trades_canonical_v2 WHERE wallet = '${EOA_LOWER}'`,
    format: 'JSONEachRow'
  })
  
  const canonicalData = await canonicalQuery.json()
  const cd = (canonicalData as any[])[0]
  console.log(`Trades in pm_trades_canonical_v2 for EOA: ${cd.cnt}`)
  console.log(`ERC1155 transfers for wallet cluster: 249`)
  const ratio = ((cd.cnt as any) / 249 * 100).toFixed(1)
  console.log(`Coverage ratio: ${ratio}%`)
  console.log()
  
  // Query 5: Monthly breakdown
  console.log('Query 5: Monthly Breakdown')
  console.log('--------------------------\n')
  
  const monthlyQuery = await clickhouse.query({
    query: `
      SELECT 
        toStartOfMonth(block_timestamp) as month,
        COUNT(*) as transfer_count,
        COUNT(DISTINCT token_id) as unique_tokens
      FROM erc1155_transfers
      WHERE ${whereClause}
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow'
  })
  
  const monthlyData = await monthlyQuery.json()
  console.log('Monthly breakdown:')
  for (const m of monthlyData as any[]) {
    console.log(`  ${m.month}: ${m.transfer_count} transfers, ${m.unique_tokens} unique tokens`)
  }
}

main().catch(console.error)
