#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  const wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
  
  console.log('Step 1: Getting wallet condition_ids (normalized)...\n')
  
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
  console.log(`Found ${cids.length} unique condition_ids for wallet\n`)
  
  if (cids.length === 0) {
    console.log('No condition_ids found!')
    return
  }
  
  console.log('Sample condition_ids (normalized, no 0x prefix):')
  cids.slice(0, 5).forEach(c => console.log('  ' + c.cid_norm))
  
  const cidList = cids.map(c => `'${c.cid_norm}'`).join(',')
  
  const tables = [
    'default.staging_resolutions_union',
    'default.resolution_candidates',
    'default.gamma_resolved',
    'default.market_resolutions',
    'default.market_resolutions_by_market',
    'cascadian_clean.resolutions_src_api',
    'default.market_key_map',
    'default.gamma_markets',
    'default.api_market_backfill',
    'default.market_resolutions_final'
  ]
  
  console.log('\n' + '='.repeat(80))
  console.log('Step 2: Checking each table for matches...')
  console.log('='.repeat(80))
  
  for (const table of tables) {
    console.log('\n' + '-'.repeat(80))
    console.log(`TABLE: ${table}`)
    console.log('-'.repeat(80))
    
    try {
      const schemaResult = await clickhouse.query({
        query: `DESCRIBE TABLE ${table}`,
        format: 'JSONEachRow'
      })
      const schema = await schemaResult.json<{name: string, type: string}>()
      
      const cidCol = schema.find(c => c.name.toLowerCase().includes('condition'))
      
      if (!cidCol) {
        console.log('No condition_id column - SKIP\n')
        continue
      }
      
      console.log(`Using column: ${cidCol.name}`)
      
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
      
      console.log(`Matches: ${totalMatches}/${cids.length} condition_ids found`)
      
      if (totalMatches === 0) {
        console.log('No matches - SKIP\n')
        continue
      }
      
      console.log('\n*** FOUND MATCHES! ***\n')
      
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
      
      console.log(`Sample data (${samples.length} rows):`)
      for (let i = 0; i < samples.length; i++) {
        const row = samples[i]
        console.log(`\nRow ${i + 1}:`)
        
        let hasAnyPayoutData = false
        
        for (const key of Object.keys(row)) {
          const kl = key.toLowerCase()
          if (kl.includes('condition')) {
            console.log(`  condition: ${row[key]}`)
          } else if (kl.includes('payout') || kl.includes('outcome') || kl.includes('winning') || kl.includes('resolved') || kl.includes('winner')) {
            const val = row[key]
            const hasData = (Array.isArray(val) && val.length > 0 && val.some(v => v !== 0)) || 
                           (typeof val === 'string' && val && val !== '0' && val !== '') ||
                           (typeof val === 'number' && val !== 0)
            
            if (hasData) hasAnyPayoutData = true
            
            console.log(`  ${hasData ? '[HAS DATA!!!]' : '[empty]'} ${key}: ${JSON.stringify(val)}`)
          }
        }
        
        if (hasAnyPayoutData) {
          console.log('  *** THIS ROW HAS VALID PAYOUT DATA! ***')
        }
      }
      
      const payoutCols = schema.filter(c => {
        const name = c.name.toLowerCase()
        return name.includes('payout') || name.includes('outcome') || name.includes('winning')
      })
      
      if (payoutCols.length > 0) {
        console.log('\n\nChecking how many rows have valid payout data:')
        for (const col of payoutCols) {
          try {
            const validResult = await clickhouse.query({
              query: `
                SELECT count() as cnt
                FROM ${table}
                WHERE lower(replaceAll(${cidCol.name}, '0x', '')) IN (${cidList})
                  AND (
                    (isNotNull(${col.name}) AND toString(${col.name}) != '' AND toString(${col.name}) != '0')
                    OR (length(arrayFilter(x -> x != 0, ${col.name})) > 0)
                  )
              `,
              format: 'JSONEachRow'
            })
            const validData = await validResult.json<{cnt: string}>()
            const validCount = parseInt(validData[0].cnt)
            
            console.log(`  ${col.name}: ${validCount}/${totalMatches} rows have data`)
          } catch (e: any) {
            console.log(`  ${col.name}: [error checking - ${e.message.split('\n')[0]}]`)
          }
        }
      }
      
    } catch (error: any) {
      console.log(`Error: ${error.message}\n`)
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log('Search complete!')
  console.log('='.repeat(80) + '\n')
}

main().catch(console.error)
