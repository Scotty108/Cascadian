import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

async function verify() {
  console.log('Verifying resolution inference from outcome prices...\n')
  
  // Get sample of closed markets with their current_price
  const { data: closed } = await supabase
    .from('markets')
    .select('market_id, title, closed, current_price, raw_polymarket_data')
    .eq('closed', true)
    .limit(20)

  console.log('=== CLOSED MARKETS (showing current_price and outcomePrices) ===\n')
  
  closed?.forEach((m: any) => {
    const raw = m.raw_polymarket_data as any
    const prices = raw?.outcomePrices || []
    const titleShort = m.title ? m.title.substring(0, 40) : 'N/A'
    
    let outcome = 'UNKNOWN'
    if (m.current_price === 0) {
      outcome = 'NO won'
    } else if (m.current_price === 1 || m.current_price >= 0.98) {
      outcome = 'YES won'
    } else if (m.current_price <= 0.02) {
      outcome = 'NO won (inferred)'
    }
    
    console.log('Market: ' + titleShort)
    console.log('  DB current_price: ' + m.current_price)
    console.log('  API outcomePrices: ' + JSON.stringify(prices))
    console.log('  Inferred outcome: ' + outcome)
    console.log('  Has resolvedOutcome: ' + (raw?.resolvedOutcome !== undefined ? 'YES' : 'NO'))
    console.log('')
  })
}

verify().catch((e: any) => console.error(e))
