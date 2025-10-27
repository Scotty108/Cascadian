#!/usr/bin/env tsx
/**
 * AUDIT ALL PREDEFINED STRATEGIES
 *
 * Verifies that all hardcoded strategies have:
 * 1. Proper node types and sequences
 * 2. Complete trading workflows (no disconnected nodes)
 * 3. Correct field names in filters
 * 4. ACTION nodes for trade execution where needed
 * 5. CRON-based execution (SCHEDULED mode, not loops)
 * 6. Logical trading workflow (data → filter → size → execute)
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Known valid fields for wallet_scores_by_category (current)
const VALID_WALLET_FIELDS = [
  'wallet',
  'category',
  'omega_ratio',
  'omega_momentum',
  'total_positions',
  'closed_positions',
  'total_pnl',
  'win_rate',
  'roi_per_bet',
  'overall_roi',
  'grade',
  'meets_minimum_trades',
]

// Known valid fields for markets/positions
const VALID_MARKET_FIELDS = [
  'condition_id',
  'market_slug',
  'question',
  'description',
  'category',
  'active',
  'closed',
  'price',
  'volume',
  'liquidity',
  'volume_24h',
  'endDate',
  'startDate',
  'outcomeIndex',
  'outcome',
  'side',
  'amount',
  'shares',
]

// Future fields that will be available but don't exist yet
const FUTURE_FIELDS = [
  'bets_per_week',
  'deposit_driven_pnl',
  'omega_lag_30s',
  'omega_lag_2min',
  'tail_ratio',
  'ev_per_hour_capital',
  'ev_per_hour_category',
  'calibration_error',
  'clv_lag_0s',
  'clv_lag_2min',
  'max_drawdown',
  'time_in_drawdown_pct',
  'sortino_ratio',
  'calmar_ratio',
  'omega_momentum_30d',
  'clv_momentum_30d',
  'hot_hand_z_score',
  'roi_30d',
  'combined_momentum_z',
]

interface AuditResult {
  strategy_name: string
  strategy_id: string
  execution_mode: string
  issues: string[]
  warnings: string[]
  recommendations: string[]
  node_count: number
  edge_count: number
  is_valid: boolean
}

async function auditStrategy(strategy: any): Promise<AuditResult> {
  const result: AuditResult = {
    strategy_name: strategy.strategy_name,
    strategy_id: strategy.strategy_id,
    execution_mode: strategy.execution_mode,
    issues: [],
    warnings: [],
    recommendations: [],
    node_count: strategy.node_graph?.nodes?.length || 0,
    edge_count: strategy.node_graph?.edges?.length || 0,
    is_valid: true,
  }

  const nodes = strategy.node_graph?.nodes || []
  const edges = strategy.node_graph?.edges || []

  // Check 1: Verify node graph exists
  if (!strategy.node_graph) {
    result.issues.push('❌ No node_graph defined')
    result.is_valid = false
    return result
  }

  if (nodes.length === 0) {
    result.issues.push('❌ No nodes in workflow')
    result.is_valid = false
    return result
  }

  // Check 2: Verify execution mode for CRON strategies
  if (strategy.execution_mode === 'SCHEDULED' && !strategy.schedule_cron) {
    result.issues.push('❌ SCHEDULED mode but no schedule_cron defined')
    result.is_valid = false
  }

  // Check 3: Verify linear chain (n nodes should have n-1 edges for linear workflow)
  const expectedEdges = nodes.length - 1
  if (edges.length !== expectedEdges) {
    result.warnings.push(
      `⚠️  Edge count mismatch: Expected ${expectedEdges} for linear chain, got ${edges.length}`
    )
  }

  // Check 4: Find disconnected nodes
  const nodeIds = nodes.map((n: any) => n.id)
  const edgeFromIds = edges.map((e: any) => e.from)
  const edgeToIds = edges.map((e: any) => e.to)
  const connectedNodes = new Set([...edgeFromIds, ...edgeToIds])
  const disconnectedNodes = nodeIds.filter((id: string) => !connectedNodes.has(id))

  if (disconnectedNodes.length > 0) {
    result.issues.push(`❌ Disconnected nodes found: ${disconnectedNodes.join(', ')}`)
    result.is_valid = false
  }

  // Check 5: Verify first and last nodes
  const firstNode = nodeIds.find((id: string) => !edgeToIds.includes(id))
  const lastNode = nodeIds.find((id: string) => !edgeFromIds.includes(id))

  if (!firstNode) {
    result.issues.push('❌ No start node found (circular graph detected)')
    result.is_valid = false
  }

  if (!lastNode) {
    result.issues.push('❌ No end node found (circular graph detected)')
    result.is_valid = false
  }

  // Check 6: Verify first node is DATA_SOURCE
  const firstNodeObj = nodes.find((n: any) => n.id === firstNode)
  if (firstNodeObj && firstNodeObj.type !== 'DATA_SOURCE') {
    result.warnings.push(
      `⚠️  First node is ${firstNodeObj.type}, expected DATA_SOURCE`
    )
  }

  // Check 7: Check for ACTION nodes in strategies that need them
  const hasOrchestrator = nodes.some((n: any) => n.type === 'ORCHESTRATOR')
  const hasAction = nodes.some((n: any) => n.type === 'ACTION')

  if (hasOrchestrator && !hasAction) {
    result.recommendations.push(
      '💡 Has ORCHESTRATOR but no ACTION node - consider adding explicit trade execution'
    )
  }

  // Check 8: Validate filter field names
  nodes.forEach((node: any, index: number) => {
    if (node.type === 'ENHANCED_FILTER' && node.config?.conditions) {
      // Find which DATA_SOURCE feeds into this filter
      const incomingEdge = edges.find((e: any) => e.to === node.id)
      let upstreamNode = incomingEdge
        ? nodes.find((n: any) => n.id === incomingEdge.from)
        : null

      // If upstream is not a DATA_SOURCE, traverse back to find the source
      while (upstreamNode && upstreamNode.type !== 'DATA_SOURCE') {
        const prevEdge = edges.find((e: any) => e.to === upstreamNode.id)
        upstreamNode = prevEdge
          ? nodes.find((n: any) => n.id === prevEdge.from)
          : null
      }

      // Determine field set based on upstream DATA_SOURCE
      let validFields: string[] = []

      if (upstreamNode && upstreamNode.type === 'DATA_SOURCE') {
        const source = upstreamNode.config?.source

        if (source === 'WALLETS' || upstreamNode.config?.prefilters?.table?.includes('wallet')) {
          validFields = VALID_WALLET_FIELDS
        } else if (source === 'MARKETS' || source === 'WALLET_POSITIONS') {
          validFields = VALID_MARKET_FIELDS
        }
      }

      // Validate each condition field
      node.config.conditions.forEach((condition: any) => {
        const field = condition.field

        // Check if field exists in current schema
        if (validFields.length > 0 && !validFields.includes(field)) {
          // Check if it's a future field (warn but don't error)
          if (FUTURE_FIELDS.includes(field)) {
            result.warnings.push(
              `⚠️  Node ${index + 1} (${node.id}): Field '${field}' is not yet available (future metric)`
            )
          } else {
            // Unknown field - this is an error
            result.issues.push(
              `❌ Node ${index + 1} (${node.id}): Unknown field '${field}' in filter condition`
            )
            result.is_valid = false
          }
        }
      })
    }
  })

  // Check 9: Verify complete workflow sequence
  let current = firstNode
  let step = 1
  const visited = new Set()

  while (current && !visited.has(current)) {
    visited.add(current)
    const nextEdge = edges.find((e: any) => e.from === current)
    current = nextEdge?.to
    step++
  }

  if (visited.size !== nodes.length) {
    result.issues.push(
      `❌ Unreachable nodes: ${nodes.length - visited.size} nodes not in execution path`
    )
    result.is_valid = false
  }

  // Check 10: Verify no loop-back edges (CRON-based, not event-driven)
  edges.forEach((edge: any, index: number) => {
    const fromIndex = nodeIds.indexOf(edge.from)
    const toIndex = nodeIds.indexOf(edge.to)

    if (toIndex <= fromIndex) {
      result.warnings.push(
        `⚠️  Edge ${index + 1} loops back: ${edge.from} → ${edge.to}`
      )
      result.recommendations.push(
        '💡 Consider using CRON schedule instead of loop-back edges'
      )
    }
  })

  // Check 11: Orchestrator configuration
  const orchestratorNode = nodes.find((n: any) => n.type === 'ORCHESTRATOR')
  if (orchestratorNode) {
    const config = orchestratorNode.config

    if (!config) {
      result.issues.push('❌ ORCHESTRATOR node has no config')
      result.is_valid = false
    } else {
      if (!config.mode) {
        result.warnings.push('⚠️  ORCHESTRATOR missing mode (approval/autonomous)')
      }

      if (!config.position_sizing_rules) {
        result.issues.push('❌ ORCHESTRATOR missing position_sizing_rules')
        result.is_valid = false
      } else {
        // Check for required sizing rules
        const rules = config.position_sizing_rules
        if (!rules.fractional_kelly_lambda) {
          result.warnings.push('⚠️  Missing fractional_kelly_lambda in sizing rules')
        }
        if (!rules.max_per_position) {
          result.warnings.push('⚠️  Missing max_per_position in sizing rules')
        }
      }
    }
  }

  return result
}

async function auditAllStrategies() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  console.log('🔍 Auditing all predefined strategies...\n')

  const { data: strategies, error } = await supabase
    .from('strategy_definitions')
    .select('*')
    .eq('is_predefined', true)
    .order('strategy_name')

  if (error) {
    console.error('❌ Error fetching strategies:', error)
    return
  }

  if (!strategies || strategies.length === 0) {
    console.log('⚠️  No predefined strategies found')
    return
  }

  console.log(`Found ${strategies.length} predefined strategies\n`)
  console.log('='.repeat(80))

  const results: AuditResult[] = []

  for (const strategy of strategies) {
    const result = await auditStrategy(strategy)
    results.push(result)

    console.log(`\n📋 ${result.strategy_name}`)
    console.log(`   ID: ${result.strategy_id.substring(0, 8)}...`)
    console.log(`   Execution: ${result.execution_mode}`)
    console.log(`   Nodes: ${result.node_count} | Edges: ${result.edge_count}`)

    if (result.issues.length > 0) {
      console.log('\n   ISSUES:')
      result.issues.forEach((issue) => console.log(`   ${issue}`))
    }

    if (result.warnings.length > 0) {
      console.log('\n   WARNINGS:')
      result.warnings.forEach((warning) => console.log(`   ${warning}`))
    }

    if (result.recommendations.length > 0) {
      console.log('\n   RECOMMENDATIONS:')
      result.recommendations.forEach((rec) => console.log(`   ${rec}`))
    }

    if (result.is_valid && result.issues.length === 0 && result.warnings.length === 0) {
      console.log('\n   ✅ No issues found - strategy looks good!')
    }

    console.log('\n' + '='.repeat(80))
  }

  // Summary
  console.log('\n📊 AUDIT SUMMARY\n')
  console.log(`Total Strategies: ${results.length}`)
  console.log(`Valid: ${results.filter((r) => r.is_valid).length}`)
  console.log(`With Issues: ${results.filter((r) => r.issues.length > 0).length}`)
  console.log(`With Warnings: ${results.filter((r) => r.warnings.length > 0).length}`)

  const strategiesNeedingFixes = results.filter((r) => !r.is_valid)
  if (strategiesNeedingFixes.length > 0) {
    console.log('\n❌ Strategies needing fixes:')
    strategiesNeedingFixes.forEach((r) => {
      console.log(`   - ${r.strategy_name}`)
    })
  }

  return results
}

// Run the audit
auditAllStrategies()
  .then((results) => {
    const hasIssues = results?.some((r) => !r.is_valid)
    process.exit(hasIssues ? 1 : 0)
  })
  .catch((error) => {
    console.error('Error running audit:', error)
    process.exit(1)
  })
