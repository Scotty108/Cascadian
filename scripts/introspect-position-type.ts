import { GraphQLClient } from 'graphql-request'

const activityClient = new GraphQLClient(
  'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn'
)

const TYPE_QUERY = /* GraphQL */ `
  {
    __type(name: "Position") {
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

const SPLIT_TYPE_QUERY = /* GraphQL */ `
  {
    __type(name: "Split") {
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

const MERGE_TYPE_QUERY = /* GraphQL */ `
  {
    __type(name: "Merge") {
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
  console.log('🔍 Introspecting Activity subgraph types...\n')

  try {
    // Position type
    console.log('📊 Position fields:')
    const posResult = await activityClient.request(TYPE_QUERY)
    const posType = (posResult as any).__type
    posType.fields.forEach((field: any) => {
      const typeName = field.type.name || field.type.ofType?.name || field.type.kind
      console.log(`  - ${field.name}: ${typeName}`)
    })

    // Split type
    console.log('\n📊 Split fields (buying positions):')
    const splitResult = await activityClient.request(SPLIT_TYPE_QUERY)
    const splitType = (splitResult as any).__type
    splitType.fields.forEach((field: any) => {
      const typeName = field.type.name || field.type.ofType?.name || field.type.kind
      console.log(`  - ${field.name}: ${typeName}`)
    })

    // Merge type
    console.log('\n📊 Merge fields (selling positions):')
    const mergeResult = await activityClient.request(MERGE_TYPE_QUERY)
    const mergeType = (mergeResult as any).__type
    mergeType.fields.forEach((field: any) => {
      const typeName = field.type.name || field.type.ofType?.name || field.type.kind
      console.log(`  - ${field.name}: ${typeName}`)
    })

    // Sample query - use actual field names
    console.log('\n\n📝 Fetching sample Split event...')
    const SAMPLE_SPLIT = /* GraphQL */ `
      {
        splits(first: 1, orderBy: timestamp, orderDirection: desc) {
          id
          stakeholder
          condition
          amount
          timestamp
        }
      }
    `
    const sampleSplit = await activityClient.request(SAMPLE_SPLIT)
    console.log(JSON.stringify(sampleSplit, null, 2))

    console.log('\n\n📝 Fetching sample Merge event...')
    const SAMPLE_MERGE = /* GraphQL */ `
      {
        merges(first: 1, orderBy: timestamp, orderDirection: desc) {
          id
          stakeholder
          condition
          amount
          timestamp
        }
      }
    `
    const sampleMerge = await activityClient.request(SAMPLE_MERGE)
    console.log(JSON.stringify(sampleMerge, null, 2))
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

main()
