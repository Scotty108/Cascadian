/**
 * Tests for ClickHouse Mutation Management Utilities
 */

import * as mutations from '@/lib/clickhouse/mutations'
import { clickhouse } from '@/lib/clickhouse/client'

// Mock the ClickHouse client
jest.mock('@/lib/clickhouse/client', () => ({
  clickhouse: {
    query: jest.fn()
  }
}))

describe('ClickHouse Mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getMutationStatus', () => {
    test('should return parsed mutation status', async () => {
      const mockData = [{
        pending: '5',
        completed: '100',
        failed: '2',
        total: '107'
      }]

      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      } as any)

      const status = await mutations.getMutationStatus()

      expect(status).toEqual({
        pending: 5,
        completed: 100,
        failed: 2,
        total: 107
      })
    })

    test('should handle zero mutations', async () => {
      const mockData = [{
        pending: '0',
        completed: '0',
        failed: '0',
        total: '0'
      }]

      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      } as any)

      const status = await mutations.getMutationStatus()

      expect(status.pending).toBe(0)
      expect(status.total).toBe(0)
    })
  })

  describe('waitForNoPendingMutations', () => {
    test('should return immediately if no pending mutations', async () => {
      const mockData = [{
        pending: '0',
        completed: '100',
        failed: '0',
        total: '100'
      }]

      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      } as any)

      const status = await mutations.waitForNoPendingMutations({ verbose: false })

      expect(status.pending).toBe(0)
      expect(clickhouse.query).toHaveBeenCalledTimes(1)
    })

    test('should poll until mutations complete', async () => {
      const responses = [
        [{ pending: '10', completed: '90', failed: '0', total: '100' }],
        [{ pending: '5', completed: '95', failed: '0', total: '100' }],
        [{ pending: '0', completed: '100', failed: '0', total: '100' }]
      ]

      let callCount = 0
      ;(clickhouse.query as jest.Mock).mockImplementation(() => {
        const response = responses[callCount++]
        return Promise.resolve({
          json: jest.fn().mockResolvedValue(response)
        } as any)
      })

      const status = await mutations.waitForNoPendingMutations({
        pollIntervalMs: 10,
        verbose: false
      })

      expect(status.pending).toBe(0)
      expect(clickhouse.query).toHaveBeenCalledTimes(3)
    })

    test('should timeout if mutations never complete', async () => {
      const mockData = [{
        pending: '10',
        completed: '90',
        failed: '0',
        total: '100'
      }]

      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      } as any)

      await expect(
        mutations.waitForNoPendingMutations({
          pollIntervalMs: 10,
          timeoutMs: 100,
          verbose: false
        })
      ).rejects.toThrow(/Timeout waiting for mutations/)
    })

    test('should log progress when verbose is true', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

      const responses = [
        [{ pending: '5', completed: '95', failed: '0', total: '100' }],
        [{ pending: '0', completed: '100', failed: '0', total: '100' }]
      ]

      let callCount = 0
      ;(clickhouse.query as jest.Mock).mockImplementation(() => {
        const response = responses[callCount++]
        return Promise.resolve({
          json: jest.fn().mockResolvedValue(response)
        } as any)
      })

      await mutations.waitForNoPendingMutations({
        pollIntervalMs: 10,
        verbose: true
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for 5 mutations')
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('All mutations complete')
      )

      consoleSpy.mockRestore()
    })
  })

  describe('isSafeToMutate', () => {
    test('should return true when pending count below threshold', async () => {
      const mockData = [{
        pending: '100',
        completed: '1000',
        failed: '0',
        total: '1100'
      }]

      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      } as any)

      const safe = await mutations.isSafeToMutate(900)

      expect(safe).toBe(true)
    })

    test('should return false when pending count at or above threshold', async () => {
      const mockData = [{
        pending: '950',
        completed: '50',
        failed: '0',
        total: '1000'
      }]

      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      } as any)

      const safe = await mutations.isSafeToMutate(900)

      expect(safe).toBe(false)
    })

    test('should use default threshold of 900', async () => {
      const mockData = [{
        pending: '899',
        completed: '101',
        failed: '0',
        total: '1000'
      }]

      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      } as any)

      const safe = await mutations.isSafeToMutate()

      expect(safe).toBe(true)
    })
  })

  describe('waitUntilSafeToMutate', () => {
    test('should return immediately if already safe', async () => {
      const mockData = [{
        pending: '100',
        completed: '900',
        failed: '0',
        total: '1000'
      }]

      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      } as any)

      await mutations.waitUntilSafeToMutate({
        maxPending: 900,
        verbose: false
      })

      expect(clickhouse.query).toHaveBeenCalledTimes(1)
    })

    test('should poll until safe threshold reached', async () => {
      const responses = [
        [{ pending: '950', completed: '50', failed: '0', total: '1000' }],
        [{ pending: '920', completed: '80', failed: '0', total: '1000' }],
        [{ pending: '850', completed: '150', failed: '0', total: '1000' }]
      ]

      let callCount = 0
      ;(clickhouse.query as jest.Mock).mockImplementation(() => {
        const response = responses[callCount++]
        return Promise.resolve({
          json: jest.fn().mockResolvedValue(response)
        } as any)
      })

      await mutations.waitUntilSafeToMutate({
        maxPending: 900,
        pollIntervalMs: 10,
        verbose: false
      })

      expect(clickhouse.query).toHaveBeenCalledTimes(3)
    })
  })

  describe('getPendingMutationDetails', () => {
    test('should return array of pending mutation details', async () => {
      const mockData = [
        {
          database: 'default',
          table: 'trades_raw',
          mutation_id: 'mutation_1',
          command: 'ALTER TABLE trades_raw UPDATE market_id = ...',
          create_time: '2025-10-28 12:00:00',
          parts_to_do: 10,
          is_done: 0,
          latest_fail_reason: ''
        },
        {
          database: 'default',
          table: 'trades_enriched',
          mutation_id: 'mutation_2',
          command: 'ALTER TABLE trades_enriched UPDATE realized_pnl_usd = ...',
          create_time: '2025-10-28 12:05:00',
          parts_to_do: 5,
          is_done: 0,
          latest_fail_reason: ''
        }
      ]

      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockData)
      } as any)

      const details = await mutations.getPendingMutationDetails()

      expect(details).toHaveLength(2)
      expect(details[0].table).toBe('trades_raw')
      expect(details[1].table).toBe('trades_enriched')
    })

    test('should return empty array if no pending mutations', async () => {
      ;(clickhouse.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue([])
      } as any)

      const details = await mutations.getPendingMutationDetails()

      expect(details).toEqual([])
    })
  })
})
