/**
 * Test Polymarket API for accurate PnL data
 *
 * Polymarket has public APIs we can use:
 * - https://docs.polymarket.com/
 */

async function testPolymarketAPI() {
  const wallet = '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50'

  console.log('🔍 Testing Polymarket API for accurate PnL\n')

  // Try CLOB API for user positions
  // Based on Polymarket docs, they have endpoints like:
  // https://clob.polymarket.com/positions/{address}

  try {
    // Test 1: CLOB API
    console.log('Test 1: CLOB API (positions)')
    const clobUrl = `https://clob.polymarket.com/positions/${wallet}`
    const clobResponse = await fetch(clobUrl)

    if (clobResponse.ok) {
      const clobData = await clobResponse.json()
      console.log('✅ CLOB API Response:')
      console.log(JSON.stringify(clobData, null, 2))
    } else {
      console.log(`❌ CLOB API returned ${clobResponse.status}`)
    }
  } catch (error) {
    console.log(`❌ CLOB API error: ${(error as Error).message}`)
  }

  // Test 2: Try gamma API (if it exists)
  try {
    console.log('\n\nTest 2: Gamma/Stats API')
    const gammaUrl = `https://gamma-api.polymarket.com/user/${wallet}`
    const gammaResponse = await fetch(gammaUrl)

    if (gammaResponse.ok) {
      const gammaData = await gammaResponse.json()
      console.log('✅ Gamma API Response:')
      console.log(JSON.stringify(gammaData, null, 2))
    } else {
      console.log(`❌ Gamma API returned ${gammaResponse.status}`)
    }
  } catch (error) {
    console.log(`❌ Gamma API error: ${(error as Error).message}`)
  }

  // Test 3: Try strapi API (content API)
  try {
    console.log('\n\nTest 3: Strapi/Content API')
    const strapiUrl = `https://strapi-matic.poly.market/users?filters[address][$eq]=${wallet}`
    const strapiResponse = await fetch(strapiUrl)

    if (strapiResponse.ok) {
      const strapiData = await strapiResponse.json()
      console.log('✅ Strapi API Response:')
      console.log(JSON.stringify(strapiData, null, 2))
    } else {
      console.log(`❌ Strapi API returned ${strapiResponse.status}`)
    }
  } catch (error) {
    console.log(`❌ Strapi API error: ${(error as Error).message}`)
  }

  console.log('\n\n💡 Recommendation:')
  console.log('We should use Polymarket\'s official API for PnL data')
  console.log('This will give us the same numbers users see on the platform')
}

testPolymarketAPI()
