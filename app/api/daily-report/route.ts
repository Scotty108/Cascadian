/**
 * Daily System Report
 *
 * Sends a daily summary to Discord with:
 * - Trading volume (24h)
 * - Active wallets
 * - Data coverage stats
 * - Table row counts
 *
 * Runs once daily at 8 AM UTC
 */

import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const maxDuration = 60

const DISCORD_WEBHOOK_URL = process.env.DISCORD_ALERT_WEBHOOK_URL

interface DailyStats {
  tradingVolume24h: number
  tradeCount24h: number
  activeWallets24h: number
  marketsTraded24h: number
  dataFreshness: Record<string, string>
  tableRows: Record<string, number>
}

async function gatherStats(): Promise<DailyStats> {
  // 24h trading activity
  const tradingResult = await clickhouse.query({
    query: `
      SELECT
        round(sum(usdc_amount) / 1000000, 2) as volume,
        count() as trades,
        uniqExact(trader_wallet) as wallets,
        uniqExact(token_id) as tokens
      FROM pm_trader_events_v3
      WHERE trade_time >= now() - INTERVAL 24 HOUR
    `,
    format: 'JSONEachRow'
  })
  const trading = (await tradingResult.json() as any[])[0]

  // Data freshness
  const freshnessResult = await clickhouse.query({
    query: `
      SELECT 'pm_trader_events_v3' as tbl, max(trade_time) as latest FROM pm_trader_events_v3
      UNION ALL
      SELECT 'pm_canonical_fills_v4', max(event_time) FROM pm_canonical_fills_v4
      UNION ALL
      SELECT 'pm_erc1155_transfers', max(block_timestamp) FROM pm_erc1155_transfers WHERE is_deleted = 0
      UNION ALL
      SELECT 'pm_ctf_split_merge_expanded', max(event_timestamp) FROM pm_ctf_split_merge_expanded
    `,
    format: 'JSONEachRow'
  })
  const freshness = await freshnessResult.json() as any[]

  // Row counts
  const rowsResult = await clickhouse.query({
    query: `
      SELECT 'pm_trader_events_v3' as tbl, count() as cnt FROM pm_trader_events_v3
      UNION ALL
      SELECT 'pm_canonical_fills_v4', count() FROM pm_canonical_fills_v4
      UNION ALL
      SELECT 'pm_token_to_condition_map_v5', count() FROM pm_token_to_condition_map_v5
      UNION ALL
      SELECT 'pm_condition_resolutions', count() FROM pm_condition_resolutions
    `,
    format: 'JSONEachRow'
  })
  const rows = await rowsResult.json() as any[]

  return {
    tradingVolume24h: Number(trading.volume) || 0,
    tradeCount24h: Number(trading.trades) || 0,
    activeWallets24h: Number(trading.wallets) || 0,
    marketsTraded24h: Number(trading.tokens) || 0,
    dataFreshness: Object.fromEntries(freshness.map((r: any) => [r.tbl, r.latest])),
    tableRows: Object.fromEntries(rows.map((r: any) => [r.tbl, Number(r.cnt)]))
  }
}

async function sendDailyReport(stats: DailyStats) {
  if (!DISCORD_WEBHOOK_URL) return

  const formatNumber = (n: number) => n.toLocaleString()

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Cascadian Daily Report',
      embeds: [{
        title: '📊 Daily System Report',
        color: 0x0099ff,
        fields: [
          {
            name: '💰 24h Trading Volume',
            value: `$${formatNumber(stats.tradingVolume24h)} USDC`,
            inline: true
          },
          {
            name: '📈 Trade Count',
            value: formatNumber(stats.tradeCount24h),
            inline: true
          },
          {
            name: '👥 Active Wallets',
            value: formatNumber(stats.activeWallets24h),
            inline: true
          },
          {
            name: '🎯 Markets Traded',
            value: formatNumber(stats.marketsTraded24h),
            inline: true
          },
          {
            name: '📦 Total Trades (all-time)',
            value: formatNumber(stats.tableRows['pm_trader_events_v3'] || 0),
            inline: true
          },
          {
            name: '🗺️ Token Mappings',
            value: formatNumber(stats.tableRows['pm_token_to_condition_map_v5'] || 0),
            inline: true
          },
          {
            name: '⏰ Data Freshness',
            value: Object.entries(stats.dataFreshness)
              .map(([k, v]) => `${k.replace('pm_', '').slice(0, 20)}: ${v}`)
              .join('\n'),
            inline: false
          }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Cascadian System' }
      }]
    })
  })
}

export async function GET() {
  const startTime = Date.now()

  try {
    const stats = await gatherStats()
    await sendDailyReport(stats)

    return NextResponse.json({
      success: true,
      stats,
      durationMs: Date.now() - startTime
    })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
      durationMs: Date.now() - startTime
    }, { status: 500 })
  }
}
