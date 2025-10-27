#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

async function examineStrategy() {
  const strategyName = process.argv[2] || 'Balanced Hybrid'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data } = await supabase
    .from('strategy_definitions')
    .select('strategy_name, node_graph, execution_mode, schedule_cron')
    .eq('strategy_name', strategyName)
    .single()

  if (!data) {
    console.log(`Strategy "${strategyName}" not found`)
    process.exit(1)
  }

  console.log(`\n${data.strategy_name.toUpperCase()} STRATEGY\n`)
  console.log('Execution Mode:', data.execution_mode)
  if (data.schedule_cron) {
    console.log('Schedule:', data.schedule_cron)
  }
  console.log('Nodes:', data.node_graph.nodes.length)
  console.log('Edges:', data.node_graph.edges.length)

  console.log('\nNODES:')
  data.node_graph.nodes.forEach((n: any, i: number) => {
    console.log(`  ${i + 1}. ${n.type.padEnd(20)} (id: ${n.id})`)
    if (n.config) {
      const configKeys = Object.keys(n.config)
      console.log(`     Config: ${configKeys.join(', ')}`)
    }
  })

  console.log('\nEDGES:')
  data.node_graph.edges.forEach((e: any, i: number) => {
    const from = data.node_graph.nodes.find((n: any) => n.id === e.from)
    const to = data.node_graph.nodes.find((n: any) => n.id === e.to)
    console.log(`  ${i + 1}. ${from?.type} → ${to?.type}`)
    console.log(`     (${e.from} → ${e.to})`)
  })

  // Analyze graph structure
  const nodeIds = data.node_graph.nodes.map((n: any) => n.id)
  const edgeFromIds = data.node_graph.edges.map((e: any) => e.from)
  const edgeToIds = data.node_graph.edges.map((e: any) => e.to)

  const firstNodes = nodeIds.filter((id: string) => !edgeToIds.includes(id))
  const lastNodes = nodeIds.filter((id: string) => !edgeFromIds.includes(id))

  console.log('\nGRAPH ANALYSIS:')
  console.log('Start nodes (no incoming):', firstNodes.join(', '))
  console.log('End nodes (no outgoing):', lastNodes.join(', '))

  // Find nodes with multiple incoming/outgoing edges
  const nodesWithMultipleIncoming = nodeIds.filter(
    (id: string) => edgeToIds.filter((to: string) => to === id).length > 1
  )
  const nodesWithMultipleOutgoing = nodeIds.filter(
    (id: string) => edgeFromIds.filter((from: string) => from === id).length > 1
  )

  if (nodesWithMultipleIncoming.length > 0) {
    console.log('Nodes with multiple incoming edges:', nodesWithMultipleIncoming.join(', '))
  }
  if (nodesWithMultipleOutgoing.length > 0) {
    console.log('Nodes with multiple outgoing edges:', nodesWithMultipleOutgoing.join(', '))
  }

  // Check for loops
  const hasLoop = data.node_graph.edges.some((e: any) => {
    const fromIndex = nodeIds.indexOf(e.from)
    const toIndex = nodeIds.indexOf(e.to)
    return toIndex <= fromIndex
  })

  if (hasLoop) {
    console.log('⚠️  Graph contains loop-back edges')
  }
}

examineStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
