import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function check() {
  try {
    console.log('CHECKING: market_resolutions_final structure')
    console.log('═'.repeat(70))

    // Check the schema
    const checkRes = await clickhouse.query({
      query: `SELECT * FROM market_resolutions_final LIMIT 1`
    })

    const resData = JSON.parse(await checkRes.text())
    const columns = resData.meta.map((m: any) => m.name)

    console.log('market_resolutions_final columns:')
    columns.forEach((col: string, idx: number) => {
      console.log(`  ${idx + 1}. ${col}`)
    })
    console.log()

    // Show a sample row
    console.log('Sample row from market_resolutions_final:')
    if (resData.data && resData.data.length > 0) {
      const row = resData.data[0]
      Object.entries(row).forEach(([key, value]: [string, any]) => {
        const displayValue = typeof value === 'string' && value.length > 100 ? value.substring(0, 100) + '...' : value
        console.log(`  ${key}: ${displayValue}`)
      })
    }

    console.log()
    console.log('⚠️  Key question: How do we relate market_id to condition_id in market_resolutions_final?')
    console.log('   - Does it have market_id directly?')
    console.log('   - Or do we need a different mapping strategy?')

  } catch (e: any) {
    console.error('Error:', e.message.substring(0, 200))
  }
}

check()
