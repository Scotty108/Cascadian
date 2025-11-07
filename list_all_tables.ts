#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: '8miOkWI~OhsDb',
})

async function main() {
  console.log('='.repeat(80))
  console.log('ALL TABLES IN DATABASE')
  console.log('='.repeat(80))
  console.log('')
  
  const query = `SHOW TABLES`
  const result = await clickhouse.query({ query })
  const data = await result.text()
  const tables = data.trim().split('\n')
  
  console.log(`Found ${tables.length} tables:\n`)
  tables.forEach(t => console.log(`  ${t}`))
  
  console.log('\n' + '='.repeat(80))
  console.log('TABLES WITH "pnl" IN NAME')
  console.log('='.repeat(80))
  console.log('')
  
  const pnlTables = tables.filter(t => t.toLowerCase().includes('pnl'))
  pnlTables.forEach(t => console.log(`  ${t}`))
  
  console.log('\n' + '='.repeat(80))
  console.log('TABLES WITH "wallet" IN NAME')
  console.log('='.repeat(80))
  console.log('')
  
  const walletTables = tables.filter(t => t.toLowerCase().includes('wallet'))
  walletTables.forEach(t => console.log(`  ${t}`))
}

main().catch(console.error)
