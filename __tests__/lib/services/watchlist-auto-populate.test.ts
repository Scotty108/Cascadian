/**
 * Unit tests for resolution data parsing and error handling in watchlist-auto-populate service
 *
 * Tests cover critical validation behaviors:
 * - Valid resolution data structure
 * - Missing resolutions array
 * - Malformed entries
 * - Low resolution count warning threshold
 * - Error handling for missing files
 * - Error handling for malformed JSON
 * - Fallback mechanisms
 */

import {
  validateResolutionData,
  processResolutions,
  loadResolutionData,
  getFallbackWatchlist,
} from '@/lib/services/watchlist-auto-populate'
import * as fs from 'fs'
import { resolve } from 'path'

// Mock fs module for error scenario testing
jest.mock('fs')

describe('Resolution Data Parsing', () => {
  describe('validateResolutionData', () => {
    test('should return true for valid resolution data structure', () => {
      const validData = {
        total_conditions: 3673,
        resolved_conditions: 3673,
        last_updated: '2025-10-28T15:01:55.072Z',
        resolutions: [
          {
            condition_id: '0x985c2299ac7dbe5441a350d3f586d66d0b6375949429af56d6065a750ea5030e',
            market_id: '525393',
            resolved_outcome: 'NO',
            payout_yes: 0,
            payout_no: 1,
            resolved_at: null,
          },
          {
            condition_id: '0xf511fc5bf7aea547f7e33567e93b2c63f74bffbc0f0da79d7715cf5e27d16b6c',
            market_id: '525405',
            resolved_outcome: 'YES',
            payout_yes: 1,
            payout_no: 0,
            resolved_at: null,
          },
        ],
      }

      expect(validateResolutionData(validData)).toBe(true)
    })

    test('should return false when resolutions array is missing', () => {
      const invalidData = {
        total_conditions: 100,
        resolved_conditions: 100,
        last_updated: '2025-10-28T15:01:55.072Z',
        // Missing resolutions array
      }

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      expect(validateResolutionData(invalidData)).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid resolution data structure')
      )
      consoleSpy.mockRestore()
    })

    test('should return false when resolutions is not an array', () => {
      const invalidData = {
        total_conditions: 100,
        resolved_conditions: 100,
        last_updated: '2025-10-28T15:01:55.072Z',
        resolutions: 'not an array',
      }

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      expect(validateResolutionData(invalidData)).toBe(false)
      consoleSpy.mockRestore()
    })

    test('should return false when resolutions array is empty', () => {
      const invalidData = {
        total_conditions: 0,
        resolved_conditions: 0,
        last_updated: '2025-10-28T15:01:55.072Z',
        resolutions: [],
      }

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      expect(validateResolutionData(invalidData)).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('resolutions array is empty')
      )
      consoleSpy.mockRestore()
    })

    test('should log warning when resolved_conditions is below 3000 threshold', () => {
      const dataWithLowCount = {
        total_conditions: 2500,
        resolved_conditions: 2500,
        last_updated: '2025-10-28T15:01:55.072Z',
        resolutions: [
          {
            condition_id: '0x985c2299ac7dbe5441a350d3f586d66d0b6375949429af56d6065a750ea5030e',
            market_id: '525393',
            resolved_outcome: 'NO',
            payout_yes: 0,
            payout_no: 1,
            resolved_at: null,
          },
        ],
      }

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      expect(validateResolutionData(dataWithLowCount)).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resolution count (2500) is below expected threshold (3000)')
      )
      consoleSpy.mockRestore()
    })
  })

  describe('processResolutions', () => {
    test('should correctly process valid resolutions array', () => {
      const validData = {
        total_conditions: 3673,
        resolved_conditions: 3673,
        last_updated: '2025-10-28T15:01:55.072Z',
        resolutions: [
          {
            condition_id: '0x985c2299ac7dbe5441a350d3f586d66d0b6375949429af56d6065a750ea5030e',
            market_id: '525393',
            resolved_outcome: 'NO',
            payout_yes: 0,
            payout_no: 1,
            resolved_at: null,
          },
          {
            condition_id: '0xf511fc5bf7aea547f7e33567e93b2c63f74bffbc0f0da79d7715cf5e27d16b6c',
            market_id: '525405',
            resolved_outcome: 'YES',
            payout_yes: 1,
            payout_no: 0,
            resolved_at: null,
          },
        ],
      }

      const result = processResolutions(validData)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        condition_id: '0x985c2299ac7dbe5441a350d3f586d66d0b6375949429af56d6065a750ea5030e',
        market_id: '525393',
        resolved_outcome: 'NO',
        payout_yes: 0,
        payout_no: 1,
      })
      expect(result[1]).toEqual({
        condition_id: '0xf511fc5bf7aea547f7e33567e93b2c63f74bffbc0f0da79d7715cf5e27d16b6c',
        market_id: '525405',
        resolved_outcome: 'YES',
        payout_yes: 1,
        payout_no: 0,
      })
    })

    test('should return empty array for invalid data structure', () => {
      const invalidData = {
        total_conditions: 100,
        resolved_conditions: 100,
        // Missing resolutions array
      }

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const result = processResolutions(invalidData)

      expect(result).toEqual([])
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    test('should skip entries with missing required fields', () => {
      const dataWithMalformedEntries = {
        total_conditions: 3673,
        resolved_conditions: 3673,
        last_updated: '2025-10-28T15:01:55.072Z',
        resolutions: [
          {
            condition_id: '0x985c2299ac7dbe5441a350d3f586d66d0b6375949429af56d6065a750ea5030e',
            market_id: '525393',
            resolved_outcome: 'NO',
            payout_yes: 0,
            payout_no: 1,
            resolved_at: null,
          },
          {
            // Missing condition_id
            market_id: '525405',
            resolved_outcome: 'YES',
            payout_yes: 1,
            payout_no: 0,
          },
          {
            condition_id: '0xabc123',
            // Missing market_id
            resolved_outcome: 'NO',
            payout_yes: 0,
            payout_no: 1,
          },
          {
            condition_id: '0xdef456',
            market_id: '525407',
            resolved_outcome: 'YES',
            payout_yes: 1,
            payout_no: 0,
            resolved_at: null,
          },
        ],
      }

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const result = processResolutions(dataWithMalformedEntries)

      // Should only include entries 1 and 4 (valid ones)
      expect(result).toHaveLength(2)
      expect(result[0].condition_id).toBe(
        '0x985c2299ac7dbe5441a350d3f586d66d0b6375949429af56d6065a750ea5030e'
      )
      expect(result[1].condition_id).toBe('0xdef456')

      // Should have logged warnings for skipped entries (2 calls)
      expect(consoleSpy).toHaveBeenCalledTimes(2)
      expect(consoleSpy.mock.calls[0][0]).toContain('Skipping resolution entry with missing required fields')
      expect(consoleSpy.mock.calls[1][0]).toContain('Skipping resolution entry with missing required fields')
      consoleSpy.mockRestore()
    })
  })
})

