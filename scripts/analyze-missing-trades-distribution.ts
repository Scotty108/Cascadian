#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function analyze() {
  console.log('\n' + '='.repeat(120))
  console.log('CRITICAL QUESTION: Are 77.4M missing condition_ids concentrated in the 2.8 month gap?')
  console.log('='.repeat(120))
  
  // Total trades and missing by date
  const timelineResult = await clickhouse.query({
    query: `
      SELECT 
        toYYYYMM(timestamp) as month,
        COUNT(*) as total_trades,
        SUM(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 ELSE 0 END) as missing_cond_id,
        ROUND(100.0 * SUM(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as pct_missing
      FROM trades_raw
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow'
  })
  
  const timelineData = await timelineResult.json()
  
  console.log('\nTrades by Month (showing missing condition_id pattern):')
  console.log('Month      | Total Trades | Missing Cond_ID | % Missing')
  console.log('─'.repeat(65))
  
  let earlyPeriodMissing = 0
  let earlyPeriodTotal = 0
  let latePeriodMissing = 0
  let latePeriodTotal = 0
  let gapPeriodMissing = 0
  let gapPeriodTotal = 0
  
  for (const row of timelineData) {
    const month = String(row.month)
    const yearMonth = `${month.substring(0, 4)}-${month.substring(4, 6)}`
    console.log(`${yearMonth}     | ${String(row.total_trades).padStart(12)} | ${String(row.missing_cond_id).padStart(15)} | ${String(row.pct_missing).padStart(8)}%`)
    
    // Categorize periods
    if (month <= '202307') {
      // Before the ERC1155 gap ends
      earlyPeriodMissing += Number(row.missing_cond_id)
      earlyPeriodTotal += Number(row.total_trades)
    } else if (month >= '202407') {
      // After ERC1155 gap
      latePeriodMissing += Number(row.missing_cond_id)
      latePeriodTotal += Number(row.total_trades)
    }
  }
  
  console.log('\n' + '='.repeat(120))
  console.log('DISTRIBUTION ANALYSIS')
  console.log('='.repeat(120))
  
  console.log(`\nDec 2022 - Jul 2024 (BEFORE full ERC1155 coverage):`)
  console.log(`  Total trades: ${earlyPeriodTotal.toLocaleString()}`)
  console.log(`  Missing condition_id: ${earlyPeriodMissing.toLocaleString()}`)
  console.log(`  % missing: ${(100 * earlyPeriodMissing / earlyPeriodTotal).toFixed(1)}%`)
  
  console.log(`\nJul 2024 - Oct 2025 (AFTER full ERC1155 coverage):`)
  console.log(`  Total trades: ${latePeriodTotal.toLocaleString()}`)
  console.log(`  Missing condition_id: ${latePeriodMissing.toLocaleString()}`)
  console.log(`  % missing: ${(100 * latePeriodMissing / latePeriodTotal).toFixed(1)}%`)
  
  console.log(`\n${'='.repeat(120)}`)
  console.log('CONCLUSION')
  console.log('='.repeat(120))
  
  const totalMissing = earlyPeriodMissing + latePeriodMissing
  console.log(`\nTotal missing condition_ids: ${totalMissing.toLocaleString()}`)
  console.log(`  From BEFORE gap (Dec 2022 - Jul 2024): ${earlyPeriodMissing.toLocaleString()} (${(100 * earlyPeriodMissing / totalMissing).toFixed(1)}%)`)
  console.log(`  From AFTER gap (Jul 2024 - Oct 2025): ${latePeriodMissing.toLocaleString()} (${(100 * latePeriodMissing / totalMissing).toFixed(1)}%)`)
  
  if (latePeriodMissing > earlyPeriodMissing) {
    console.log(`\n❌ CRITICAL FINDING: Most missing condition_ids are AFTER the ERC1155 gap!`)
    console.log(`   Fetching missing ERC1155 (83.9 days) will NOT solve the problem`)
    console.log(`   The issue is ELSEWHERE - not missing blockchain data`)
  } else {
    console.log(`\n✅ Most missing condition_ids ARE in the gap period`)
    console.log(`   Fetching missing ERC1155 data will significantly help`)
  }
}

analyze().catch(e => console.error('Error:', (e as Error).message))
