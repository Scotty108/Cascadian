import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { pnlClient } from '@/lib/goldsky/client'

async function checkGoldskyEntities() {
  console.log('🔍 Investigating Goldsky Schema Entities\n')

  // Check what fields are available in Condition
  console.log('📋 CONDITION entity fields:')
  const conditionSchema = await pnlClient.request<any>(`
    {
      __type(name: "Condition") {
        fields {
          name
          type {
            name
            kind
          }
        }
      }
    }
  `)

  if (conditionSchema.__type?.fields) {
    conditionSchema.__type.fields.forEach((f: any) => {
      console.log(`  - ${f.name}: ${f.type.name || f.type.kind}`)
    })
  } else {
    console.log('  ❌ No Condition entity found')
  }

  // Check FPMM (market maker) fields - try different names
  console.log('\n\n📋 FPMM/Market entity fields:')
  for (const entityName of ['Fpmm', 'FPMM', 'Market', 'FixedProductMarketMaker']) {
    const schema = await pnlClient.request<any>(`
      {
        __type(name: "${entityName}") {
          fields {
            name
            type {
              name
              kind
            }
          }
        }
      }
    `)

    if (schema.__type?.fields) {
      console.log(`  Found entity: ${entityName}`)
      schema.__type.fields.forEach((f: any) => {
        console.log(`    - ${f.name}: ${f.type.name || f.type.kind}`)
      })
      break
    }
  }

  // Check NegRiskEvent fields (might have user stats)
  console.log('\n\n📋 NegRiskEvent entity fields:')
  const eventSchema = await pnlClient.request<any>(`
    {
      __type(name: "NegRiskEvent") {
        fields {
          name
          type {
            name
            kind
          }
        }
      }
    }
  `)

  if (eventSchema.__type?.fields) {
    eventSchema.__type.fields.forEach((f: any) => {
      console.log(`  - ${f.name}: ${f.type.name || f.type.kind}`)
    })
  } else {
    console.log('  ❌ No NegRiskEvent entity found')
  }

  // Test: Get a sample condition to see its structure
  console.log('\n\n🔍 Sample Condition structure:')
  try {
    const sampleCondition = await pnlClient.request<any>(`
      {
        conditions(first: 1) {
          id
          positionIds
          payoutNumerators
          payoutDenominator
        }
      }
    `)

    if (sampleCondition.conditions?.[0]) {
      console.log(JSON.stringify(sampleCondition.conditions[0], null, 2))
    }
  } catch (e) {
    console.log('  ❌ Could not fetch sample condition')
  }

  // Critical test: Can we link UserPosition -> Condition -> FPMM?
  console.log('\n\n🔍 Testing if we can link positions to markets...\n')

  const wallet = '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50'

  // Get a sample user position
  const positionQuery = await pnlClient.request<any>(`
    query GetPosition($wallet: String!) {
      userPositions(where: { user: $wallet }, first: 1) {
        id
        tokenId
        realizedPnl
      }
    }
  `, { wallet: wallet.toLowerCase() })

  const samplePosition = positionQuery.userPositions[0]
  console.log('Sample position:')
  console.log(`  tokenId: ${samplePosition.tokenId}`)
  console.log(`  realizedPnl: ${samplePosition.realizedPnl}`)

  // Try to find the condition/market for this token
  console.log('\n\n💡 Trying to find related condition/market...')

  // The tokenId is likely the CTF token ID
  // In Polymarket's CTF, token IDs encode: keccak256(parent, conditionId, indexSet)
  // We can't easily reverse this, but we can check if Conditions have a relation

  try {
    const conditionsQuery = await pnlClient.request<any>(`
      {
        conditions(first: 5) {
          id
        }
      }
    `)

    if (conditionsQuery.conditions?.length > 0) {
      console.log('\nSample condition IDs:')
      conditionsQuery.conditions.forEach((c: any, i: number) => {
        console.log(`  ${i + 1}. ${c.id}`)
      })
    }
  } catch (e) {
    console.log('\n  ❌ Could not fetch conditions')
  }

  console.log('\n\n🎯 KEY INSIGHT:')
  console.log('The tokenId and condition.id are both very long numbers')
  console.log('They might be related through CTF encoding')
  console.log('\nWe need to either:')
  console.log('1. Decode tokenId to extract conditionId')
  console.log('2. Find if FPMM or Condition has user-aggregated PnL')
  console.log('3. Stick with correction factor approach')
}

checkGoldskyEntities()
