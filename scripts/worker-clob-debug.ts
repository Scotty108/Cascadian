import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import crypto from 'crypto'

const CLOB_API_KEY = process.env.CLOB_API_KEY || ''
const CLOB_API_SECRET = process.env.CLOB_API_SECRET || ''
const CLOB_API_PASSPHRASE = process.env.CLOB_API_PASSPHRASE || ''

function createClobSignature(timestamp: string, method: string, path: string, body: string = ''): string {
  const message = timestamp + method + path + body
  const hmac = crypto.createHmac('sha256', Buffer.from(CLOB_API_SECRET, 'utf-8'))
  return hmac.update(message).digest('base64')
}

async function fetchFromClobAPI(path: string, method: string = 'GET'): Promise<any> {
  const timestamp = new Date().toISOString()
  const signature = createClobSignature(timestamp, method, path)

  console.log(`\n[DEBUG] Fetching: ${path}`)
  console.log(`[DEBUG] Signature: ${signature.substring(0, 20)}...`)

  try {
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

    console.log(`[DEBUG] Response status: ${response.status}`)

    if (!response.ok) {
      const text = await response.text()
      console.log(`[DEBUG] Error response: ${text.substring(0, 200)}`)
      throw new Error(`CLOB API error: ${response.status}`)
    }

    const data = await response.json()
    console.log(`[DEBUG] Response type: ${typeof data}`)
    console.log(`[DEBUG] Is array: ${Array.isArray(data)}`)

    if (Array.isArray(data)) {
      console.log(`[DEBUG] Array length: ${data.length}`)
      if (data.length > 0) {
        console.log(`[DEBUG] First item keys: ${Object.keys(data[0]).join(', ')}`)
        console.log(`[DEBUG] First item: ${JSON.stringify(data[0]).substring(0, 200)}`)
      }
    } else if (data && typeof data === 'object') {
      console.log(`[DEBUG] Object keys: ${Object.keys(data).join(', ')}`)
      if (data.data) {
        console.log(`[DEBUG] Has .data property, length: ${Array.isArray(data.data) ? data.data.length : 'not array'}`)
        if (Array.isArray(data.data) && data.data.length > 0) {
          console.log(`[DEBUG] First data item keys: ${Object.keys(data.data[0]).join(', ')}`)
          console.log(`[DEBUG] First data item: ${JSON.stringify(data.data[0]).substring(0, 200)}`)
        }
      }
    }

    return data
  } catch (e) {
    console.log(`[DEBUG] Fetch error: ${(e as any).message}`)
    throw new Error(`CLOB fetch failed: ${(e as any).message}`)
  }
}

async function main() {
  console.log('═'.repeat(70))
  console.log('🔧 CLOB API DEBUG - Testing Credentials & Data')
  console.log('═'.repeat(70))
  console.log()

  console.log('Credentials loaded:')
  console.log(`  Key: ${CLOB_API_KEY.substring(0, 10)}...`)
  console.log(`  Secret: ${CLOB_API_SECRET.substring(0, 10)}...`)
  console.log(`  Passphrase: ${CLOB_API_PASSPHRASE.substring(0, 10)}...`)
  console.log()

  try {
    console.log('Step 1: Fetch first page of markets...')
    const result = await fetchFromClobAPI('/markets?offset=0&limit=10')

    console.log()
    console.log('Step 2: Try to extract market_id and condition_id...')

    let extracted = 0
    const markets = Array.isArray(result) ? result : result.data || []

    for (const market of markets) {
      if (market.conditionId && market.id) {
        console.log(`  ✓ Market ${market.id}: condition_id=${market.conditionId.substring(0, 20)}...`)
        extracted++
      }
    }

    console.log()
    console.log(`Successfully extracted ${extracted} markets with both id and conditionId`)

  } catch (e) {
    console.error('❌ Error:', (e as any).message)
  }
}

main()
