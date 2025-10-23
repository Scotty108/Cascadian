/**
 * LLM ANALYZER SERVICE
 *
 * Wrapper around AI SDK for LLM analysis nodes.
 * Provides a simple interface for analyzing data with custom prompts.
 *
 * MVP: Basic text generation only (no tools, no streaming)
 * Future: Add tool calling, streaming, caching
 */

import { generateText } from 'ai'
import { google } from '@ai-sdk/google'

export interface LLMAnalysisConfig {
  userPrompt: string
  systemPrompt?: string
  model?: string
  outputFormat?: 'text' | 'json' | 'boolean' | 'number'
  temperature?: number
  maxTokens?: number
}

export interface LLMAnalysisResult {
  result: any
  raw: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/**
 * Analyze data using LLM with custom prompt
 */
export async function analyzewithLLM(
  config: LLMAnalysisConfig,
  inputData: any
): Promise<LLMAnalysisResult> {
  const {
    userPrompt,
    systemPrompt,
    model = 'gemini-1.5-flash',
    outputFormat = 'text',
    temperature = 0.7,
  } = config

  // Replace template variables in prompt
  const processedPrompt = replaceTemplateVars(userPrompt, inputData)

  // Build messages
  const messages: any[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: processedPrompt })

  // Generate response
  const response = await generateText({
    model: google(model),
    messages,
    temperature,
  })

  // Parse output based on format
  const result = parseOutputFormat(response.text, outputFormat)

  return {
    result,
    raw: response.text,
    usage: (response as any).usage
      ? {
          promptTokens: (response as any).usage.promptTokens,
          completionTokens: (response as any).usage.completionTokens,
          totalTokens: (response as any).usage.totalTokens,
        }
      : undefined,
  }
}

/**
 * Replace template variables in prompt
 * Supports: ${field}, ${node.field}, ${input1.field}
 */
function replaceTemplateVars(prompt: string, data: any): string {
  let processed = prompt

  // Replace ${field} with data.field
  processed = processed.replace(/\$\{([^}]+)\}/g, (match, path) => {
    const value = getValueByPath(data, path)
    return value !== undefined ? JSON.stringify(value) : match
  })

  return processed
}

/**
 * Get value from nested object by path
 * Examples: "price", "market.volume", "input1.data.price"
 */
function getValueByPath(obj: any, path: string): any {
  const parts = path.split('.')
  let current = obj

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Parse LLM output based on expected format
 */
function parseOutputFormat(text: string, format: string): any {
  switch (format) {
    case 'json':
      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/)
        const jsonText = jsonMatch ? jsonMatch[1] : text
        return JSON.parse(jsonText.trim())
      } catch (error) {
        console.error('Failed to parse JSON output:', error)
        return { error: 'Invalid JSON', raw: text }
      }

    case 'boolean':
      const lowerText = text.toLowerCase().trim()
      return lowerText.includes('true') || lowerText.includes('yes') || lowerText === '1'

    case 'number':
      // Extract first number from text
      const numberMatch = text.match(/-?\d+\.?\d*/)
      return numberMatch ? parseFloat(numberMatch[0]) : NaN

    case 'text':
    default:
      return text.trim()
  }
}

/**
 * Batch analyze multiple items with the same prompt
 * Useful for analyzing multiple markets, etc.
 */
export async function batchAnalyze(
  config: LLMAnalysisConfig,
  items: any[],
  options?: {
    concurrency?: number
    onProgress?: (completed: number, total: number) => void
  }
): Promise<LLMAnalysisResult[]> {
  const concurrency = options?.concurrency || 5
  const results: LLMAnalysisResult[] = []
  let completed = 0

  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map((item) => analyzewithLLM(config, item))
    )
    results.push(...batchResults)
    completed += batch.length
    options?.onProgress?.(completed, items.length)
  }

  return results
}

/**
 * Get available models
 */
export function getAvailableModels(): string[] {
  return [
    'gemini-1.5-flash', // Fast, cheap (default)
    'gemini-1.5-pro', // Better quality
    'gemini-2.0-flash-exp', // Latest experimental
  ]
}

/**
 * Estimate token count (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4)
}
