/**
 * Layout Hints Tests
 *
 * Task Group 17.1: Test auto-layout triggered after AI creates workflow
 */

import { parseLayoutHints, applyLayoutHints } from '../layout-hints'

describe('Layout Hints', () => {
  describe('parseLayoutHints', () => {
    it('parses layout hints from AI response with layout_hints: prefix', () => {
      const aiResponse = `Here's your workflow!
      layout_hints: {"importance_ranking": {"node-1": 0, "node-2": 1}, "direction": "LR"}
      `

      const hints = parseLayoutHints(aiResponse)
      expect(hints).toBeTruthy()
      expect(hints?.importance_ranking).toEqual({ 'node-1': 0, 'node-2': 1 })
      expect(hints?.direction).toBe('LR')
    })

    it('parses layout hints from JSON code block', () => {
      const aiResponse = `I've created your workflow!

\`\`\`json
{
  "importance_ranking": {"source": 0, "filter": 1, "action": 2},
  "direction": "TB"
}
\`\`\`
      `

      const hints = parseLayoutHints(aiResponse)
      expect(hints).toBeTruthy()
      expect(hints?.importance_ranking).toEqual({ source: 0, filter: 1, action: 2 })
      expect(hints?.direction).toBe('TB')
    })

    it('returns null for responses without layout hints', () => {
      const aiResponse = 'I created a workflow for you!'
      const hints = parseLayoutHints(aiResponse)
      expect(hints).toBeNull()
    })

    it('returns null for empty or invalid responses', () => {
      expect(parseLayoutHints('')).toBeNull()
      expect(parseLayoutHints('Some text without JSON')).toBeNull()
      expect(parseLayoutHints('{"invalid": "no importance_ranking"}')).toBeNull()
    })
  })

  describe('applyLayoutHints', () => {
    it('uses importance ranking from hints when provided', () => {
      const nodes = [
        { id: 'node-1' },
        { id: 'node-2' },
        { id: 'node-3' },
      ]
      const edges = [
        { source: 'node-1', target: 'node-2' },
        { source: 'node-2', target: 'node-3' },
      ]
      const hints = {
        importance_ranking: { 'node-1': 0, 'node-2': 1, 'node-3': 2 },
      }

      const ranks = applyLayoutHints(nodes, edges, hints)
      expect(ranks).toEqual({ 'node-1': 0, 'node-2': 1, 'node-3': 2 })
    })

    it('applies default ranks when no hints provided', () => {
      const nodes = [
        { id: 'source' },
        { id: 'filter' },
        { id: 'action' },
      ]
      const edges = [
        { source: 'source', target: 'filter' },
        { source: 'filter', target: 'action' },
      ]

      const ranks = applyLayoutHints(nodes, edges, null)
      expect(ranks['source']).toBe(0)
      expect(ranks['filter']).toBe(1)
      expect(ranks['action']).toBe(2)
    })

    it('handles disconnected nodes in default ranking', () => {
      const nodes = [
        { id: 'source' },
        { id: 'disconnected' },
        { id: 'filter' },
      ]
      const edges = [
        { source: 'source', target: 'filter' },
      ]

      const ranks = applyLayoutHints(nodes, edges, null)
      expect(ranks['source']).toBe(0)
      expect(ranks['disconnected']).toBe(0)  // Disconnected nodes get rank 0
      expect(ranks['filter']).toBe(1)
    })

    it('handles multiple source nodes correctly', () => {
      const nodes = [
        { id: 'source1' },
        { id: 'source2' },
        { id: 'filter' },
        { id: 'action' },
      ]
      const edges = [
        { source: 'source1', target: 'filter' },
        { source: 'source2', target: 'filter' },
        { source: 'filter', target: 'action' },
      ]

      const ranks = applyLayoutHints(nodes, edges, null)
      expect(ranks['source1']).toBe(0)
      expect(ranks['source2']).toBe(0)
      expect(ranks['filter']).toBe(1)
      expect(ranks['action']).toBe(2)
    })
  })
})
