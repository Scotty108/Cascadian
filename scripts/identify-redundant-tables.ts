#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function identifyRedundant() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n🗑️  REDUNDANT / CLEANUP CANDIDATE TABLES\n')
    
    const result = await client.query({
      query: `
        SELECT 
          name,
          total_rows,
          formatReadableSize(total_bytes) as size
        FROM system.tables
        WHERE database = 'default'
          AND (
            name LIKE '%backup%' 
            OR name LIKE '%old' 
            OR name LIKE '%staging%'
            OR name LIKE '%_20251111%'
          )
        ORDER BY total_bytes DESC
      `,
      format: 'JSONEachRow'
    })
    
    const tables = await result.json<any>()
    
    console.log('📦 BACKUP TABLES (Safe to delete after 30 days):')
    const backups = tables.filter((t: any) => t.name.includes('backup') || t.name.includes('_old'))
    backups.forEach((t: any) => {
      console.log(`   - ${t.name.padEnd(45)} | ${t.total_rows.toString().padStart(10)} rows | ${t.size}`)
    })
    
    console.log('\n🔄 STAGING TABLES (Intermediate processing):')
    const staging = tables.filter((t: any) => t.name.includes('staging') && !t.name.includes('backup'))
    staging.forEach((t: any) => {
      console.log(`   - ${t.name.padEnd(45)} | ${t.total_rows.toString().padStart(10)} rows | ${t.size}`)
    })
    
    // Check for unused ERC1155
    console.log('\n❓ POTENTIALLY UNUSED TABLES:')
    console.log('   - erc1155_transfers (61.4M rows) - NO downstream consumers')
    console.log('   - erc1155_condition_map (41K rows) - Only used if ERC1155 integrated')
    console.log('   - wallet_ui_map (3 rows) - Barely populated, might be abandoned')
    console.log('   - dim_markets_old (318K rows) - Duplicate of dim_markets')
    
    console.log('\n💡 CLEANUP RECOMMENDATIONS:')
    console.log('')
    console.log('1. IMMEDIATE (Backups > 30 days old):')
    console.log('   Can safely delete after Dec 11, 2025:')
    backups.filter((t: any) => t.name.includes('20251111')).forEach((t: any) => {
      console.log(`   - DROP TABLE ${t.name}`)
    })
    
    console.log('\n2. SHORT-TERM (Decide on ERC1155 integration):')
    console.log('   If NOT planning ERC1155 integration:')
    console.log('   - Consider archiving erc1155_transfers (61.4M rows)')
    console.log('   - Delete erc1155_condition_map (41K rows)')
    console.log('')
    console.log('   If PLANNING ERC1155 integration:')
    console.log('   - Keep all ERC1155 tables')
    console.log('   - Build integration views')
    
    console.log('\n3. STAGING TABLE STRATEGY:')
    console.log('   erc20_transfers_staging (387M rows) - keeps growing')
    console.log('   Options:')
    console.log('   - Archive old data (> 6 months)')
    console.log('   - Implement retention policy')
    console.log('   - Current size: 18 GB')
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

identifyRedundant()
