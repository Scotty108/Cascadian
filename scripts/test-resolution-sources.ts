import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function testResolutionSources() {
  console.log('Investigating resolution data sources...\n')
  
  // Test 1: Check if there's a dedicated resolution endpoint
  console.log('1. Checking Polymarket API for resolution endpoint...')
  const endpoints = [
    'https://gamma-api.polymarket.com/resolved-markets',
    'https://gamma-api.polymarket.com/markets/567532/resolution',
    'https://gamma-api.polymarket.com/resolutions',
  ]
  
  for (const url of endpoints) {
    try {
      const response = await fetch(url, { timeout: 3000 })
      console.log('  ' + url + ' -> ' + response.status)
    } catch {
      console.log('  ' + url + ' -> Error/No response')
    }
  }
  
  // Test 2: Check if current_price in our DB was inferred from API
  console.log('\n2. Fetched market detail from API for comparison:')
  const marketId = '567532'
  try {
    const response = await fetch('https://gamma-api.polymarket.com/markets/' + marketId)
    const data: any = await response.json()
    console.log('  API current_price: ' + (data.outcomePrices || data.outcomePrices))
    console.log('  API closed: ' + data.closed)
    console.log('  API active: ' + data.active)
    console.log('  Keys: ' + Object.keys(data).join(', '))
  } catch (e: any) {
    console.log('  Error: ' + e.message)
  }
  
  // Test 3: Check Goldsky (if available)
  console.log('\n3. Checking if Goldsky has resolution data...')
  const goldskUrl = process.env.GOLDSKY_URL
  if (goldskUrl) {
    console.log('  Goldsky configured: Yes')
  } else {
    console.log('  Goldsky configured: No')
  }
}

testResolutionSources()
