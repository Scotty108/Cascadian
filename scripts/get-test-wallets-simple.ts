import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { getTopWalletsByCondition } from '@/lib/goldsky/client'

async function getTestWallets() {
  console.log('🔍 Finding test wallets from known active condition...\n')

  // Use the condition ID we validated earlier
  const conditionId = '0xf398b0e5016eeaee9b0885ed84012b6dc91269ac10d3b59d60722859c2e30b2f'

  console.log(`Using condition: ${conditionId}`)
  console.log('(From market: "Will Harvey Weinstein be sentenced to no prison time?")\n')

  try {
    const topWallets = await getTopWalletsByCondition(conditionId, 5)

    if (topWallets.length === 0) {
      console.log('❌ No wallets found for this condition')
      return
    }

    console.log(`✅ Found ${topWallets.length} wallets:\n`)
    topWallets.forEach((wallet, i) => {
      console.log(`${i + 1}. ${wallet}`)
    })

    console.log(`\n\n📋 Run this command to sync these wallets:\n`)
    console.log(`npx tsx scripts/sync-wallet-trades.ts \\`)
    topWallets.forEach((wallet, i) => {
      const suffix = i < topWallets.length - 1 ? ' \\' : ''
      console.log(`  ${wallet}${suffix}`)
    })
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

getTestWallets()
