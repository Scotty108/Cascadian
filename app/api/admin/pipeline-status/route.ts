/**
 * Pipeline Status API
 *
 * Returns real-time status of the data pipeline:
 * - ClickHouse table row counts
 * - Data quality metrics
 * - Last sync timestamps
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@clickhouse/client'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://your-clickhouse-host.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DB || 'polymarket',
  request_timeout: 30000,
})

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface TableStats {
  table: string
  rowCount: number
  lastUpdated: string | null
  status: 'healthy' | 'warning' | 'empty'
}

export async function GET(request: NextRequest) {
  try {
    // 1. Get ClickHouse table counts
    const clickhouseTables = [
      'trades_raw',
      'trades_enriched',
      'wallet_metrics_complete',
      'market_price_momentum',
    ]

    const tableStats: TableStats[] = []

    for (const table of clickhouseTables) {
      try {
        const countQuery = `SELECT count() as count FROM ${table}`
        const countResult = await clickhouse.query({ query: countQuery })
        const countData = await countResult.json()
        const rowCount = countData.data[0]?.count || 0

        // Try to get last updated timestamp
        let lastUpdated: string | null = null
        try {
          const timestampQuery = `SELECT max(created_at) as last_update FROM ${table}`
          const timestampResult = await clickhouse.query({ query: timestampQuery })
          const timestampData = await timestampResult.json()
          lastUpdated = timestampData.data[0]?.last_update || null
        } catch {
          // Ignore timestamp errors
        }

        const status = rowCount === 0 ? 'empty' : rowCount < 1000 ? 'warning' : 'healthy'

        tableStats.push({
          table,
          rowCount,
          lastUpdated,
          status,
        })
      } catch (error) {
        tableStats.push({
          table,
          rowCount: 0,
          lastUpdated: null,
          status: 'empty',
        })
      }
    }

    // 2. Get Supabase wallet stats
    const { data: walletStats } = await supabase
      .from('discovered_wallets')
      .select('needs_sync', { count: 'exact' })

    const totalWallets = walletStats?.length || 0
    const needsSync = walletStats?.filter(w => w.needs_sync).length || 0
    const synced = totalWallets - needsSync

    // 3. Calculate data quality metrics
    const tradesRaw = tableStats.find(t => t.table === 'trades_raw')?.rowCount || 0
    const tradesEnriched = tableStats.find(t => t.table === 'trades_enriched')?.rowCount || 0
    const walletMetrics = tableStats.find(t => t.table === 'wallet_metrics_complete')?.rowCount || 0

    const enrichmentRate = tradesRaw > 0 ? (tradesEnriched / tradesRaw) * 100 : 0
    const metricsRate = totalWallets > 0 ? (walletMetrics / totalWallets) * 100 : 0

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      clickhouse: {
        connected: true,
        tables: tableStats,
      },
      wallets: {
        total: totalWallets,
        synced,
        needsSync,
        syncRate: totalWallets > 0 ? (synced / totalWallets) * 100 : 0,
      },
      dataQuality: {
        tradesRaw,
        tradesEnriched,
        enrichmentRate: enrichmentRate.toFixed(1),
        walletsWithMetrics: walletMetrics,
        metricsRate: metricsRate.toFixed(1),
      },
      pipeline: {
        status: tradesRaw === 0 ? 'not_started' :
                tradesEnriched === 0 ? 'sync_complete' :
                walletMetrics === 0 ? 'enrichment_complete' :
                'complete',
        nextStep: tradesRaw === 0 ? 'Run bulk sync' :
                  tradesEnriched === 0 ? 'Run enrichment' :
                  walletMetrics === 0 ? 'Calculate metrics' :
                  'Pipeline complete',
      }
    })

  } catch (error) {
    console.error('Pipeline status error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        clickhouse: { connected: false, tables: [] }
      },
      { status: 500 }
    )
  }
}
