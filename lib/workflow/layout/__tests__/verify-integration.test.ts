/**
 * Integration Verification Test
 *
 * Verifies that the Dagre layout integration can be imported and used
 * in a ReactFlow-like context
 */

import { calculateAutoLayout, calculateNodeDepth } from '../dagre-layout'

describe('Dagre Layout Integration Verification', () => {
  it('should integrate with ReactFlow node structure', () => {
    // Simulate ReactFlow nodes with typical structure
    const reactFlowNodes = [
      { id: 'data_source_1', type: 'DATA_SOURCE', width: 200, height: 100, position: { x: 0, y: 0 } },
      { id: 'filter_1', type: 'FILTER', width: 200, height: 100, position: { x: 0, y: 0 } },
      { id: 'action_1', type: 'ACTION', width: 200, height: 100, position: { x: 0, y: 0 } },
    ]

    const reactFlowEdges = [
      { id: 'e1', source: 'data_source_1', target: 'filter_1' },
      { id: 'e2', source: 'filter_1', target: 'action_1' },
    ]

    // Convert to layout format
    const layoutNodes = reactFlowNodes.map(node => ({
      id: node.id,
      width: node.width,
      height: node.height,
    }))

    const layoutEdges = reactFlowEdges.map(edge => ({
      source: edge.source,
      target: edge.target,
    }))

    // Calculate layout
    const positions = calculateAutoLayout(layoutNodes, layoutEdges, {
      direction: 'LR',
      rankSeparation: 150,
      nodeSeparation: 80,
    })

    // Verify all nodes got positions
    expect(positions['data_source_1']).toBeDefined()
    expect(positions['filter_1']).toBeDefined()
    expect(positions['action_1']).toBeDefined()

    // Verify left-to-right ordering
    expect(positions['filter_1'].x).toBeGreaterThan(positions['data_source_1'].x)
    expect(positions['action_1'].x).toBeGreaterThan(positions['filter_1'].x)
  })

  it('should calculate depths for strategy workflow', () => {
    const nodes = [
      { id: 'data_source', width: 200, height: 100 },
      { id: 'filter1', width: 200, height: 100 },
      { id: 'filter2', width: 200, height: 100 },
      { id: 'logic', width: 200, height: 100 },
      { id: 'signal', width: 200, height: 100 },
    ]

    const edges = [
      { source: 'data_source', target: 'filter1' },
      { source: 'data_source', target: 'filter2' },
      { source: 'filter1', target: 'logic' },
      { source: 'filter2', target: 'logic' },
      { source: 'logic', target: 'signal' },
    ]

    const depths = calculateNodeDepth(nodes, edges)

    // Verify depth hierarchy
    expect(depths['data_source']).toBe(0) // Source
    expect(depths['filter1']).toBe(1) // First level
    expect(depths['filter2']).toBe(1) // First level
    expect(depths['logic']).toBe(2) // Second level
    expect(depths['signal']).toBe(3) // Third level
  })

  it('should handle top-to-bottom layout', () => {
    const nodes = [
      { id: '1', width: 200, height: 100 },
      { id: '2', width: 200, height: 100 },
    ]

    const edges = [
      { source: '1', target: '2' },
    ]

    const positions = calculateAutoLayout(nodes, edges, {
      direction: 'TB',
    })

    // In TB layout, node 2 should be below node 1
    expect(positions['2'].y).toBeGreaterThan(positions['1'].y)
  })
})
