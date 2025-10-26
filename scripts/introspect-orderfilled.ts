import { GraphQLClient } from 'graphql-request'

const orderbookClient = new GraphQLClient(
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn'
)

const ORDER_FILLED_TYPE = /* GraphQL */ `
  {
    __type(name: "OrderFilledEvent") {
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

const ORDERS_MATCHED_TYPE = /* GraphQL */ `
  {
    __type(name: "OrdersMatchedEvent") {
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
  console.log('🔍 Introspecting order event types...\n')

  try {
    // OrderFilledEvent
    console.log('📊 OrderFilledEvent fields:')
    const filledResult = await orderbookClient.request(ORDER_FILLED_TYPE)
    const filledType = (filledResult as any).__type
    filledType.fields.forEach((field: any) => {
      const typeName = field.type.name || field.type.ofType?.name || field.type.kind
      console.log(`  - ${field.name}: ${typeName}`)
    })

    // OrdersMatchedEvent
    console.log('\n📊 OrdersMatchedEvent fields:')
    const matchedResult = await orderbookClient.request(ORDERS_MATCHED_TYPE)
    const matchedType = (matchedResult as any).__type
    matchedType.fields.forEach((field: any) => {
      const typeName = field.type.name || field.type.ofType?.name || field.type.kind
      console.log(`  - ${field.name}: ${typeName}`)
    })

    // Sample data - use actual fields only
    console.log('\n\n📝 Fetching sample OrderFilledEvent...')
    const SAMPLE_FILLED = /* GraphQL */ `
      {
        orderFilledEvents(first: 1, orderBy: timestamp, orderDirection: desc) {
          id
          orderHash
          maker
          taker
          makerAssetId
          takerAssetId
          makerAmountFilled
          takerAmountFilled
          fee
          timestamp
          transactionHash
        }
      }
    `
    const sampleFilled = await orderbookClient.request(SAMPLE_FILLED)
    console.log(JSON.stringify(sampleFilled, null, 2))

    console.log('\n\n📝 Fetching sample OrdersMatchedEvent...')
    const SAMPLE_MATCHED = /* GraphQL */ `
      {
        ordersMatchedEvents(first: 1, orderBy: timestamp, orderDirection: desc) {
          id
          makerAssetID
          takerAssetID
          makerAmountFilled
          takerAmountFilled
          timestamp
        }
      }
    `
    const sampleMatched = await orderbookClient.request(SAMPLE_MATCHED)
    console.log(JSON.stringify(sampleMatched, null, 2))
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()
