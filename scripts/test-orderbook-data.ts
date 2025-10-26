import { GraphQLClient } from 'graphql-request'

const orderbookClient = new GraphQLClient(
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn'
)

async function testOrderbookData() {
  console.log('🔍 Testing orderbook subgraph for trade data...\n')

  // Get recent trades
  const RECENT_TRADES = /* GraphQL */ `
    {
      orderFilledEvents(first: 5, orderBy: timestamp, orderDirection: desc) {
        id
        maker
        taker
        makerAssetId
        takerAssetId
        makerAmountFilled
        takerAmountFilled
        timestamp
      }
    }
  `

  try {
    const result = await orderbookClient.request<any>(RECENT_TRADES)
    const trades = result.orderFilledEvents

    if (trades.length === 0) {
      console.log('❌ No trades found in orderbook subgraph')
      console.log('   The orderbook might be empty or this subgraph might not have trade data')
      return
    }

    console.log(`✅ Found ${trades.length} recent trades:\n`)
    trades.forEach((trade: any, i: number) => {
      const timestamp = new Date(parseInt(trade.timestamp) * 1000)
      console.log(`${i + 1}. Trade at ${timestamp.toISOString()}`)
      console.log(`   Maker: ${trade.maker}`)
      console.log(`   Taker: ${trade.taker}`)
      console.log(`   Maker gave: ${trade.makerAmountFilled} of asset ${trade.makerAssetId}`)
      console.log(`   Taker gave: ${trade.takerAmountFilled} of asset ${trade.takerAssetId}`)
      console.log()
    })

    // Test with a specific wallet that has trades
    const firstMaker = trades[0].maker
    console.log(`\n📊 Testing fetchWalletTrades with maker: ${firstMaker}\n`)

    const WALLET_TRADES = /* GraphQL */ `
      query {
        orderFilledEvents(
          where: { or: [{ maker: "${firstMaker}" }, { taker: "${firstMaker}" }] }
          first: 10
        ) {
          id
          maker
          taker
          timestamp
        }
      }
    `

    const walletResult = await orderbookClient.request<any>(WALLET_TRADES)
    console.log(`✅ Found ${walletResult.orderFilledEvents.length} trades for this wallet`)

    if (walletResult.orderFilledEvents.length > 0) {
      console.log(`\n✅ The orderbook subgraph is working!`)
      console.log(`   Test sync with this wallet: ${firstMaker}`)
    }
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

testOrderbookData()
