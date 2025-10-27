import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function testEndpoints() {
  const baseUrl = 'https://gamma-api.polymarket.com'
  
  console.log('Testing Polymarket API endpoints for resolution data...\n')
  
  // Try different endpoint variations
  const endpoints = [
    { url: baseUrl + '/markets?closed=true&limit=1', desc: 'GET /markets?closed=true' },
    { url: baseUrl + '/markets?active=false&limit=1', desc: 'GET /markets?active=false' },
    { url: baseUrl + '/markets/567532', desc: 'GET /markets/{id} - Closed market detail' },
    { url: baseUrl + '/events?closed=true&limit=1', desc: 'GET /events?closed=true' },
  ]
  
  for (const endpoint of endpoints) {
    try {
      console.log('Testing: ' + endpoint.desc)
      console.log('  URL: ' + endpoint.url)
      
      const response = await fetch(endpoint.url, { timeout: 5000 })
      const data = await response.json()
      
      // Check structure
      const sample = Array.isArray(data) ? data[0] : data
      if (sample) {
        console.log('  Status: ' + response.status)
        console.log('  Has resolvedOutcome: ' + (sample.resolvedOutcome !== undefined))
        console.log('  Has resolved: ' + (sample.resolved !== undefined))
        console.log('  Keys: ' + Object.keys(sample).slice(0, 8).join(', '))
      }
    } catch (err: any) {
      console.log('  Error: ' + err.message)
    }
    console.log('')
  }
}

testEndpoints()
