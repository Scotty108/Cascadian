/**
 * Deployment Webhook Handler
 *
 * Receives Vercel deployment webhooks and forwards to Discord.
 * Configure in Vercel Dashboard > Settings > Webhooks
 *
 * Events handled:
 * - deployment.created
 * - deployment.succeeded
 * - deployment.failed
 * - deployment.error
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const DISCORD_WEBHOOK_URL = process.env.DISCORD_ALERT_WEBHOOK_URL

interface VercelDeploymentPayload {
  type: string
  payload: {
    deployment: {
      id: string
      name: string
      url: string
      meta?: {
        githubCommitMessage?: string
        githubCommitRef?: string
        githubCommitAuthorName?: string
      }
    }
    project: {
      name: string
    }
  }
}

export async function POST(request: NextRequest) {
  if (!DISCORD_WEBHOOK_URL) {
    return NextResponse.json({ error: 'Discord webhook not configured' }, { status: 500 })
  }

  try {
    const body = await request.json() as VercelDeploymentPayload
    const { type, payload } = body

    if (!type || !payload) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const deployment = payload.deployment
    const project = payload.project

    let title: string
    let color: number
    let emoji: string

    switch (type) {
      case 'deployment.created':
        title = 'Deployment Started'
        color = 0x0099ff // Blue
        emoji = '🚀'
        break
      case 'deployment.succeeded':
        title = 'Deployment Succeeded'
        color = 0x00ff00 // Green
        emoji = '✅'
        break
      case 'deployment.failed':
      case 'deployment.error':
        title = 'Deployment Failed'
        color = 0xff0000 // Red
        emoji = '❌'
        break
      default:
        // Ignore other events
        return NextResponse.json({ status: 'ignored', type })
    }

    const commitMessage = deployment.meta?.githubCommitMessage || 'No commit message'
    const commitAuthor = deployment.meta?.githubCommitAuthorName || 'Unknown'
    const branch = deployment.meta?.githubCommitRef || 'main'

    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Vercel Deployments',
        embeds: [{
          title: `${emoji} ${title}: ${project.name}`,
          color,
          fields: [
            { name: 'Commit', value: commitMessage.slice(0, 100), inline: false },
            { name: 'Author', value: commitAuthor, inline: true },
            { name: 'Branch', value: branch, inline: true },
            { name: 'URL', value: deployment.url ? `https://${deployment.url}` : 'N/A', inline: false }
          ],
          timestamp: new Date().toISOString(),
          footer: { text: `Deployment ID: ${deployment.id}` }
        }]
      })
    })

    return NextResponse.json({ status: 'sent', type })
  } catch (error: any) {
    console.error('[deployment-webhook] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
