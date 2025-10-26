import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { pnlClient } from '@/lib/goldsky/client'

// Found empirically from wallet 0x241f846866c2de4fb67cdb0ca6b963d85e56ef50
const CORRECTION_FACTOR = 13.2399

async function testCorrectionFactor() {
  console.log('🧪 Testing PnL Correction Factor\n')
  console.log(`Correction factor: ${CORRECTION_FACTOR}\n`)

  // Test on multiple wallets
  const testWallets = [
    {
      address: '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50',
      expectedPnL: 31904.33, // From Polymarket @Mynxx
      profile: 'https://polymarket.com/@Mynxx',
    },
    {
      address: '0x537494c54dee9162534675712f2e625c9713042e',
      expectedPnL: null, // Unknown - we'll just calculate
      profile: null,
    },
    {
      address: '0x066ea9d5dacc81ea3a0535ffe13209d55571ceb2',
      expectedPnL: null,
      profile: null,
    },
  ]

  for (const wallet of testWallets) {
    console.log(`\n${'='.repeat(70)}`)
    console.log(`Wallet: ${wallet.address}`)
    if (wallet.profile) console.log(`Profile: ${wallet.profile}`)

    try {
      const query = `
        query GetWalletPositions($wallet: String!) {
          userPositions(where: { user: $wallet }, first: 1000) {
            realizedPnl
          }
        }
      `

      const data = await pnlClient.request<any>(query, {
        wallet: wallet.address.toLowerCase(),
      })

      const positions = data.userPositions
      const totalRaw = positions.reduce((sum: number, p: any) => {
        return sum + parseFloat(p.realizedPnl)
      }, 0)

      const pnlUncorrected = totalRaw / 1e6
      const pnlCorrected = totalRaw / (CORRECTION_FACTOR * 1e6)

      console.log(`\nPositions: ${positions.length}`)
      console.log(`PnL (uncorrected): $${pnlUncorrected.toFixed(2)}`)
      console.log(`PnL (corrected ÷${CORRECTION_FACTOR}): $${pnlCorrected.toFixed(2)}`)

      if (wallet.expectedPnL) {
        const error = Math.abs(pnlCorrected - wallet.expectedPnL)
        const errorPct = (error / wallet.expectedPnL) * 100

        console.log(`Expected PnL: $${wallet.expectedPnL}`)
        console.log(`Error: $${error.toFixed(2)} (${errorPct.toFixed(2)}%)`)

        if (errorPct < 1) {
          console.log(`✅ Correction factor works! (<1% error)`)
        } else if (errorPct < 5) {
          console.log(`⚠️  Correction factor mostly works (${errorPct.toFixed(1)}% error)`)
        } else {
          console.log(`❌ Correction factor doesn't work (${errorPct.toFixed(1)}% error)`)
        }
      }
    } catch (error) {
      console.log(`❌ Error: ${(error as Error).message}`)
    }
  }

  console.log('\n\n💡 Conclusion:')
  console.log('If correction factor is consistent across wallets:')
  console.log(`  Use: realizedPnl / ${CORRECTION_FACTOR} / 1e6`)
  console.log('\nIf correction factor varies:')
  console.log('  Fall back to top-20 approach for each market')
}

testCorrectionFactor()
