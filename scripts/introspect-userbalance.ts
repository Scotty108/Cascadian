import { GraphQLClient } from 'graphql-request'

const positionsClient = new GraphQLClient(
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn'
)

const INTROSPECTION = /* GraphQL */ `
  {
    __type(name: "UserBalance") {
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

const SAMPLE_QUERY = /* GraphQL */ `
  {
    userBalances(first: 1) {
      id
      user
      balance
    }
  }
`

async function main() {
  console.log('🔍 Introspecting UserBalance type...\n')

  try {
    const result = await positionsClient.request(INTROSPECTION)
    const userBalanceType = (result as any).__type

    console.log('UserBalance fields:')
    userBalanceType.fields.forEach((field: any) => {
      const typeName = field.type.name || field.type.ofType?.name || field.type.kind
      console.log(`  - ${field.name}: ${typeName}`)
    })

    console.log('\n📝 Fetching sample UserBalance...\n')
    const sample = await positionsClient.request(SAMPLE_QUERY)
    console.log('Sample data:')
    console.log(JSON.stringify(sample, null, 2))
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()
