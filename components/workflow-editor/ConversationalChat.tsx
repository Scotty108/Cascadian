'use client'

/**
 * CONVERSATIONAL CHAT COMPONENT
 *
 * AI-powered chat interface for building workflows conversationally.
 *
 * Features:
 * - Message history display
 * - Suggestion chips for next actions
 * - Tool call visualization (shows what AI is doing)
 * - Loading states
 * - Auto-scroll to latest message
 * - Integration with conversational-build API
 * - Markdown rendering for formatted messages
 */

import { useState, useRef, useEffect } from 'react'
import type { Node, Edge } from '@xyflow/react'
import ReactMarkdown from 'react-markdown'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send, Loader2, Bot, User, Wrench, Sparkles, ChevronLeft } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  suggestions?: string[]
  toolCalls?: any[]
  timestamp?: number
}

interface ConversationalChatProps {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: (nodes: Node[]) => void
  onEdgesChange: (edges: Edge[]) => void
  onCollapse?: () => void
}

export function ConversationalChat({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onCollapse,
}: ConversationalChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Hi! I'll help you build a wallet screening and trading strategy. What would you like your strategy to do?",
      suggestions: [
        'Find high omega ratio wallets',
        'Screen profitable traders',
        'Build a complete strategy',
      ],
      timestamp: Date.now(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (message?: string) => {
    const userMessage = message || input
    if (!userMessage.trim() || isLoading) return

    // Add user message
    const newMessages = [...messages, { role: 'user' as const, content: userMessage, timestamp: Date.now() }]
    setMessages(newMessages)
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/ai/conversational-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          currentWorkflow: { nodes, edges },
        }),
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const data = await response.json()

      // Apply tool calls to workflow
      if (data.toolCalls && data.toolCalls.length > 0) {
        applyToolCalls(data.toolCalls)
      }

      // Add AI response
      setMessages([
        ...newMessages,
        {
          role: 'assistant',
          content: data.message,
          suggestions: data.suggestions,
          toolCalls: data.toolCalls,
          timestamp: Date.now(),
        },
      ])
    } catch (error) {
      console.error('Chat error:', error)
      setMessages([
        ...newMessages,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          timestamp: Date.now(),
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const applyToolCalls = (toolCalls: any[]) => {
    let updatedNodes = [...nodes]
    let updatedEdges = [...edges]

    console.log('[AI Copilot] Applying tool calls:', toolCalls)

    for (const toolCall of toolCalls) {
      const { function: fn } = toolCall
      const args = fn.arguments // Arguments are inside the function object!

      console.log(`[AI Copilot] Tool: ${fn.name}`, args)

      switch (fn.name) {
        // Add nodes
        case 'addDataSourceNode':
        case 'addFilterNode':
        case 'addLogicNode':
        case 'addAggregationNode':
        case 'addSignalNode':
        case 'addActionNode':
          const newNode = createNodeFromToolCall(fn.name, args, updatedNodes.length)
          updatedNodes = [...updatedNodes, newNode]
          console.log('[AI Copilot] Added node:', newNode.id)
          break

        // Connect nodes
        case 'connectNodes':
          const newEdge: Edge = {
            id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            source: args.sourceId,
            target: args.targetId,
            label: args.label,
          }
          updatedEdges = [...updatedEdges, newEdge]
          console.log('[AI Copilot] Connected:', args.sourceId, '→', args.targetId)
          break

        // Update node
        case 'updateNode':
          updatedNodes = updatedNodes.map((node) =>
            node.id === args.nodeId
              ? { ...node, data: { ...node.data, config: { ...(node.data.config || {}), ...args.updates } } }
              : node
          )
          console.log('[AI Copilot] Updated node:', args.nodeId)
          break

        // Delete node
        case 'deleteNode':
          updatedNodes = updatedNodes.filter((n) => n.id !== args.nodeId)
          updatedEdges = updatedEdges.filter((e) => e.source !== args.nodeId && e.target !== args.nodeId)
          console.log('[AI Copilot] Deleted node:', args.nodeId)
          break
      }
    }

    console.log(`[AI Copilot] Final: ${updatedNodes.length} nodes, ${updatedEdges.length} edges`)

    // Apply changes
    onNodesChange(updatedNodes)
    onEdgesChange(updatedEdges)
  }

  return (
    <Card className="w-80 lg:w-96 border-r border-border/60 bg-card flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 bg-gradient-to-br from-background via-background to-background/95 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00E0AA]/10 text-[#00E0AA] shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-foreground">AI Copilot</h2>
              <p className="text-xs text-muted-foreground">Build workflows with conversation</p>
            </div>
          </div>
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onCollapse}
              className="shrink-0 rounded-lg hover:bg-[#00E0AA]/10 hover:text-[#00E0AA]"
              aria-label="Collapse AI Copilot"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className="flex gap-3">
            {/* Avatar */}
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                msg.role === 'user'
                  ? 'bg-blue-500'
                  : 'bg-[#00E0AA]'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="h-4 w-4 text-white" />
              ) : (
                <Bot className="h-4 w-4 text-slate-950" />
              )}
            </div>

            {/* Message Content */}
            <div className="flex-1 space-y-2">
              {/* Message bubble */}
              <div
                className={`inline-block max-w-[85%] rounded-lg p-3 ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-md'
                    : 'bg-secondary text-foreground'
                }`}
              >
                <div className={`text-sm prose prose-sm ${msg.role === 'user' ? 'prose-invert' : 'dark:prose-invert'} max-w-none`}>
                  <ReactMarkdown
                    components={{
                      p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                      ul: ({ node, ...props }) => <ul className="mb-2 last:mb-0 ml-4 list-disc" {...props} />,
                      ol: ({ node, ...props }) => <ol className="mb-2 last:mb-0 ml-4 list-decimal" {...props} />,
                      li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                      code: ({ node, className, children, ...props }: any) => {
                        const inline = !className
                        const codeClasses = msg.role === 'user'
                          ? inline
                            ? 'bg-blue-400/30 px-1 py-0.5 rounded text-xs font-mono'
                            : 'block bg-blue-400/30 p-2 rounded text-xs font-mono overflow-x-auto'
                          : inline
                          ? 'bg-muted px-1 py-0.5 rounded text-xs font-mono'
                          : 'block bg-muted p-2 rounded text-xs font-mono overflow-x-auto'
                        return (
                          <code className={codeClasses} {...props}>
                            {children}
                          </code>
                        )
                      },
                      strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
                      em: ({ node, ...props }) => <em className="italic" {...props} />,
                      h1: ({ node, ...props }) => <h1 className="text-lg font-bold mb-2" {...props} />,
                      h2: ({ node, ...props }) => <h2 className="text-base font-bold mb-2" {...props} />,
                      h3: ({ node, ...props }) => <h3 className="text-sm font-bold mb-1" {...props} />,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Tool calls indicator */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Wrench className="h-3 w-3" />
                  <span>
                    {msg.toolCalls.length} action{msg.toolCalls.length > 1 ? 's' : ''} •{' '}
                    {msg.toolCalls.map((tc) => tc.function.name).join(', ')}
                  </span>
                </div>
              )}

              {/* Suggestions */}
              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {msg.suggestions.map((suggestion, j) => (
                    <button
                      key={j}
                      onClick={() => handleSend(suggestion)}
                      disabled={isLoading}
                      className="rounded-full border border-border/60 bg-background px-3 py-1 text-xs transition hover:border-[#00E0AA]/50 hover:bg-[#00E0AA]/5 disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#00E0AA]">
              <Bot className="h-4 w-4 text-slate-950" />
            </div>
            <div className="flex-1">
              <div className="inline-block rounded-lg bg-secondary p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">AI is thinking...</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border/40 bg-gradient-to-b from-background to-muted/20 p-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Type your message..."
              className="min-h-[44px] max-h-[120px] resize-none rounded-xl border-border/60 bg-background pr-4 text-sm shadow-sm transition-all focus:border-[#00E0AA]/50 focus:ring-2 focus:ring-[#00E0AA]/20"
              disabled={isLoading}
              rows={1}
              style={{
                height: 'auto',
                overflowY: input.split('\n').length > 3 ? 'auto' : 'hidden',
              }}
              onInput={(e: any) => {
                // Auto-resize based on content
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
              }}
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs text-muted-foreground pointer-events-none">
              <Sparkles className="h-3 w-3" />
            </div>
          </div>
          <Button
            onClick={() => handleSend()}
            disabled={isLoading || !input.trim()}
            size="icon"
            className="shrink-0 h-11 w-11 rounded-xl bg-gradient-to-br from-[#00E0AA] to-[#00C896] text-slate-950 shadow-lg shadow-[#00E0AA]/30 transition hover:shadow-[#00E0AA]/50 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground flex items-center gap-4">
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">Enter</kbd> to send
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">Shift</kbd>+
            <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">Enter</kbd> for new line
          </span>
        </p>
      </div>
    </Card>
  )
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Unique ID counter for guaranteed uniqueness
let nodeIdCounter = 0

function createNodeFromToolCall(toolName: string, args: any, nodeCount: number): Node {
  const nodeTypeMap: Record<string, string> = {
    addDataSourceNode: 'DATA_SOURCE',
    addFilterNode: 'FILTER',
    addLogicNode: 'LOGIC',
    addAggregationNode: 'AGGREGATION',
    addSignalNode: 'SIGNAL',
    addActionNode: 'ACTION',
  }

  const nodeType = nodeTypeMap[toolName] || 'FILTER'

  // ALWAYS generate unique ID - never trust AI-provided IDs
  const timestamp = Date.now()
  const uniqueId = `${nodeType}-${timestamp}-${++nodeIdCounter}`

  console.log(`[AI Copilot] Creating node with unique ID: ${uniqueId}`)

  // Auto-layout: stagger nodes
  const position = args?.position || {
    x: nodeCount * 300 + 100,
    y: 200 + (nodeCount % 2) * 100,
  }

  // Extract config (remove id, position, label)
  const { id: _id, position: _pos, label, ...config } = args || {}

  return {
    id: uniqueId,
    type: nodeType,
    position,
    data: {
      label: label || nodeType,
      config,
      nodeType, // For generic component
    },
  }
}
