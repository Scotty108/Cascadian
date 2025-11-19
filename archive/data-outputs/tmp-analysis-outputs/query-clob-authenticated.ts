#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import crypto from 'crypto'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const CLOB_API_KEY = process.env.CLOB_API_KEY || ''
const CLOB_API_SECRET = process.env.CLOB_API_SECRET || ''
const CLOB_API_PASSPHRASE = process.env.CLOB_API_PASSPHRASE || ''

// Helper to create CLOB API signature
function createClobSignature(timestamp: string, method: string, path: string, body: string = ''): string {
  const message = timestamp + method + path + body
  const hmac = crypto.createHmac('sha256', Buffer.from(CLOB_API_SECRET, 'utf-8'))
  return hmac.update(message).digest('base64')
}

async function fetchFromClobAPI(path: string, method: string = 'GET'): Promise<any> {
  const timestamp = new Date().toISOString()
  const signature = createClobSignature(timestamp, method, path)

  const response = await fetch(`https://clob.polymarket.com${path}`, {
    method,
    headers: {
      'CLOB-API-KEY': CLOB_API_KEY,
      'CLOB-API-PASSPHRASE': CLOB_API_PASSPHRASE,
      'CLOB-API-TIMESTAMP': timestamp,
      'CLOB-API-SIGNATURE': signature,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`CLOB API error: ${response.status} ${response.statusText}`)
  }

  return await response.json()
}

async function queryWalletTrades() {
  console.log('='.repeat(80))
  console.log('CLOB API AUTHENTICATED QUERY')
  console.log('='.repeat(80))
  console.log('')
  console.log(`Wallet: ${WALLET}`)
  console.log('')

  try {
    // Try different possible endpoints for wallet trades
    const endpoints = [
      `/trades?address=${WALLET}`,
      `/trades?maker=${WALLET}`,
      `/trades?taker=${WALLET}`,
      `/data/trades?address=${WALLET}`,
      `/data/trades?maker=${WALLET}`,
    ]

    console.log('Testing different CLOB API endpoints for wallet trades...')
    console.log('-'.repeat(80))
    console.log('')

    for (const endpoint of endpoints) {
      console.log(`Testing: ${endpoint}`)

      try {
        const data = await fetchFromClobAPI(endpoint)
        const trades = Array.isArray(data) ? data : data.data || data.trades || []

        console.log(`  ✅ Success! Received ${trades.length} trades`)

        if (trades.length > 0) {
          console.log('')
          console.log('='.repeat(80))
          console.log('SUCCESS - Found trades with endpoint:', endpoint)
          console.log('='.repeat(80))
          console.log('')
          console.log(`Total trades: ${trades.length}`)

          // Analyze the data
          const sampleTrade = trades[0]
          console.log('')
          console.log('Sample trade structure:')
          console.log(JSON.stringify(sampleTrade, null, 2))
          console.log('')

          // Try to extract unique markets/conditions
          const uniqueMarkets = new Set()
          const uniqueConditions = new Set()

          for (const trade of trades) {
            if (trade.market_id || trade.market || trade.marketId) {
              uniqueMarkets.add(trade.market_id || trade.market || trade.marketId)
            }
            if (trade.condition_id || trade.conditionId) {
              uniqueConditions.add(trade.condition_id || trade.conditionId)
            }
          }

          console.log('Analysis:')
          console.log(`  Unique markets: ${uniqueMarkets.size}`)
          console.log(`  Unique conditions: ${uniqueConditions.size}`)
          console.log('')

          // Compare with ground truth
          console.log('='.repeat(80))
          console.log('COMPARISON')
          console.log('='.repeat(80))
          console.log('')
          console.log('CLOB API (authenticated):')
          console.log(`  Trades: ${trades.length}`)
          console.log(`  Markets: ${uniqueMarkets.size > 0 ? uniqueMarkets.size : 'N/A'}`)
          console.log(`  Conditions: ${uniqueConditions.size > 0 ? uniqueConditions.size : 'N/A'}`)
          console.log('')
          console.log('Our Database:')
          console.log(`  Fills: 194`)
          console.log(`  Markets: 45`)
          console.log('')
          console.log('Polymarket UI Ground Truth:')
          console.log(`  Predictions: 192`)
          console.log(`  Volume: $1,380,000`)

          return
        }

      } catch (error: any) {
        console.log(`  ❌ Failed: ${error.message}`)
      }

      console.log('')
    }

    console.log('='.repeat(80))
    console.log('❌ NO WORKING ENDPOINT FOUND')
    console.log('='.repeat(80))
    console.log('')
    console.log('Possible reasons:')
    console.log('1. Wallet has no trades in CLOB system')
    console.log('2. API endpoint structure has changed')
    console.log('3. Need different query parameters')
    console.log('4. Trades might be under a different wallet address (proxy)')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
  }
}

queryWalletTrades()
