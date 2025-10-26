/**
 * Dagre Layout Integration
 *
 * Task Group 16: Auto-layout functionality using Dagre graph layout algorithm
 *
 * Provides intelligent node positioning for workflow diagrams using the
 * Dagre directed graph layout library. Supports both left-to-right (LR)
 * and top-to-bottom (TB) layouts with customizable spacing.
 */

import * as dagre from '@dagrejs/dagre'

export interface LayoutOptions {
  direction?: 'LR' | 'TB'
  rankSeparation?: number
  nodeSeparation?: number
  edgeSeparation?: number
}

export interface NodePosition {
  x: number
  y: number
}

export interface LayoutNode {
  id: string
  width?: number
  height?: number
}

export interface LayoutEdge {
  source: string
  target: string
}

/**
 * Calculate optimal node positions using Dagre layout algorithm
 *
 * @param nodes - Array of nodes with id and optional dimensions
 * @param edges - Array of edges connecting nodes
 * @param options - Layout configuration options
 * @returns Record mapping node IDs to their calculated positions
 */
export function calculateAutoLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {}
): Record<string, NodePosition> {
  // Handle empty input
  if (nodes.length === 0) {
    return {}
  }

  // 1. Create Dagre graph
  const graph = new dagre.graphlib.Graph()

  // 2. Set graph options
  graph.setGraph({
    rankdir: options.direction || 'LR',
    ranksep: options.rankSeparation || 150,
    nodesep: options.nodeSeparation || 80,
    edgesep: options.edgeSeparation || 20,
  })

  // 3. Set default edge options
  graph.setDefaultEdgeLabel(() => ({}))

  // 4. Add nodes with dimensions
  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: node.width || 200,
      height: node.height || 100,
    })
  })

  // 5. Add edges
  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target)
  })

  // 6. Run layout algorithm
  dagre.layout(graph)

  // 7. Extract node positions
  // Dagre uses center positioning, ReactFlow uses top-left
  // So we need to adjust by subtracting half the width/height
  const positions: Record<string, NodePosition> = {}
  graph.nodes().forEach((nodeId) => {
    const node = graph.node(nodeId)
    positions[nodeId] = {
      x: node.x - node.width / 2,
      y: node.y - node.height / 2,
    }
  })

  return positions
}

/**
 * Calculate hierarchical depth for each node in the workflow
 *
 * Assigns depth based on position in the workflow graph:
 * - Depth 0: Source nodes (no incoming edges)
 * - Depth 1: Nodes connected to depth 0
 * - Depth N: Nodes connected to depth N-1
 *
 * Uses breadth-first search (BFS) to traverse the graph and assign depths.
 *
 * @param nodes - Array of nodes
 * @param edges - Array of edges connecting nodes
 * @returns Record mapping node IDs to their hierarchical depth
 */
export function calculateNodeDepth(
  nodes: LayoutNode[],
  edges: LayoutEdge[]
): Record<string, number> {
  const nodeIds = new Set(nodes.map((n) => n.id))
  const incomingEdges = new Map<string, string[]>()

  // Build incoming edges map
  edges.forEach((edge) => {
    if (!incomingEdges.has(edge.target)) {
      incomingEdges.set(edge.target, [])
    }
    incomingEdges.get(edge.target)!.push(edge.source)
  })

  // Calculate depth using BFS
  const depths: Record<string, number> = {}
  const queue: Array<{ id: string; depth: number }> = []

  // Find source nodes (no incoming edges)
  nodes.forEach((node) => {
    if (!incomingEdges.has(node.id)) {
      depths[node.id] = 0
      queue.push({ id: node.id, depth: 0 })
    }
  })

  // BFS to calculate depths
  const visited = new Set<string>()
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!

    // Skip if already visited (handles cycles)
    if (visited.has(id)) {
      continue
    }
    visited.add(id)

    // Find outgoing edges
    edges.forEach((edge) => {
      if (edge.source === id && !depths.hasOwnProperty(edge.target)) {
        depths[edge.target] = depth + 1
        queue.push({ id: edge.target, depth: depth + 1 })
      }
    })
  }

  // Assign depth 0 to any nodes that weren't reached (disconnected nodes)
  nodes.forEach((node) => {
    if (!depths.hasOwnProperty(node.id)) {
      depths[node.id] = 0
    }
  })

  return depths
}
