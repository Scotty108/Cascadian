/**
 * Lightweight Ping Endpoint
 *
 * Use this for uptime monitoring (UptimeRobot, etc.)
 * Fast response - no database queries, no self-healing logic.
 *
 * For detailed system health, use /api/health instead.
 */

import { NextResponse } from 'next/server'

export const runtime = 'edge' // Edge runtime for fastest cold starts

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  })
}
