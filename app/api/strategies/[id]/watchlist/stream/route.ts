/**
 * Watchlist Stream API
 *
 * GET /api/strategies/[id]/watchlist/stream
 * Returns the last ~50 watchlist events from JSONL audit log
 * This is the "live tape" of smart money flow we're following
 *
 * READ-ONLY: Only reads from local files, no writes to any infrastructure
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolve } from 'path'
import * as fs from 'fs'

export const runtime = 'nodejs'

interface MarketDim {
  condition_id: string
  market_id: string
  question: string
}

interface StreamEntry {
  timestamp: string
  wallet: string
  market_id: string
  condition_id: string | null
  strategy_id: string
  strategy_name: string
  canonical_category: string
  raw_tags: string[]
  triggering_wallet_coverage_pct: number
  triggering_wallet_rank: number
  triggering_wallet_address: string
  question: string | null
  added_at: string
  alerts: boolean
}

/**
 * Load markets dimension for question enrichment
 */
function loadMarketsDim(): Map<string, string> {
  const marketsPath = resolve(process.cwd(), 'data/markets_dim_seed.json')
  const questionMap = new Map<string, string>()

  if (fs.existsSync(marketsPath)) {
    const markets: MarketDim[] = JSON.parse(fs.readFileSync(marketsPath, 'utf-8'))
    for (const market of markets) {
      questionMap.set(market.market_id, market.question)
    }
  }

  return questionMap
}

/**
 * Parse JSONL log and return last N entries with alerts computed
 */
function parseWatchlistLog(limit: number = 50): StreamEntry[] {
  const logPath = resolve(process.cwd(), 'runtime/watchlist_events.log')

  // Return empty array if log doesn't exist (not an error condition)
  if (!fs.existsSync(logPath)) {
    return []
  }

  const logContent = fs.readFileSync(logPath, 'utf-8').trim()

  // Return empty array if log is empty
  if (!logContent) {
    return []
  }

  const lines = logContent.split('\n').filter(l => l)

  // Get last N lines
  const recentLines = lines.slice(-limit).reverse() // Newest first

  // Load market questions
  const questionMap = loadMarketsDim()

  const entries: StreamEntry[] = []
  const now = new Date()

  for (const line of recentLines) {
    try {
      const entry = JSON.parse(line)

      const addedAt = new Date(entry.timestamp)
      const hoursAgo = (now.getTime() - addedAt.getTime()) / (1000 * 60 * 60)

      // Compute alerts: within 12 hours AND rank <= 5 AND coverage >= 10%
      const rank = entry.triggering_wallet_rank || entry.pnl_rank || 999
      const coverage = entry.triggering_wallet_coverage_pct || entry.coverage_pct || 0
      const alerts = hoursAgo <= 12 && rank <= 5 && coverage >= 10

      entries.push({
        timestamp: entry.timestamp,
        wallet: entry.wallet,
        market_id: entry.market_id,
        condition_id: entry.condition_id || null,
        strategy_id: entry.strategy_id || '',
        strategy_name: entry.strategy_name || '',
        canonical_category: entry.canonical_category || 'Uncategorized',
        raw_tags: entry.raw_tags || [],
        triggering_wallet_coverage_pct: coverage,
        triggering_wallet_rank: rank,
        triggering_wallet_address: entry.wallet,
        question: questionMap.get(entry.market_id) || null,
        added_at: entry.timestamp,
        alerts
      })
    } catch (error) {
      console.warn('Failed to parse log line:', line.slice(0, 100))
    }
  }

  return entries
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '50'),
      100
    )

    // Parse log entries
    const stream = parseWatchlistLog(limit)

    // Filter by strategy_id if log contains it
    // (for now, return all since we're aggregating across strategies)
    const filteredStream = stream.filter(entry =>
      !entry.strategy_id || entry.strategy_id === id || true // Return all for demo
    )

    return NextResponse.json({
      success: true,
      data: filteredStream,
      metadata: {
        count: filteredStream.length,
        strategy_id: id,
        description: 'Live tape of smart money flow'
      }
    })
  } catch (error) {
    console.error('[Watchlist Stream] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch watchlist stream',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
