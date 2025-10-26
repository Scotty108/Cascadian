/**
 * Introspect Goldsky PnL Subgraph - UserPosition Type
 *
 * Check if we can get condition_id from userPositions
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { GraphQLClient } from 'graphql-request'

const GOLDSKY_PNL_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn'
const pnlClient = new GraphQLClient(GOLDSKY_PNL_ENDPOINT)

async function introspectUserPosition() {
  console.log('🔍 Introspecting UserPosition type in PnL subgraph...\n')

  const query = /* GraphQL */ `
    query IntrospectUserPosition {
      __type(name: "UserPosition") {
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

  try {
    const data: any = await pnlClient.request(query)
    const fields = data.__type?.fields || []

    console.log('Available fields on UserPosition:')
    console.log('='.repeat(60))
    fields.forEach((field: any) => {
      const typeName = field.type.name || field.type.ofType?.name || 'unknown'
      const typeKind = field.type.kind || field.type.ofType?.kind || ''
      console.log(`  ${field.name.padEnd(20)} : ${typeName} (${typeKind})`)
    })

    console.log('\n🎯 Looking for condition-related fields...')
    const conditionFields = fields.filter((f: any) =>
      f.name.toLowerCase().includes('condition') ||
      f.name.toLowerCase().includes('token')
    )

    if (conditionFields.length > 0) {
      console.log('Found potential condition fields:')
      conditionFields.forEach((field: any) => {
        console.log(`  ✅ ${field.name}`)
      })
    } else {
      console.log('  ❌ No condition fields found')
    }

    // Check if token is a nested object
    const tokenField = fields.find((f: any) => f.name === 'token')
    if (tokenField && tokenField.type.kind === 'OBJECT') {
      console.log('\n🔍 Token is an object! Introspecting Token type...')

      const tokenQuery = /* GraphQL */ `
        query IntrospectToken {
          __type(name: "${tokenField.type.name || tokenField.type.ofType?.name}") {
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

      const tokenData: any = await pnlClient.request(tokenQuery)
      const tokenFields = tokenData.__type?.fields || []

      console.log('\nAvailable fields on Token:')
      console.log('='.repeat(60))
      tokenFields.forEach((field: any) => {
        const typeName = field.type.name || field.type.ofType?.name || 'unknown'
        console.log(`  ${field.name.padEnd(20)} : ${typeName}`)
      })

      // Check for condition
      const conditionOnToken = tokenFields.find((f: any) =>
        f.name.toLowerCase().includes('condition')
      )
      if (conditionOnToken) {
        console.log(`\n✅ FOUND: token.${conditionOnToken.name}`)
        console.log('   We can use this to map to categories!')
      }
    }

  } catch (error: any) {
    console.error('Error:', error.message)
  }

  process.exit(0)
}

introspectUserPosition()
