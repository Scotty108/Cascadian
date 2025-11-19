import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

const startTime = Date.now()
const initialCount = 206112

async function monitor() {
  while (true) {
    try {
      const result = await clickhouse.query({
        query: 'SELECT COUNT(*) as count FROM erc1155_transfers'
      })
      const text = await result.text()
      const match = text.match(/"count":"(\d+)"/)
      if (match) {
        const current = parseInt(match[1])
        const added = current - initialCount
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
        const rate = (added / parseFloat(elapsed)).toFixed(0)
        console.log(`[${new Date().toLocaleTimeString()}] Rows: ${current.toLocaleString()} (+${added.toLocaleString()}) | Elapsed: ${elapsed}min | Rate: ${rate}/min`)
      }
    } catch (e: any) {
      console.error('Error:', e.message)
    }
    await new Promise(r => setTimeout(r, 30000)) // Check every 30 seconds
  }
}

monitor()
