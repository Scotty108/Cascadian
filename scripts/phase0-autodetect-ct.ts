import * as dotenv from 'dotenv'
import * as path from 'path'
import { getClickHouseClient } from '../lib/clickhouse/client'

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

async function detectCT() {
  const client = getClickHouseClient()

  try {
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('PHASE 0: AUTODETECT CONDITIONAL TOKENS (CT) ADDRESS')
    console.log('═══════════════════════════════════════════════════════════════\n')

    // Query to find the CT contract address
    const result = await client.query({
      query: `
        SELECT
          contract,
          count() AS n
        FROM erc1155_transfers
        GROUP BY contract
        ORDER BY n DESC
        LIMIT 1
      `,
      format: 'JSONEachRow',
    })

    const rows = await result.json<{ contract: string; n: number }>() as Array<{ contract: string; n: number }>

    if (!rows || rows.length === 0) {
      console.error('❌ ERROR: No contracts found in erc1155_transfers')
      process.exit(1)
    }

    const ctAddress = rows[0].contract
    const count = rows[0].n

    console.log(`✅ PHASE 0 COMPLETE`)
    console.log(`   Detected CT Address: ${ctAddress}`)
    console.log(`   ERC1155 Transfer Count: ${count}`)
    console.log(`\n   Export this for subsequent phases:`)
    console.log(`   export CONDITIONAL_TOKENS="${ctAddress}"\n`)

    process.exit(0)
  } catch (error) {
    console.error('❌ Phase 0 failed:', error)
    process.exit(1)
  }
}

detectCT()
