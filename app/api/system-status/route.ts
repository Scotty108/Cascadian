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

async function getTableFreshness(): Promise<TableStatus[]> {
  const tables = [
    { name: 'pm_trader_events_v3', col: 'trade_time', warn: 10, crit: 30 },
    { name: 'pm_canonical_fills_v4', col: 'event_time', warn: 60, crit: 180 },
    { name: 'pm_ctf_split_merge_expanded', col: 'event_timestamp', warn: 60, crit: 180 },
    { name: 'pm_erc1155_transfers', col: 'block_timestamp', warn: 120, crit: 360, where: 'is_deleted = 0' },
    { name: 'pm_market_metadata', col: 'fromUnixTimestamp64Milli(ingested_at)', warn: 120, crit: 360 },
  ]

  const results: TableStatus[] = []

  for (const t of tables) {
    try {
      const where = t.where ? `WHERE ${t.where}` : ''
      const result = await clickhouse.query({
        query: `SELECT abs(dateDiff('minute', max(${t.col}), now())) as mins FROM ${t.name} ${where}`,
        format: 'JSONEachRow'
      })
      const mins = Number((await result.json() as any[])[0]?.mins || 9999)

      let status: 'healthy' | 'warning' | 'critical' = 'healthy'
      if (mins >= t.crit) status = 'critical'
      else if (mins >= t.warn) status = 'warning'

      results.push({ name: t.name.replace('pm_', ''), minutesBehind: mins, status })
    } catch {
      results.push({ name: t.name.replace('pm_', ''), minutesBehind: -1, status: 'critical' })
    }
  }

  return results
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
