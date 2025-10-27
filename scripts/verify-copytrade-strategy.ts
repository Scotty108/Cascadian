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
    .select('strategy_id, strategy_name, node_graph, execution_mode, schedule_cron')
    .eq('strategy_name', 'Category Copy Trading')
    .single()

  if (error) {
    console.error('❌ Error:', error)
    return
  }

  console.log('✅ Strategy found in database!')
  console.log('\nStrategy Details:')
  console.log('- ID:', data.strategy_id)
  console.log('- Name:', data.strategy_name)
  console.log('- Execution Mode:', data.execution_mode)
  console.log('- Schedule:', data.schedule_cron)

  console.log('\nNode Graph Structure:')
  console.log('- Total Nodes:', data.node_graph.nodes.length)
  console.log('- Total Edges:', data.node_graph.edges.length)

  console.log('\nNodes (in order):')
  data.node_graph.nodes.forEach((node: any, index: number) => {
    console.log(`  ${index + 1}. ${node.type} (${node.id})`)
  })

  console.log('\nEdges (connections):')
  data.node_graph.edges.forEach((edge: any, index: number) => {
    const fromNode = data.node_graph.nodes.find((n: any) => n.id === edge.from)
    const toNode = data.node_graph.nodes.find((n: any) => n.id === edge.to)
    console.log(`  ${index + 1}. ${fromNode?.type} → ${toNode?.type}`)
  })

  // Verify it's a complete linear chain
  console.log('\n🔍 Verification:')

  const nodeIds = data.node_graph.nodes.map((n: any) => n.id)
  const edgeFromIds = data.node_graph.edges.map((e: any) => e.from)
  const edgeToIds = data.node_graph.edges.map((e: any) => e.to)

  // Find the first node (has no incoming edge)
  const firstNode = nodeIds.find((id: string) => !edgeToIds.includes(id))
  console.log('✅ First node (no incoming edges):', firstNode)

  // Find the last node (has no outgoing edge)
  const lastNode = nodeIds.find((id: string) => !edgeFromIds.includes(id))
  console.log('✅ Last node (no outgoing edges):', lastNode)

  // Check all nodes are connected
  const connectedNodes = new Set([...edgeFromIds, ...edgeToIds])
  const disconnectedNodes = nodeIds.filter((id: string) => !connectedNodes.has(id))

  if (disconnectedNodes.length > 0) {
    console.log('❌ Disconnected nodes found:', disconnectedNodes)
  } else {
    console.log('✅ All nodes are connected!')
  }

  // Verify linear chain (n nodes should have n-1 edges)
  if (data.node_graph.edges.length === data.node_graph.nodes.length - 1) {
    console.log('✅ Correct number of edges for linear chain')
  } else {
    console.log('❌ Edge count mismatch. Expected:', data.node_graph.nodes.length - 1, 'Got:', data.node_graph.edges.length)
  }

  console.log('\n📊 Complete Workflow:')
  let current = firstNode
  let step = 1
  const visited = new Set()

  while (current && !visited.has(current)) {
    visited.add(current)
    const node = data.node_graph.nodes.find((n: any) => n.id === current)
    console.log(`  ${step}. ${node.type} (${current})`)

    const nextEdge = data.node_graph.edges.find((e: any) => e.from === current)
    current = nextEdge?.to
    step++
  }

  if (visited.size === data.node_graph.nodes.length) {
    console.log('\n✅ All nodes are reachable in linear sequence!')
  } else {
    console.log('\n❌ Some nodes are unreachable:', data.node_graph.nodes.length - visited.size, 'nodes')
  }
}

verifyStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
