import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function check() {
  try {
    const result = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM erc1155_transfers'
    })
    const text = await result.text()
    const match = text.match(/"count":"(\d+)"/)
    if (match) {
      const current = parseInt(match[1])
      const added = current - 206112
      const pct = (added / 77400000 * 100).toFixed(2)
      const started = Date.parse('2025-11-08T06:30:00Z')
      const elapsed = (Date.now() - started) / 1000 / 60
      const rate = added / elapsed
      const remaining = 77400000 - added
      const etaMins = remaining / rate

      console.log('\n📊 BACKFILL PROGRESS UPDATE')
      console.log('======================================================')
      console.log(`Time elapsed: ${elapsed.toFixed(1)} minutes`)
      console.log(`Current rows: ${current.toLocaleString()}`)
      console.log(`Rows added: ${added.toLocaleString()} (${pct}% of 77.4M target)`)
      console.log(`Insertion rate: ${rate.toFixed(0)} rows/minute`)
      console.log(`Remaining rows: ${remaining.toLocaleString()}`)
      console.log(`ETA to completion: ${(etaMins / 60).toFixed(2)} hours (${etaMins.toFixed(0)} minutes)`)
      console.log('======================================================\n')
    }
  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

check()
