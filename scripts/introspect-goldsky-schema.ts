import { GraphQLClient } from 'graphql-request'

const GOLDSKY_ENDPOINTS = {
  activity:
    'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn',
  positions:
    'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/positions-subgraph/0.0.7/gn',
}

const INTROSPECTION_QUERY = /* GraphQL */ `
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

async function introspectSchema(name: string, endpoint: string) {
  console.log(`\n📊 Introspecting ${name} subgraph...\n`)
  console.log(`Endpoint: ${endpoint}\n`)

  const client = new GraphQLClient(endpoint)

  try {
    const result = await client.request(INTROSPECTION_QUERY)

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

    return fields
  } catch (error) {
    console.error(`❌ Failed to introspect:`, error)
  }
}

async function main() {
  console.log('🔍 Discovering Goldsky Subgraph Schemas\n')
  console.log('=' + '='.repeat(60))

  await introspectSchema('Activity', GOLDSKY_ENDPOINTS.activity)
  await introspectSchema('Positions', GOLDSKY_ENDPOINTS.positions)

  console.log('\n' + '='.repeat(60))
  console.log('\n✅ Introspection complete!')
}

main()
