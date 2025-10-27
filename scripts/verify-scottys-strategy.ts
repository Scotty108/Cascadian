#!/usr/bin/env tsx
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

async function verifyStrategy() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('strategy_definitions')
    .select('strategy_id, strategy_name, strategy_type, is_predefined, execution_mode, node_graph')
    .eq('strategy_name', "Scotty's Strategy")
    .single()

  if (error) {
    console.error('❌ Error:', error)
    return
  }

  console.log('✅ Strategy found in database!')
  console.log('\nStrategy Details:')
  console.log('- ID:', data.strategy_id)
  console.log('- Name:', data.strategy_name)
  console.log('- Type:', data.strategy_type)
  console.log('- Predefined:', data.is_predefined)
  console.log('- Execution Mode:', data.execution_mode)
  console.log('\nNode Graph:')
  console.log('- Nodes:', data.node_graph.nodes.length)
  console.log('- Edges:', data.node_graph.edges.length)

  console.log('\nNode Types:')
  data.node_graph.nodes.forEach((node: any) => {
    console.log(`  - ${node.type} (${node.id})`)
  })
}

verifyStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
