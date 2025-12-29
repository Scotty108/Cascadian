#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
})

async function main() {
  const niggemon = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  
  console.log('='.repeat(80))
  console.log('TRUTH INVESTIGATION: WHERE DID $99,691 COME FROM?')
  console.log('='.repeat(80))
  console.log('')
  
  // Test the exact query from RECONCILIATION_FINAL_REPORT.md line 56-64
  console.log('TEST 1: Query from RECONCILIATION_FINAL_REPORT.md (claimed to produce $99,691)')
  console.log('-'.repeat(80))
  
  try {
    const query1 = `
      SELECT
        coalesce(r.wallet, u.wallet) as wallet,
        coalesce(r.realized_pnl_usd, 0) as realized_pnl,
        coalesce(u.unrealized_pnl_usd, 0) as unrealized_pnl,
        coalesce(r.realized_pnl_usd, 0) + coalesce(u.unrealized_pnl_usd, 0) as total_pnl
      FROM wallet_realized_pnl_final r
      FULL OUTER JOIN wallet_unrealized_pnl_v2 u USING (wallet)
      WHERE wallet = '${niggemon}'
    `
    
    const result = await clickhouse.query({ query: query1 })
    const data = await result.json() as any[]
    
    if (data.length > 0) {
      console.log('✅ QUERY EXECUTED')
      console.log(`   Realized:   $${parseFloat(data[0].realized_pnl).toFixed(2)}`)
      console.log(`   Unrealized: $${parseFloat(data[0].unrealized_pnl).toFixed(2)}`)
      console.log(`   Total:      $${parseFloat(data[0].total_pnl).toFixed(2)}`)
      console.log('')
      console.log(`   Claimed in report: $99,691.54`)
      console.log(`   Actual result:     $${parseFloat(data[0].total_pnl).toFixed(2)}`)
      console.log(`   MATCH: ${parseFloat(data[0].total_pnl).toFixed(2) === '99691.54' ? 'YES ✅' : 'NO ❌'}`)
    } else {
      console.log('⚠️  Query returned NO DATA')
    }
  } catch (err: any) {
    console.log(`❌ QUERY FAILED: ${err.message}`)
  }
  
  console.log('')
  console.log('='.repeat(80))
  console.log('TEST 2: Check wallet_pnl_summary_v2 (mentioned in docs)')
  console.log('-'.repeat(80))
  
  try {
    const query2 = `SELECT * FROM wallet_pnl_summary_v2 WHERE wallet = '${niggemon}'`
    const result = await clickhouse.query({ query: query2 })
    const data = await result.json() as any[]
    
    if (data.length > 0) {
      console.log('✅ TABLE EXISTS WITH DATA')
      console.log('   Columns:', Object.keys(data[0]).join(', '))
      console.log('   Data:', JSON.stringify(data[0], null, 2))
    } else {
      console.log('⚠️  Table exists but NO DATA')
    }
  } catch (err: any) {
    console.log(`❌ FAILED: ${err.message}`)
  }
  
  console.log('')
  console.log('='.repeat(80))
  console.log('TEST 3: Check wallet_pnl_summary_final')
  console.log('-'.repeat(80))
  
  try {
    const query3 = `SELECT * FROM wallet_pnl_summary_final WHERE wallet = '${niggemon}'`
    const result = await clickhouse.query({ query: query3 })
    const data = await result.json() as any[]
    
    if (data.length > 0) {
      console.log('✅ TABLE EXISTS WITH DATA')
      console.log('   Columns:', Object.keys(data[0]).join(', '))
      console.log('   Data:', JSON.stringify(data[0], null, 2))
    } else {
      console.log('⚠️  Table exists but NO DATA')
    }
  } catch (err: any) {
    console.log(`❌ FAILED: ${err.message}`)
  }
  
  console.log('')
  console.log('='.repeat(80))
  console.log('TEST 4: Check all wallet_realized_pnl tables')
  console.log('-'.repeat(80))
  
  const realizedTables = [
    'wallet_realized_pnl',
    'wallet_realized_pnl_final',
    'wallet_realized_pnl_v2',
    'wallet_realized_pnl_v3'
  ]
  
  for (const table of realizedTables) {
    try {
      const query = `SELECT * FROM ${table} WHERE wallet = '${niggemon}' LIMIT 1`
      const result = await clickhouse.query({ query })
      const data = await result.json() as any[]
      
      if (data.length > 0) {
        console.log(`✅ ${table}:`)
        if (data[0].realized_pnl_usd !== undefined) {
          console.log(`   realized_pnl_usd: $${parseFloat(data[0].realized_pnl_usd).toFixed(2)}`)
        }
        if (data[0].total_realized_pnl !== undefined) {
          console.log(`   total_realized_pnl: $${parseFloat(data[0].total_realized_pnl).toFixed(2)}`)
        }
        console.log(`   All columns:`, Object.keys(data[0]).join(', '))
      } else {
        console.log(`⚠️  ${table}: NO DATA`)
      }
    } catch (err: any) {
      console.log(`❌ ${table}: ${err.message.split('\n')[0]}`)
    }
  }
}

main().catch(console.error)
