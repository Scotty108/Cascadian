#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  const wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
  
  console.log('Getting wallet condition_ids...\n')
  
  const cidsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = '${wallet}'
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      ORDER BY cid_norm
    `,
    format: 'JSONEachRow'
  })
  
  const cids = await cidsResult.json<{cid_norm: string}>()
  console.log(`Found ${cids.length} condition_ids\n`)
  
  const cidList = cids.map(c => `'${c.cid_norm}'`).join(',')
  
  const tables = [
    'cascadian_clean.resolutions_by_cid',
    'cascadian_clean.resolutions_src_api',
    'cascadian_clean.vw_resolutions_all',
    'cascadian_clean.vw_resolutions_unified',
    'default.market_resolutions_final'
  ]
  
  for (const table of tables) {
    console.log('='.repeat(80))
    console.log(`TABLE: ${table}`)
    console.log('='.repeat(80))
    
    try {
      const schemaResult = await clickhouse.query({
        query: `DESCRIBE TABLE ${table}`,
        format: 'JSONEachRow'
      })
      const schema = await schemaResult.json<{name: string, type: string}>()
      
      console.log('\nSchema (payout-related columns):')
      schema.forEach(c => {
        const n = c.name.toLowerCase()
        if (n.includes('condition') || n.includes('payout') || n.includes('winning') || n.includes('outcome')) {
          console.log(`  ${c.name}: ${c.type}`)
        }
      })
      
      const cidCol = schema.find(c => c.name.toLowerCase().includes('condition'))
      
      if (!cidCol) {
        console.log('\nNo condition_id column - SKIP\n')
        continue
      }
      
      const countResult = await clickhouse.query({
        query: `
          SELECT count() as cnt
          FROM ${table}
          WHERE lower(replaceAll(${cidCol.name}, '0x', '')) IN (${cidList})
        `,
        format: 'JSONEachRow'
      })
      const countData = await countResult.json<{cnt: string}>()
      const totalMatches = parseInt(countData[0].cnt)
      
      console.log(`\nMatches: ${totalMatches}/${cids.length} condition_ids`)
      
      if (totalMatches === 0) {
        console.log('No matches - SKIP\n')
        continue
      }
      
      console.log('\n*** MATCHES FOUND! ***\n')
      
      const sampleResult = await clickhouse.query({
        query: `
          SELECT *
          FROM ${table}
          WHERE lower(replaceAll(${cidCol.name}, '0x', '')) IN (${cidList})
          LIMIT 5
        `,
        format: 'JSONEachRow'
      })
      const samples = await sampleResult.json<any>()
      
      console.log(`Sample rows (${samples.length}):`)
      samples.forEach((row, i) => {
        console.log(`\n--- Row ${i + 1} ---`)
        Object.keys(row).forEach(key => {
          const kl = key.toLowerCase()
          if (kl.includes('condition') || kl.includes('payout') || kl.includes('winning') || kl.includes('outcome')) {
            const val = row[key]
            let hasData = false
            
            if (Array.isArray(val)) {
              hasData = val.length > 0 && val.some(v => v !== 0 && v !== '0')
            } else if (typeof val === 'string') {
              hasData = val.length > 0 && val !== '0' && val !== ''
            } else if (typeof val === 'number') {
              hasData = val !== 0
            }
            
            const marker = hasData ? '[DATA]' : '[empty]'
            console.log(`${marker} ${key}: ${JSON.stringify(val)}`)
          }
        })
      })
      
      const payoutNums = schema.find(c => c.name.toLowerCase().includes('payout_numerators'))
      if (payoutNums) {
        console.log(`\nChecking how many have non-empty payout_numerators...`)
        try {
          const validResult = await clickhouse.query({
            query: `
              SELECT count() as cnt
              FROM ${table}
              WHERE lower(replaceAll(${cidCol.name}, '0x', '')) IN (${cidList})
                AND length(${payoutNums.name}) > 0
                AND arrayExists(x -> x != 0, ${payoutNums.name})
            `,
            format: 'JSONEachRow'
          })
          const validData = await validResult.json<{cnt: string}>()
          console.log(`${validData[0].cnt}/${totalMatches} have valid payout_numerators`)
        } catch (e: any) {
          console.log(`Error checking: ${e.message.split('\n')[0]}`)
        }
      }
      
      console.log('\n')
      
    } catch (error: any) {
      console.log(`Error: ${error.message}\n`)
    }
  }
}

main().catch(console.error)
