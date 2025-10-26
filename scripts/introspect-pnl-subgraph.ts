import { GraphQLClient } from 'graphql-request'

const pnlClient = new GraphQLClient(
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn'
)

const SCHEMA_QUERY = /* GraphQL */ `
  {
    __schema {
      queryType {
        fields {
          name
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

async function introspectPnLSubgraph() {
  console.log('🔍 Introspecting PnL subgraph schema...\n')

  try {
    const result = await pnlClient.request(SCHEMA_QUERY)
    const fields = (result as any).__schema.queryType.fields

    console.log(`Found ${fields.length} available queries:\n`)
    fields.forEach((field: any) => {
      console.log(`- ${field.name}`)
      if (field.args && field.args.length > 0) {
        field.args.forEach((arg: any) => {
          console.log(`    ${arg.name}: ${arg.type.name || arg.type.kind}`)
        })
      }
    })

    // Look for account-related queries
    console.log('\n\n📊 Account-related queries:')
    const accountQueries = fields.filter((f: any) =>
      f.name.toLowerCase().includes('account') || f.name.toLowerCase().includes('wallet') || f.name.toLowerCase().includes('user')
    )

    if (accountQueries.length > 0) {
      accountQueries.forEach((field: any) => {
        console.log(`\n- ${field.name}`)
        if (field.args && field.args.length > 0) {
          field.args.forEach((arg: any) => {
            console.log(`    ${arg.name}: ${arg.type.name || arg.type.kind}`)
          })
        }
      })

      // Try to introspect the type
      const firstQuery = accountQueries[0].name
      console.log(`\n\n🔍 Introspecting type for "${firstQuery}"...`)

      // Get singular type name (remove 's' if plural)
      const typeName = firstQuery.charAt(0).toUpperCase() + firstQuery.slice(1).replace(/s$/, '')

      const TYPE_QUERY = `
        {
          __type(name: "${typeName}") {
            name
            fields {
              name
              type {
                name
                kind
              }
            }
          }
        }
      `

      try {
        const typeResult = await pnlClient.request(TYPE_QUERY)
        const typeInfo = (typeResult as any).__type

        if (typeInfo) {
          console.log(`\nFields in ${typeName}:`)
          typeInfo.fields.forEach((field: any) => {
            console.log(`  - ${field.name}: ${field.type.name || field.type.kind}`)
          })
        }
      } catch (e) {
        console.log(`  Could not introspect type ${typeName}`)
      }
    } else {
      console.log('  None found specifically, checking all queries...')
    }
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

introspectPnLSubgraph()
