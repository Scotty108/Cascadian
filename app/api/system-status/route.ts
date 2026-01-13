/**
 * System Status Summary
 *
 * Sends a periodic Discord status update every 4 hours.
 * Always sends - healthy or not - so you know the system is alive.
 *
 * GET /api/system-status - Check and report system status to Discord
 */

import { NextResponse } from 'next/server'
import { clickhouse } from '@/lib/clickhouse/client'

export const runtime = 'nodejs'
export const maxDuration = 30

const DISCORD_WEBHOOK_URL = process.env.DISCORD_ALERT_WEBHOOK_URL

interface TableStatus {
  name: string
  minutesBehind: number
  status: 'healthy' | 'warning' | 'critical'
}

const THRESHOLDS: Record<string, { warn: number; crit: number }> = {
  trader_events_v3: { warn: 10, crit: 30 },
  canonical_fills_v4: { warn: 60, crit: 180 },
  ctf_split_merge_expanded: { warn: 60, crit: 180 },
  erc1155_transfers: { warn: 120, crit: 360 },
  market_metadata: { warn: 120, crit: 360 },
}

async function getTableFreshness(): Promise<TableStatus[]> {
  // Single efficient query for all tables
  const result = await clickhouse.query({
    query: `
      SELECT 'trader_events_v3' as tbl, abs(dateDiff('minute', max(trade_time), now())) as mins FROM pm_trader_events_v3
      UNION ALL SELECT 'canonical_fills_v4', abs(dateDiff('minute', max(event_time), now())) FROM pm_canonical_fills_v4
      UNION ALL SELECT 'ctf_split_merge_expanded', abs(dateDiff('minute', max(event_timestamp), now())) FROM pm_ctf_split_merge_expanded
      UNION ALL SELECT 'erc1155_transfers', abs(dateDiff('minute', max(block_timestamp), now())) FROM pm_erc1155_transfers WHERE is_deleted = 0
      UNION ALL SELECT 'market_metadata', abs(dateDiff('minute', fromUnixTimestamp64Milli(max(ingested_at)), now())) FROM pm_market_metadata
    `,
    format: 'JSONEachRow'
  })

  const rows = await result.json() as { tbl: string; mins: number }[]

  return rows.map(row => {
    const threshold = THRESHOLDS[row.tbl] || { warn: 60, crit: 180 }
    const mins = row.mins !== undefined && row.mins !== null ? Math.abs(Number(row.mins)) : 9999

    let status: 'healthy' | 'warning' | 'critical' = 'healthy'
    if (mins >= threshold.crit) status = 'critical'
    else if (mins >= threshold.warn) status = 'warning'

    return { name: row.tbl, minutesBehind: mins, status }
  })
}

async function sendStatusToDiscord(tables: TableStatus[], durationMs: number) {
  if (!DISCORD_WEBHOOK_URL) return

  const healthy = tables.filter(t => t.status === 'healthy').length
  const warning = tables.filter(t => t.status === 'warning').length
  const critical = tables.filter(t => t.status === 'critical').length

  const isAllHealthy = critical === 0 && warning === 0
  const color = critical > 0 ? 0xff0000 : warning > 0 ? 0xffa500 : 0x00ff00

  const statusEmoji = isAllHealthy ? '✅' : critical > 0 ? '🔴' : '🟡'
  const statusText = isAllHealthy ? 'All Systems Operational' :
                     critical > 0 ? `${critical} Critical Issues` :
                     `${warning} Warnings`

  const tableLines = tables.map(t => {
    const emoji = t.status === 'healthy' ? '✅' : t.status === 'warning' ? '🟡' : '🔴'
    const mins = t.minutesBehind >= 0 ? `${t.minutesBehind}m` : 'error'
    return `${emoji} ${t.name}: ${mins}`
  }).join('\n')

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Cascadian Status',
      embeds: [{
        title: `${statusEmoji} System Status: ${statusText}`,
        description: `**Tables:** ${healthy}/${tables.length} healthy\n\`\`\`\n${tableLines}\n\`\`\``,
        color,
        footer: { text: `Check took ${durationMs}ms • Next update in 4h` },
        timestamp: new Date().toISOString()
      }]
    })
  }).catch(console.error)
}

export async function GET() {
  const startTime = Date.now()

  try {
    const tables = await getTableFreshness()
    const durationMs = Date.now() - startTime

    await sendStatusToDiscord(tables, durationMs)

    const healthy = tables.filter(t => t.status === 'healthy').length
    const warning = tables.filter(t => t.status === 'warning').length
    const critical = tables.filter(t => t.status === 'critical').length

    return NextResponse.json({
      status: critical > 0 ? 'critical' : warning > 0 ? 'warning' : 'healthy',
      timestamp: new Date().toISOString(),
      durationMs,
      summary: { healthy, warning, critical, total: tables.length },
      tables,
      discordSent: !!DISCORD_WEBHOOK_URL
    })
  } catch (error: any) {
    return NextResponse.json({
      status: 'error',
      error: error.message,
      durationMs: Date.now() - startTime
    }, { status: 500 })
  }
}
