/**
 * Dagre Layout Tests
 *
 * Task Group 16: Dagre Layout Integration
 * Tests for auto-layout functionality using Dagre graph layout algorithm
 */

import { calculateAutoLayout, calculateNodeDepth } from '../dagre-layout'
import type { LayoutOptions } from '../dagre-layout'

describe('Dagre Layout Integration', () => {
  // Sample test nodes for layout calculation
  const simpleNodes = [
    { id: '1', width: 200, height: 100 },
    { id: '2', width: 200, height: 100 },
    { id: '3', width: 200, height: 100 },
  ]

  const simpleEdges = [
    { source: '1', target: '2' },
    { source: '2', target: '3' },
  ]

  describe('Layout Calculation', () => {
    it('should calculate positions for all nodes in a linear workflow', () => {
      const positions = calculateAutoLayout(simpleNodes, simpleEdges)

      // All nodes should have positions
      expect(positions['1']).toBeDefined()
      expect(positions['2']).toBeDefined()
      expect(positions['3']).toBeDefined()

      // Positions should have x and y coordinates
      expect(positions['1']).toHaveProperty('x')
      expect(positions['1']).toHaveProperty('y')
      expect(typeof positions['1'].x).toBe('number')
      expect(typeof positions['1'].y).toBe('number')
    })

    it('should position nodes left-to-right with LR layout', () => {
      const options: LayoutOptions = { direction: 'LR' }
      const positions = calculateAutoLayout(simpleNodes, simpleEdges, options)

      // In LR layout, node 2 should be to the right of node 1
      // and node 3 should be to the right of node 2
      expect(positions['2'].x).toBeGreaterThan(positions['1'].x)
      expect(positions['3'].x).toBeGreaterThan(positions['2'].x)
    })

    it('should position nodes top-to-bottom with TB layout', () => {
      const options: LayoutOptions = { direction: 'TB' }
      const positions = calculateAutoLayout(simpleNodes, simpleEdges, options)

      // In TB layout, node 2 should be below node 1
      // and node 3 should be below node 2
      expect(positions['2'].y).toBeGreaterThan(positions['1'].y)
      expect(positions['3'].y).toBeGreaterThan(positions['2'].y)
    })
  })

  describe('Node Positioning', () => {
    it('should respect custom node dimensions when calculating layout', () => {
      const customNodes = [
        { id: '1', width: 300, height: 150 },
        { id: '2', width: 200, height: 100 },
      ]
      const customEdges = [{ source: '1', target: '2' }]

      const positions = calculateAutoLayout(customNodes, customEdges)

      // Should return valid positions for both nodes
      expect(positions['1']).toBeDefined()
      expect(positions['2']).toBeDefined()

      // Positions should account for node sizes (no overlap)
      // With default separation, nodes should be separated appropriately
      const distance = Math.abs(positions['2'].x - positions['1'].x)
      expect(distance).toBeGreaterThan(0)
    })
  })

  describe('Node Depth Calculation', () => {
    it('should correctly assign depth 0 to source nodes', () => {
      const depths = calculateNodeDepth(simpleNodes, simpleEdges)

      // Node 1 has no incoming edges, so it should be depth 0
      expect(depths['1']).toBe(0)
    })

    it('should calculate hierarchical depths for connected nodes', () => {
      const depths = calculateNodeDepth(simpleNodes, simpleEdges)

      // Node 1 -> Node 2 -> Node 3
      expect(depths['1']).toBe(0) // Source node
      expect(depths['2']).toBe(1) // Connected to depth 0
      expect(depths['3']).toBe(2) // Connected to depth 1
    })

    it('should handle multiple source nodes correctly', () => {
      const nodes = [
        { id: '1', width: 200, height: 100 },
        { id: '2', width: 200, height: 100 },
        { id: '3', width: 200, height: 100 },
        { id: '4', width: 200, height: 100 },
      ]
      const edges = [
        { source: '1', target: '3' },
        { source: '2', target: '3' },
        { source: '3', target: '4' },
      ]

      const depths = calculateNodeDepth(nodes, edges)

      // Nodes 1 and 2 are source nodes
      expect(depths['1']).toBe(0)
      expect(depths['2']).toBe(0)
      // Node 3 is connected to depth 0 nodes
      expect(depths['3']).toBe(1)
      // Node 4 is connected to depth 1 node
      expect(depths['4']).toBe(2)
    })
  })

  describe('Edge Routing', () => {
    it('should maintain edge relationships after layout', () => {
      const positions = calculateAutoLayout(simpleNodes, simpleEdges)

      // All nodes in edges should have positions
      simpleEdges.forEach(edge => {
        expect(positions[edge.source]).toBeDefined()
        expect(positions[edge.target]).toBeDefined()
      })
    })
  })

  describe('Custom Layout Options', () => {
    it('should apply custom rank separation', () => {
      const options: LayoutOptions = {
        direction: 'LR',
        rankSeparation: 300,
      }
      const positions = calculateAutoLayout(simpleNodes, simpleEdges, options)

      // With larger rank separation, nodes should be further apart
      const distance = positions['2'].x - positions['1'].x
      expect(distance).toBeGreaterThan(200) // Default would be ~150
    })

    it('should handle empty nodes array gracefully', () => {
      const positions = calculateAutoLayout([], [])
      expect(positions).toEqual({})
    })
  })
})
