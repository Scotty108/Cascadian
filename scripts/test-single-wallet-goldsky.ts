#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { fetchWalletPnL } from '../lib/goldsky/client'

// Test wallet from investigation (known to have $31k PnL)
const TEST_WALLET = '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50'
const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399

async function testWallet() {
  console.log(`\n🔍 Testing wallet: ${TEST_WALLET}\n`)

  const result = await fetchWalletPnL(TEST_WALLET)

  if (!result) {
    console.log('❌ No data found for this wallet')
    return
  }

  console.log(`✅ Found ${result.positionCount} positions`)
  console.log(`Raw Total PnL: $${result.totalRealizedPnl.toFixed(2)}`)

  const corrected = result.totalRealizedPnl / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
  console.log(`Corrected PnL: $${corrected.toFixed(2)}`)
  console.log(`Expected: $31,904.33`)
  console.log(`Match: ${Math.abs(corrected - 31904.33) < 1 ? '✅ YES' : '❌ NO'}`)
}

testWallet()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
