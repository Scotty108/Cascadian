/**
 * Debug script to inspect wallet position data structure
 */

const TEST_WALLET = '0x059fd0a47dbf42f2d723ddb5739cee6f3e6f9728'

async function main() {
  console.log(`\n🔍 Debugging Position Data for ${TEST_WALLET}\n`)
  console.log('=' .repeat(80))

  // Fetch from API endpoint
  console.log('\n📊 Fetching from /api/polymarket/wallet/positions...\n')
  try {
    const response = await fetch(`http://localhost:3000/api/polymarket/wallet/${TEST_WALLET}/positions`)
    const data = await response.json()

    if (data.success && data.data) {
      console.log(`Found ${data.data.length} open positions\n`)

      // Show first position structure
      if (data.data.length > 0) {
        console.log('Sample Position Structure:')
        console.log(JSON.stringify(data.data[0], null, 2))

        console.log('\n\nAll positions summary:')
        data.data.forEach((pos: any, i: number) => {
          console.log(`\nPosition ${i + 1}:`)
          console.log(`  Market: ${pos.question || pos.market || 'Unknown'}`)
          console.log(`  Size/Shares: ${pos.size || pos.shares || 0}`)
          console.log(`  Entry Price: ${pos.entryPrice || pos.entry_price || 'N/A'}`)
          console.log(`  Current Price: ${pos.currentPrice || pos.current_price || 'N/A'}`)
          console.log(`  Value: ${pos.value || 'N/A'}`)
          console.log(`  Unrealized PnL: ${pos.unrealizedPnL || pos.unrealized_pnl || pos.cashPnl || 'N/A'}`)
        })

        // Calculate total unrealized PnL
        const totalUnrealizedPnL = data.data.reduce((sum: number, pos: any) => {
          return sum + (pos.cashPnl || pos.unrealized_pnl || pos.unrealizedPnL || 0)
        }, 0)

        console.log(`\n\n📈 Total Unrealized PnL: $${totalUnrealizedPnL.toFixed(2)}`)
      } else {
        console.log('No open positions found')
      }
    } else {
      console.error('Failed to fetch positions:', data.error)
    }
  } catch (error) {
    console.error('Error fetching positions:', error)
  }

  console.log('\n' + '='.repeat(80) + '\n')
}

main().catch(console.error)
