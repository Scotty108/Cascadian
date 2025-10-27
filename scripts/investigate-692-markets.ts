import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
)

async function investigate() {
  // Sample 5 closed markets
  const { data: closed } = await supabase
    .from('markets')
    .select('market_id, title, condition_id, closed, current_price, raw_polymarket_data')
    .eq('closed', true)
    .limit(5)

  console.log('=== SAMPLE OF 5 CLOSED MARKETS ===')
  closed?.forEach((m: any) => {
    const raw = m.raw_polymarket_data as any
    const titleShort = m.title ? m.title.substring(0, 50) : 'N/A'
    console.log('Market: ' + titleShort)
    console.log('  Market ID: ' + m.market_id)
    console.log('  closed in DB: ' + m.closed)
    console.log('  current_price: ' + m.current_price)
    console.log('  resolvedOutcome: ' + (raw?.resolvedOutcome || 'undefined'))
    const keys = raw ? Object.keys(raw).slice(0, 10).join(', ') : 'N/A'
    console.log('  first keys: ' + keys)
    console.log('')
  })

  // Count totals
  const { count: totalClosed } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true })
    .eq('closed', true)

  const { count: totalMarkets } = await supabase
    .from('markets')
    .select('*', { count: 'exact', head: true })

  console.log('=== SUMMARY ===')
  console.log('Total markets: ' + totalMarkets)
  console.log('Closed markets: ' + totalClosed)
  
  // Check how many have resolvedOutcome
  const { data: allClosed } = await supabase
    .from('markets')
    .select('raw_polymarket_data')
    .eq('closed', true)

  const withResolved = allClosed?.filter((m: any) => {
    const raw = m.raw_polymarket_data as any
    return raw?.resolvedOutcome !== undefined
  }).length || 0

  console.log('Closed markets with resolvedOutcome: ' + withResolved)
  const total = totalClosed || 0
  console.log('Closed markets WITHOUT resolvedOutcome: ' + (total - withResolved))
}

investigate().catch((e: any) => console.error(e))
