import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function testGoldskyAPI() {
  console.log('🧪 Testing Goldsky Positions API...\n')

  const testWallet = '0x0000000000000000000000000000000000000001'

  const query = `
    query GetWalletTrades($wallet: String!, $limit: Int!) {
      orderFilledEvents(
        where: { or: [{ maker: $wallet }, { taker: $wallet }] }
        first: $limit
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        maker
        taker
        makerAssetId
        takerAssetId
        timestamp
      }
    }
  `

  try {
    const response = await fetch('https://api.goldsky.com/api/public/project/clti025nw000208jn7eym3u93/subgraphs/Polymarket_Orders_Subgraph/1.0.0/gql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          wallet: testWallet,
          limit: 1
        }
      })
    })

    console.log(`Response Status: ${response.status} ${response.statusText}`)

    if (response.status === 503) {
      console.log('❌ API STILL DOWN (503 Service Unavailable)')
      console.log('   The Positions API is not recovering')
      process.exit(1)
    }

    const data = await response.json() as any

    if (data.errors) {
      console.log('❌ API ERROR:', data.errors[0]?.message)
      process.exit(1)
    }

    if (data.data?.orderFilledEvents !== undefined) {
      console.log('✅ API IS BACK ONLINE!')
      console.log(`   Got response with ${data.data.orderFilledEvents.length} events`)
      console.log('\n✨ Positions API is responding correctly - we can use it!')
      process.exit(0)
    }

    console.log('⚠️  Unexpected response:', JSON.stringify(data).substring(0, 200))
    process.exit(1)

  } catch (error) {
    console.log('❌ CONNECTION ERROR:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

testGoldskyAPI()
