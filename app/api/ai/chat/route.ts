/**
 * STREAMING AI CHAT API
 *
 * Streaming chat endpoint for the Cascadian Copilot.
 * Uses GPT-4-Turbo with streaming for real-time responses.
 */

import { NextRequest } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export const maxDuration = 30

interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  context?: {
    eventTitle?: string
    marketQuestion?: string
    category?: string
  }
}

export async function POST(req: NextRequest) {
  console.log('[Chat API] Request received')

  if (!process.env.OPENAI_API_KEY) {
    console.error('[Chat API] OPENAI_API_KEY is not set')
    return new Response(
      JSON.stringify({ error: 'AI service is not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { messages, context }: ChatRequest = await req.json()
    console.log('[Chat API] Messages:', messages.length, 'Context:', context?.eventTitle)

    // Build context-aware system prompt
    let systemPrompt = `You are the Cascadian AI Copilot, an expert assistant for prediction market analysis.

You help users understand:
- Market probabilities and what drives them
- Smart money signals and whale activity
- Historical patterns and correlations
- Risk assessment and position sizing
- Event outcomes and their implications

Be concise, data-driven, and helpful. Use specific numbers when discussing probabilities.
Format responses with markdown when helpful (bold for emphasis, bullet points for lists).`

    // Add event/market context if available
    if (context?.eventTitle) {
      systemPrompt += `\n\nCurrent context: The user is viewing an event titled "${context.eventTitle}"`
      if (context.category) {
        systemPrompt += ` in the ${context.category} category`
      }
      systemPrompt += '.'
    }
    if (context?.marketQuestion) {
      systemPrompt += `\n\nSpecifically looking at the market: "${context.marketQuestion}"`
    }

    // Create streaming response
    const stream = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-10).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
      temperature: 0.7,
      max_tokens: 500,
      stream: true,
    })

    // Create a readable stream that sends SSE events
    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              // Send as SSE data event
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`))
            }
          }
          // Send done signal with suggestions
          const suggestions = generateSuggestions(messages)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, suggestions })}\n\n`))
          controller.close()
        } catch (error) {
          console.error('[Chat API] Stream error:', error)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error: any) {
    console.error('Chat API error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

function generateSuggestions(messages: Array<{ role: string; content: string }>): string[] {
  const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || ''

  if (lastMessage.includes('price') || lastMessage.includes('probability')) {
    return ['What drives this probability?', 'Show smart money signals', 'Historical patterns']
  }

  if (lastMessage.includes('smart money') || lastMessage.includes('whale')) {
    return ['Who are the top traders?', 'Recent large positions', 'Flow analysis']
  }

  if (lastMessage.includes('risk') || lastMessage.includes('position')) {
    return ['Optimal position size', 'Correlated markets', 'Downside scenarios']
  }

  return ['Analyze this market', 'Smart money signals', 'What if this resolves YES?']
}
