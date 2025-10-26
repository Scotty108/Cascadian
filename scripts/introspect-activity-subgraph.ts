import { GraphQLClient } from 'graphql-request'

const activityClient = new GraphQLClient(
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn'
)

const SCHEMA_QUERY = /* GraphQL */ `
  {
    __schema {
      queryType {
        fields {
          name
          description
          args {
            name
            type {
              name
              kind
            }
          }
        }
      }
    }
  }
`

async function main() {
  console.log('🔍 Introspecting Activity subgraph schema...\n')

  try {
    const result = await activityClient.request(SCHEMA_QUERY)
    const fields = (result as any).__schema.queryType.fields

    console.log(`Found ${fields.length} available queries:\n`)

    // Look for trade-related queries
    const tradeQueries = fields.filter((f: any) =>
      f.name.toLowerCase().includes('trade') ||
      f.name.toLowerCase().includes('transaction') ||
      f.name.toLowerCase().includes('position') ||
      f.name.toLowerCase().includes('fpmm')
    )

    console.log('📊 Trade-related queries:')
    tradeQueries.forEach((field: any) => {
      console.log(`\n- ${field.name}`)
      if (field.description) {
        console.log(`  Description: ${field.description}`)
      }
      if (field.args && field.args.length > 0) {
        console.log('  Arguments:')
        field.args.forEach((arg: any) => {
          console.log(`    - ${arg.name}: ${arg.type.name || arg.type.kind}`)
        })
      }
    })

    console.log('\n\n📋 All available queries:')
    fields.forEach((field: any) => {
      console.log(`- ${field.name}`)
    })
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()
