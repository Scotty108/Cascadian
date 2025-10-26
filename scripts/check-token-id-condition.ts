import { GraphQLClient } from 'graphql-request'

const client = new GraphQLClient(
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn'
)

const INTROSPECTION = /* GraphQL */ `
  {
    __type(name: "TokenIdCondition") {
      name
      fields {
        name
        type {
          name
          kind
          ofType {
            name
          }
        }
      }
    }
  }
`

async function main() {
  console.log('🔍 Checking TokenIdCondition type...\n')

  const result = await client.request(INTROSPECTION)
  const type = (result as any).__type

  console.log('TokenIdCondition fields:')
  type.fields.forEach((field: any) => {
    const typeName = field.type.name || field.type.ofType?.name || field.type.kind
    console.log(`  - ${field.name}: ${typeName}`)
  })
}

main()
