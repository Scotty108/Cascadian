import { GraphQLClient } from 'graphql-request'

const orderbookClient = new GraphQLClient(
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn'
)

const SCHEMA_QUERY = /* GraphQL */ `
  {
    __schema {
      queryType {
        fields {
          name
          description
        }
      }
    }
  }
`

const TRADE_TYPE_QUERY = /* GraphQL */ `
  {
    __type(name: "Trade") {
      name
      fields {
        name
        type {
          name
          kind
          ofType {
            name
            kind
          }
        }
      }
    }
  }
`

const ORDER_TYPE_QUERY = /* GraphQL */ `
  {
    __type(name: "Order") {
      name
      fields {
        name
        type {
          name
          kind
          ofType {
            name
            kind
          }
        }
      }
    }
  }
`

async function main() {
  console.log('🔍 Introspecting Orderbook subgraph...\n')

  try {
    // Get available queries
    const schemaResult = await orderbookClient.request(SCHEMA_QUERY)
    const fields = (schemaResult as any).__schema.queryType.fields

    console.log(`Found ${fields.length} available queries:`)
    fields.forEach((field: any) => {
      console.log(`  - ${field.name}`)
    })

    // Get Trade type if it exists
    console.log('\n\n📊 Trade type fields:')
    try {
      const tradeResult = await orderbookClient.request(TRADE_TYPE_QUERY)
      const tradeType = (tradeResult as any).__type
      if (tradeType) {
        tradeType.fields.forEach((field: any) => {
          const typeName = field.type.name || field.type.ofType?.name || field.type.kind
          console.log(`  - ${field.name}: ${typeName}`)
        })

        // Get sample trade
        console.log('\n\n📝 Fetching sample Trade...')
        const SAMPLE_TRADE = /* GraphQL */ `
          {
            trades(first: 1, orderBy: timestamp, orderDirection: desc) {
              id
              market
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
        const sampleTrade = await orderbookClient.request(SAMPLE_TRADE)
        console.log(JSON.stringify(sampleTrade, null, 2))
      }
    } catch (e) {
      console.log('  Trade type not found or error:', (e as Error).message)
    }

    // Get Order type if it exists
    console.log('\n\n📊 Order type fields:')
    try {
      const orderResult = await orderbookClient.request(ORDER_TYPE_QUERY)
      const orderType = (orderResult as any).__type
      if (orderType) {
        orderType.fields.forEach((field: any) => {
          const typeName = field.type.name || field.type.ofType?.name || field.type.kind
          console.log(`  - ${field.name}: ${typeName}`)
        })
      }
    } catch (e) {
      console.log('  Order type not found or error:', (e as Error).message)
    }
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()
