/**
 * Layout Hints Parser
 *
 * Task Group 17: Auto-Layout on AI Workflow Creation
 *
 * Extracts and applies layout hints from AI Copilot responses to improve
 * automatic workflow layout. Supports importance ranking, node groupings,
 * and layout direction hints.
 */

export interface LayoutHints {
  importance_ranking?: Record<string, number>  // nodeId -> rank (0 = highest priority)
  groupings?: string[][]  // Groups of related node IDs
  direction?: 'LR' | 'TB'
}

/**
 * Extract balanced JSON from a string starting with '{'
 *
 * Handles nested objects by tracking brace depth
 *
 * @param str - String starting with '{'
 * @returns Valid JSON string or null
 */
function extractBalancedJSON(str: string): string | null {
  let depth = 0
  let inString = false
  let escapeNext = false
  let endIndex = -1

  for (let i = 0; i < str.length; i++) {
    const char = str[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) {
        endIndex = i
        break
      }
    }
  }

  if (endIndex !== -1) {
    return str.substring(0, endIndex + 1)
  }

  return null
}

/**
 * Parse layout hints from AI response text
 *
 * Attempts to extract JSON layout hints embedded in the AI response.
 * Looks for patterns like:
 * - "layout_hints: {...}"
 * - JSON blocks in markdown code blocks
 * - Standalone JSON objects containing "importance_ranking"
 *
 * @param aiResponse - The raw text response from AI Copilot
 * @returns Parsed layout hints object, or null if none found
 */
export function parseLayoutHints(aiResponse: string): LayoutHints | null {
  if (!aiResponse) {
    return null
  }

  try {
    // Try to find JSON objects containing layout hints
    // Pattern 1: Look for "layout_hints:" followed by JSON
    const layoutHintsMatch = aiResponse.match(/layout_hints:\s*(\{[\s\S]*?\})\s*(?:\n|$)/i)
    if (layoutHintsMatch) {
      const jsonStr = extractBalancedJSON(layoutHintsMatch[1])
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr)
        if (parsed.importance_ranking || parsed.groupings || parsed.direction) {
          return parsed
        }
      }
    }

    // Pattern 2: Look for JSON blocks in markdown code blocks
    const codeBlockMatch = aiResponse.match(/```json?\s*(\{[\s\S]*?\})\s*```/i)
    if (codeBlockMatch) {
      const parsed = JSON.parse(codeBlockMatch[1])
      if (parsed.importance_ranking || parsed.groupings || parsed.direction) {
        return parsed
      }
    }

    // Pattern 3: Look for standalone JSON objects with importance_ranking
    const jsonMatch = aiResponse.match(/\{[\s\S]*?"importance_ranking"[\s\S]*?\}/s)
    if (jsonMatch) {
      const jsonStr = extractBalancedJSON(jsonMatch[0])
      if (jsonStr) {
        return JSON.parse(jsonStr)
      }
    }
  } catch (e) {
    console.log('No valid layout hints found in AI response:', e)
  }

  return null
}

/**
 * Apply layout hints to generate node rankings
 *
 * Converts layout hints into Dagre-compatible node ranks. If no hints are
 * provided, calculates default depth-based ranking using BFS traversal.
 *
 * @param nodes - Array of nodes in the workflow
 * @param edges - Array of edges connecting nodes
 * @param hints - Parsed layout hints (optional)
 * @returns Record mapping node IDs to their rank (0 = highest priority)
 */
export function applyLayoutHints(
  nodes: any[],
  edges: any[],
  hints: LayoutHints | null
): Record<string, number> {
  // If hints provided with importance ranking, use it
  if (hints && hints.importance_ranking) {
    return hints.importance_ranking
  }

  // Otherwise, use default depth-based ranking
  return calculateDefaultRanks(nodes, edges)
}

/**
 * Calculate default node ranks based on graph depth
 *
 * Uses BFS to assign hierarchical ranks:
 * - Rank 0: Source nodes (no incoming edges)
 * - Rank 1: Nodes one step from sources
 * - Rank N: Nodes N steps from sources
 *
 * @param nodes - Array of nodes in the workflow
 * @param edges - Array of edges connecting nodes
 * @returns Record mapping node IDs to their depth-based rank
 */
function calculateDefaultRanks(
  nodes: any[],
  edges: any[]
): Record<string, number> {
  const depths: Record<string, number> = {}

  // Build map of incoming edges for each node
  const incomingEdges = new Map<string, string[]>()
  edges.forEach(edge => {
    if (!incomingEdges.has(edge.target)) {
      incomingEdges.set(edge.target, [])
    }
    incomingEdges.get(edge.target)!.push(edge.source)
  })

  // Find source nodes (no incoming edges) and assign depth 0
  const queue: Array<{ id: string; depth: number }> = []
  nodes.forEach(node => {
    if (!incomingEdges.has(node.id)) {
      depths[node.id] = 0
      queue.push({ id: node.id, depth: 0 })
    }
  })

  // BFS traversal to calculate depths
  const visited = new Set<string>()
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!

    // Skip if already visited (handles cycles)
    if (visited.has(id)) {
      continue
    }
    visited.add(id)

    // Process outgoing edges
    edges.forEach(edge => {
      if (edge.source === id && !depths.hasOwnProperty(edge.target)) {
        depths[edge.target] = depth + 1
        queue.push({ id: edge.target, depth: depth + 1 })
      }
    })
  }

  // Assign depth 0 to any disconnected nodes
  nodes.forEach(node => {
    if (!depths.hasOwnProperty(node.id)) {
      depths[node.id] = 0
    }
  })

  return depths
}
