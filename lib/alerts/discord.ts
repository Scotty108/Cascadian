/**
 * Discord Webhook Alert System
 *
 * Sends alerts to Discord when crons fail or other critical events occur.
 */

const DISCORD_WEBHOOK_URL = process.env.DISCORD_ALERT_WEBHOOK_URL

interface AlertPayload {
  cronName: string
  error: string
  details?: Record<string, any>
  severity?: 'error' | 'warning' | 'info'
}

export async function sendCronFailureAlert(payload: AlertPayload): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn('[discord-alert] DISCORD_ALERT_WEBHOOK_URL not configured, skipping alert')
    return
  }

  const { cronName, error, details, severity = 'error' } = payload

  const colorMap = {
    error: 0xff0000,    // Red
    warning: 0xffa500,  // Orange
    info: 0x0099ff      // Blue
  }

  const embed = {
    title: `Cron Failure: ${cronName}`,
    description: error,
    color: colorMap[severity],
    fields: details ? Object.entries(details).map(([name, value]) => ({
      name,
      value: typeof value === 'object' ? JSON.stringify(value, null, 2).slice(0, 1000) : String(value).slice(0, 1000),
      inline: false
    })) : [],
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Cascadian Alert System'
    }
  }

  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Cascadian Alerts',
        embeds: [embed]
      })
    })

    if (!response.ok) {
      console.error('[discord-alert] Failed to send alert:', response.status, await response.text())
    }
  } catch (err) {
    console.error('[discord-alert] Error sending alert:', err)
  }
}

export async function sendCronSuccessAlert(cronName: string, stats: Record<string, any>): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return

  // Only send success alerts for significant events (optional, can be disabled)
  const embed = {
    title: `Cron Success: ${cronName}`,
    color: 0x00ff00, // Green
    fields: Object.entries(stats).map(([name, value]) => ({
      name,
      value: String(value).slice(0, 1000),
      inline: true
    })),
    timestamp: new Date().toISOString(),
    footer: {
      text: 'Cascadian Alert System'
    }
  }

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Cascadian Alerts',
        embeds: [embed]
      })
    })
  } catch (err) {
    console.error('[discord-alert] Error sending success alert:', err)
  }
}
