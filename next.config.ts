import type { NextConfig } from 'next'

const config: NextConfig = {
  // Disable Vercel toolbar/speed insights
  experimental: {
    webVitalsAttribution: [],
  },
  // Disable Vercel analytics and toolbar injection
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || 'development',
  },
}

export default config
