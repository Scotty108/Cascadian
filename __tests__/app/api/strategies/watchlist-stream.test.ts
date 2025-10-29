/**
 * Unit tests for watchlist streaming endpoint status
 *
 * Tests verify that the streaming endpoint returns HTTP 501 Not Implemented
 * with helpful error messages and alternative endpoint information.
 *
 * Task: Phase 1.3 - API Streaming Endpoint Documentation
 *
 * @jest-environment node
 */

import { GET } from '@/app/api/strategies/[id]/watchlist/stream/route'
import { NextRequest } from 'next/server'

describe('Watchlist Stream Endpoint', () => {
  describe('HTTP 501 Not Implemented Response', () => {
    test('should return HTTP 501 Not Implemented status', async () => {
      // Create mock request
      const url = 'http://localhost:3000/api/strategies/test-strategy-id/watchlist/stream'
      const request = new NextRequest(url)

      // Create mock params
      const params = Promise.resolve({ id: 'test-strategy-id' })

      // Call endpoint
      const response = await GET(request, { params })

      // Verify status code
      expect(response.status).toBe(501)
    })

    test('should include helpful error message in response', async () => {
      const url = 'http://localhost:3000/api/strategies/test-strategy-id/watchlist/stream'
      const request = new NextRequest(url)
      const params = Promise.resolve({ id: 'test-strategy-id' })

      const response = await GET(request, { params })
      const data = await response.json()

      // Verify response structure
      expect(data).toHaveProperty('success')
      expect(data.success).toBe(false)

      expect(data).toHaveProperty('error')
      expect(data.error).toBe('Not Implemented')

      expect(data).toHaveProperty('message')
      expect(data.message).toContain('Streaming endpoint not yet implemented')
    })

    test('should provide alternative polling endpoint path', async () => {
      const url = 'http://localhost:3000/api/strategies/test-strategy-id/watchlist/stream'
      const request = new NextRequest(url)
      const params = Promise.resolve({ id: 'test-strategy-id' })

      const response = await GET(request, { params })
      const data = await response.json()

      // Verify alternative endpoint is provided
      expect(data).toHaveProperty('alternative')
      expect(data.alternative).toContain('/api/strategies/[id]/watchlist')
      expect(data.alternative).toContain('polling')
    })

    test('should include strategy ID in alternative endpoint guidance', async () => {
      const testStrategyId = 'strategy-abc-123'
      const url = `http://localhost:3000/api/strategies/${testStrategyId}/watchlist/stream`
      const request = new NextRequest(url)
      const params = Promise.resolve({ id: testStrategyId })

      const response = await GET(request, { params })
      const data = await response.json()

      // Verify strategy ID is referenced
      expect(data).toHaveProperty('alternative')
      expect(typeof data.alternative).toBe('string')

      // The alternative should describe the endpoint pattern
      expect(data.alternative).toContain('GET /api/strategies/[id]/watchlist')
    })
  })
})
