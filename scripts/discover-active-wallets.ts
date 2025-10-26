import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { positionsClient } from '@/lib/goldsky/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Discover Active Wallets from Top Markets
 */

async function getMarketTopWallets(conditionId: string): Promise<string[]> {
  try {
    const query = `
      query GetMarketPositions($conditionId: String!) {
        fpmmPoolMemberships(
          where: {
            fpmm_: { condition: $conditionId }
          }
          first: 40
          orderBy: amount
          orderDirection: desc
        ) {
          user
          amount
        }
      }
    `

    const data = await positionsClient.request<any>(query, { conditionId })
    const positions = data.fpmmPoolMemberships || []

    return positions.map((p: any) => p.user.toLowerCase())
  } catch (error) {
    console.error(\`  ❌ Failed to fetch positions for \${conditionId}\`, error)
    return []
  }
}

async function discoverActiveWallets() {
  console.log('🔍 Discovering Active Wallets from Top Markets\n')

  const { data: markets } = await supabase
    .from('markets')
    .select('condition_id, question, volume_24h')
    .eq('active', true)
    .order('volume_24h', { ascending: false })
    .limit(50)

  if (!markets) return

  console.log(\`📊 Processing \${markets.length} top markets...\n\`)

  const walletSet = new Set<string>()
  const walletMarkets = new Map<string, number>()

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i]
    const questionPreview = market.question ? market.question.substring(0, 50) : 'Unknown'

    console.log(\`[\${i + 1}/\${markets.length}] \${questionPreview}...\`)

    const wallets = await getMarketTopWallets(market.condition_id)

    if (wallets.length > 0) {
      wallets.forEach((wallet) => {
        walletSet.add(wallet)
        walletMarkets.set(wallet, (walletMarkets.get(wallet) || 0) + 1)
      })
      console.log(\`  ✅ Found \${wallets.length} active wallets\`)
    }

    if (i < markets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  console.log(\`\n📊 Discovery Summary: \${walletSet.size} unique wallets\`)

  const walletsData = Array.from(walletSet).map((wallet) => ({
    wallet_address: wallet,
    markets_active_in: walletMarkets.get(wallet) || 1,
    discovered_at: new Date().toISOString(),
  }))

  walletsData.sort((a, b) => b.markets_active_in - a.markets_active_in)

  const fs = await import('fs/promises')
  await fs.writeFile(
    'discovered-wallets.json',
    JSON.stringify({ discovered_at: new Date().toISOString(), total_wallets: walletsData.length, wallets: walletsData }, null, 2)
  )

  console.log(\`✅ Saved \${walletsData.length} wallets to discovered-wallets.json\`)

  return walletsData
}

discoverActiveWallets()
