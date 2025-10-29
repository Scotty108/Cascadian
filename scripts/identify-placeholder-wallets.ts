#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import fs from 'fs'

async function identifyPlaceholderWallets() {
  console.log('🔍 Identifying wallets with only placeholder trades...\n')

  // Get wallets that have ONLY placeholder trades (no real trades)
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet_address
      FROM trades_raw
      WHERE wallet_address NOT IN (
        SELECT DISTINCT wallet_address
        FROM trades_raw
        WHERE market_id != '' OR (condition_id != '' AND condition_id NOT LIKE 'token_%')
      )
      ORDER BY wallet_address
    `,
    format: 'JSONEachRow'
  })

  const wallets = await result.json()

  console.log(`✅ Found ${wallets.length} wallets with ONLY placeholder trades\n`)

  // Write to file
  const addresses = wallets.map((w: any) => w.wallet_address).join('\n')
  fs.writeFileSync('./runtime/placeholder_wallets_to_reload.txt', addresses)

  console.log('📝 Saved wallet addresses to: runtime/placeholder_wallets_to_reload.txt')
  console.log(`   Ready to load real trades for ${wallets.length} wallets\n`)

  return wallets.length
}

identifyPlaceholderWallets().catch(console.error)
