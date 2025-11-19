#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const CLOB_API_BASE = 'https://clob.polymarket.com'

interface ClobFill {
  id: string
  market: string
  asset_id: string
  order_id: string
  side: 'BUY' | 'SELL'
  size: string
  price: string
  timestamp: string
  maker_address: string
  taker_address: string
}

async function queryPolymarketClobAPI() {
  console.log('='.repeat(80))
  console.log('POLYMARKET CLOB API DIRECT QUERY')
  console.log('='.repeat(80))
  console.log('')
  console.log(`Wallet: ${WALLET}`)
  console.log('')

  try {
    // Query fills for this wallet (paginated)
    let allFills: ClobFill[] = []
    let nextCursor: string | null = null
    let page = 1

    console.log('Fetching fills from Polymarket CLOB API...')
    console.log('-'.repeat(80))

    do {
      const url = nextCursor
        ? `${CLOB_API_BASE}/trades?address=${WALLET}&next_cursor=${nextCursor}`
        : `${CLOB_API_BASE}/trades?address=${WALLET}`

      console.log(`Page ${page}: ${url}`)

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json'
        }
      })

      if (!response.ok) {
        console.log(`❌ HTTP ${response.status}: ${response.statusText}`)
        break
      }

      const data = await response.json() as { data?: ClobFill[], next_cursor?: string }

      if (!data.data || data.data.length === 0) {
        console.log(`  → No more data`)
        break
      }

      console.log(`  → Received ${data.data.length} fills`)
      allFills.push(...data.data)

      nextCursor = data.next_cursor || null
      page++

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500))

    } while (nextCursor && page <= 20) // Safety limit: max 20 pages

    console.log('')
    console.log('='.repeat(80))
    console.log('RESULTS')
    console.log('='.repeat(80))
    console.log('')

    console.log(`Total fills fetched: ${allFills.length}`)

    if (allFills.length === 0) {
      console.log('')
      console.log('⚠️  No fills returned from Polymarket CLOB API')
      console.log('   This could mean:')
      console.log('   1. Wallet has no trading history in CLOB')
      console.log('   2. API endpoint changed')
      console.log('   3. Wallet address format incorrect')
      console.log('   4. API requires authentication')
      return
    }

    // Analyze the fills
    const uniqueMarkets = new Set(allFills.map(f => f.market)).size
    const totalVolume = allFills.reduce((sum, f) => {
      return sum + (parseFloat(f.price) * parseFloat(f.size))
    }, 0)

    const firstFill = allFills[allFills.length - 1]
    const lastFill = allFills[0]

    console.log(`Unique markets: ${uniqueMarkets}`)
    console.log(`Total volume: $${totalVolume.toLocaleString()}`)
    console.log(`Time range: ${firstFill?.timestamp} to ${lastFill?.timestamp}`)
    console.log('')

    // Sample first 10 fills
    console.log('Sample fills (first 10):')
    console.log('-'.repeat(80))
    allFills.slice(0, 10).forEach((f, idx) => {
      console.log(`${idx + 1}. ${f.id}`)
      console.log(`   ${f.timestamp} | ${f.side} | Price: $${f.price} | Size: ${f.size}`)
      console.log(`   Market: ${f.market}`)
    })
    console.log('')

    // Compare with our database
    console.log('='.repeat(80))
    console.log('COMPARISON WITH OUR DATABASE')
    console.log('='.repeat(80))
    console.log('')

    console.log('Polymarket CLOB API:')
    console.log(`  Fills: ${allFills.length}`)
    console.log(`  Markets: ${uniqueMarkets}`)
    console.log(`  Volume: $${totalVolume.toLocaleString()}`)
    console.log('')

    console.log('Our Database (from previous investigation):')
    console.log(`  Fills: 194`)
    console.log(`  Markets: 45`)
    console.log(`  Volume: $59,635`)
    console.log('')

    console.log('Polymarket UI Ground Truth:')
    console.log(`  Predictions: 192`)
    console.log(`  Volume: $1,380,000`)
    console.log('')

    const fillCoverage = (194 / allFills.length * 100).toFixed(1)
    const marketCoverage = (45 / uniqueMarkets * 100).toFixed(1)

    console.log('Coverage Analysis:')
    console.log(`  Fill coverage: ${fillCoverage}%`)
    console.log(`  Market coverage: ${marketCoverage}%`)
    console.log('')

    if (allFills.length > 194) {
      console.log(`⚠️  CLOB API returns ${allFills.length - 194} MORE fills than our database`)
      console.log(`   → Our CLOB backfill is missing data`)
    } else if (allFills.length < 194) {
      console.log(`⚠️  Our database has ${194 - allFills.length} MORE fills than CLOB API`)
      console.log(`   → This suggests we may have duplicate/incorrect data`)
    } else {
      console.log(`✅ Fill counts match between CLOB API and our database`)
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
  }
}

queryPolymarketClobAPI()
