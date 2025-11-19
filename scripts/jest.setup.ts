/**
 * JEST SETUP FILE
 *
 * This file runs before each test file.
 * Use it to configure testing libraries and global test utilities.
 */

import '@testing-library/jest-dom'

// Mock environment variables for testing
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-key'
process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret'
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'test-admin-key'

// Only mock browser APIs if we're in a jsdom environment (window is defined)
if (typeof window !== 'undefined') {
  // Mock window.matchMedia for Radix UI components
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(), // deprecated
      removeListener: jest.fn(), // deprecated
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  })
}

// Mock IntersectionObserver (works in both node and jsdom)
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return []
  }
  unobserve() {}
} as any

// Mock ResizeObserver (works in both node and jsdom)
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any

// Mock TransformStream for AI SDK (works in both node and jsdom)
global.TransformStream = class TransformStream {
  readable: any
  writable: any
  constructor() {
    this.readable = {}
    this.writable = {}
  }
} as any