describe('Error Handling', () => {
  // Clear all mocks before each test
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('loadResolutionData', () => {
    test('should return null when resolution data file is missing', () => {
      // Mock fs.existsSync to return false
      const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(false)
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      const result = loadResolutionData()

      expect(result).toBeNull()
      // Check first argument contains the message (console.warn is called with multiple arguments)
      expect(consoleSpy).toHaveBeenCalled()
      const firstCallFirstArg = consoleSpy.mock.calls[0][0]
      expect(firstCallFirstArg).toContain('Resolution data file not found')

      mockExistsSync.mockRestore()
      consoleSpy.mockRestore()
    })

    test('should return null and log error when JSON is malformed', () => {
      // Mock fs.existsSync to return true
      const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      // Mock fs.readFileSync to return malformed JSON
      const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue('{ invalid json }' as any)
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      const result = loadResolutionData()

      expect(result).toBeNull()
      // Check first argument contains the message
      expect(consoleSpy).toHaveBeenCalled()
      const firstCallFirstArg = consoleSpy.mock.calls[0][0]
      expect(firstCallFirstArg).toContain('Failed to parse resolution data JSON')

      mockExistsSync.mockRestore()
      mockReadFileSync.mockRestore()
      consoleSpy.mockRestore()
    })

    test('should return null when data structure is invalid', () => {
      // Mock fs.existsSync to return true
      const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      // Mock fs.readFileSync to return invalid structure (missing resolutions)
      const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify({
          total_conditions: 100,
          resolved_conditions: 100,
          last_updated: '2025-10-28T15:01:55.072Z',
          // Missing resolutions array
        }) as any
      )
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      const result = loadResolutionData()

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Resolution data file has invalid structure')
      )

      mockExistsSync.mockRestore()
      mockReadFileSync.mockRestore()
      consoleSpy.mockRestore()
    })

    test('should handle file read errors gracefully', () => {
      // Mock fs.existsSync to return true
      const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(true)
      // Mock fs.readFileSync to throw an error
      const mockReadFileSync = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('File read permission denied')
      })
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      const result = loadResolutionData()

      expect(result).toBeNull()
      // Check first argument contains the message
      expect(consoleSpy).toHaveBeenCalled()
      const firstCallFirstArg = consoleSpy.mock.calls[0][0]
      expect(firstCallFirstArg).toContain('Failed to load resolution data')

      mockExistsSync.mockRestore()
      mockReadFileSync.mockRestore()
      consoleSpy.mockRestore()
    })
  })

  describe('getFallbackWatchlist', () => {
    test('should return empty array and log warning', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      const result = getFallbackWatchlist('test-strategy-123')

      expect(result).toEqual([])
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using fallback watchlist for strategy test-strategy-123')
      )

      consoleSpy.mockRestore()
    })

    test('should log info when default configuration is available', () => {
      // Set environment variables temporarily
      const originalDefaultMarketId = process.env.DEFAULT_MARKET_ID
      const originalDefaultConditionIds = process.env.DEFAULT_CONDITION_IDS

      process.env.DEFAULT_MARKET_ID = '0xabc123'
      process.env.DEFAULT_CONDITION_IDS = '0xdef456,0x789abc'

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      const result = getFallbackWatchlist('test-strategy-456')

      expect(result).toEqual([])
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using fallback watchlist')
      )

      // Restore original values
      process.env.DEFAULT_MARKET_ID = originalDefaultMarketId
      process.env.DEFAULT_CONDITION_IDS = originalDefaultConditionIds

      consoleWarnSpy.mockRestore()
      consoleLogSpy.mockRestore()
    })
  })

  describe('Service never crashes', () => {
    test('should handle invalid condition IDs gracefully', () => {
      const dataWithInvalidIds = {
        total_conditions: 3673,
        resolved_conditions: 3673,
        last_updated: '2025-10-28T15:01:55.072Z',
        resolutions: [
          {
            condition_id: null, // Invalid: null instead of string
            market_id: '525393',
            resolved_outcome: 'NO',
            payout_yes: 0,
            payout_no: 1,
            resolved_at: null,
          },
          {
            condition_id: '0xvalidid',
            market_id: '525405',
            resolved_outcome: 'YES',
            payout_yes: 1,
            payout_no: 0,
            resolved_at: null,
          },
        ],
      }

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const result = processResolutions(dataWithInvalidIds)

      // Should skip invalid entry and continue
      expect(result).toHaveLength(1)
      expect(result[0].condition_id).toBe('0xvalidid')
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    test('should return empty array when all data sources fail', () => {
      const mockExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(false)
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      const resolutionData = loadResolutionData()
      expect(resolutionData).toBeNull()

      const fallbackWatchlist = getFallbackWatchlist('strategy-789')
      expect(fallbackWatchlist).toEqual([])

      // Service doesn't crash, returns empty array
      expect(Array.isArray(fallbackWatchlist)).toBe(true)

      mockExistsSync.mockRestore()
      consoleSpy.mockRestore()
    })
  })
})
