"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronRight, ChevronLeft, Send, Sparkles, Database, Globe, Zap, Loader2, Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";

// ============================================
// TOGGLE: Change to "rounded" to revert back
// ============================================
const CORNER_STYLE: "rounded" | "sharp" = "sharp";

interface DeepResearchCopilotProps {
  isOpen: boolean;
  onToggle: () => void;
  eventTitle?: string;
  marketQuestion?: string;
  category?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  suggestions?: string[];
}

// ============================================
// SAVED FOR LATER: Research Progress UI
// This animated research progress display can be re-enabled
// when we have actual function calling capabilities
// ============================================
/*
const researchSteps = [
  {
    id: 1,
    title: "Analyzing Fed Communications",
    status: "complete",
    result: "23 documents · 9/12 dovish",
  },
  {
    id: 2,
    title: "Querying On-Chain Data",
    status: "complete",
    result: "82% smart money YES · +$4.2M 7d",
  },
  {
    id: 3,
    title: "Cross-Market Analysis",
    status: "complete",
    result: "PM 87% · Kalshi 84% · CME 89%",
  },
  {
    id: 4,
    title: "Statistical Modeling",
    status: "complete",
    result: "Monte Carlo: 94.2% · Bayesian: 93.8%",
  },
  {
    id: 5,
    title: "Historical Pattern Analysis",
    status: "complete",
    result: "91% match to Dec 2018 · 8/8 cycles",
  },
  {
    id: 6,
    title: "Research Finished",
    status: "active",
    result: "",
  },
];

// Research Progress Card Component (for future use)
function ResearchProgressCard() {
  return (
    <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-4 mb-3 shadow-sm hover:shadow-md transition-shadow duration-200`}>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3">
        Research Progress
      </div>

      <div className="space-y-0">
        {researchSteps.map((step, index) => {
          const isActive = step.status === "active";
          const isLast = index === researchSteps.length - 1;

          return (
            <div key={step.id} className="flex gap-3 group">
              <div className="flex flex-col items-center">
                <div
                  className={`w-1.5 h-1.5 rounded-full mt-1.5 transition-all duration-200 group-hover:scale-150 ${
                    isActive ? "bg-zinc-400 dark:bg-zinc-600" : "bg-cyan-400"
                  }`}
                />
                {!isLast && (
                  <div className="w-px flex-1 bg-zinc-200 dark:bg-zinc-700 min-h-[24px]" />
                )}
              </div>

              <div className="flex-1 pb-3">
                <span className={`text-xs ${isActive ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-300"}`}>
                  {step.title}
                  {isActive && <span className="text-zinc-400 dark:text-zinc-600 ml-2">...</span>}
                </span>
                {step.result && (
                  <p className="text-[11px] text-zinc-500 mt-0.5 font-mono tabular-nums">
                    {step.result}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
*/

/**
 * Deep Research Copilot - Working AI Chat
 */
export function DeepResearchCopilot({ isOpen, onToggle, eventTitle, marketQuestion, category }: DeepResearchCopilotProps) {
  // Generate contextual initial message
  const getInitialMessage = (): Message => {
    if (eventTitle) {
      // If we have event context, show a smart summary
      return {
        role: "assistant",
        content: `**SUMMARY**\nOur models project a **94% probability** of a December rate cut, vs 87% market pricing—a **7-point edge**.\n\n**Key factors:** 9/12 FOMC dovish, Core PCE at 2.3%, smart money 82% YES. Historical pattern match to Dec 2018 at 91%.\n\nI can dive deeper into any aspect of this analysis. What would you like to explore?`,
        timestamp: Date.now(),
        suggestions: ["Smart money breakdown", "Risk factors", "If YES resolves..."],
      };
    }
    // Default generic welcome
    return {
      role: "assistant",
      content: "Hi! I'm the Cascadian AI Copilot. I can help you analyze prediction markets, understand smart money signals, and explore event correlations. What would you like to know?",
      timestamp: Date.now(),
      suggestions: ["Analyze this event", "Smart money signals", "What drives probabilities?"],
    };
  };

  const [messages, setMessages] = useState<Message[]>([getInitialMessage()]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (message?: string) => {
    const userMessage = message || input;
    if (!userMessage.trim() || isLoading) return;

    // Add user message
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: userMessage, timestamp: Date.now() },
    ];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    // Track assistant message timestamp for consistency
    const assistantTimestamp = Date.now();
    let hasAddedAssistantMessage = false;

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          context: { eventTitle, marketQuestion, category },
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      // Handle SSE streaming
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";
      let suggestions: string[] | undefined;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  accumulatedContent += data.content;
                  // Hide "Thinking..." once content starts streaming
                  if (!hasAddedAssistantMessage) {
                    setIsLoading(false);
                  }
                  hasAddedAssistantMessage = true;
                  // Only add/update assistant message when we have content
                  setMessages([
                    ...newMessages,
                    { role: "assistant", content: accumulatedContent, timestamp: assistantTimestamp },
                  ]);
                }
                if (data.done && data.suggestions) {
                  suggestions = data.suggestions;
                }
                if (data.error) {
                  throw new Error(data.error);
                }
              } catch (parseError) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }

      // Final update with suggestions
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: accumulatedContent || "Sorry, I couldn't generate a response.",
          timestamp: assistantTimestamp,
          suggestions,
        },
      ]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="w-10 bg-zinc-50 dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
      >
        <ChevronLeft className="h-4 w-4 text-zinc-500" />
      </button>
    );
  }

  return (
    <div className="w-[400px] bg-zinc-50 dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-200">Cascadian Copilot</span>
        </div>
        <button
          onClick={onToggle}
          className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-all duration-150 p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role === "assistant" && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500 text-white">
                <Bot className="h-4 w-4" />
              </div>
            )}

            <div className={`flex flex-col ${msg.role === "user" ? "items-end" : ""} max-w-[85%]`}>
              {/* Message bubble */}
              <div
                className={`inline-block rounded-lg px-3 py-2 ${
                  msg.role === "user"
                    ? "bg-cyan-500 text-white"
                    : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                }`}
              >
                <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="mb-2 last:mb-0 ml-4 list-disc">{children}</ul>,
                      li: ({ children }) => <li className="mb-1">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>

              {/* Timestamp */}
              <span className="text-[10px] text-zinc-400 mt-1">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>

              {/* Suggestions */}
              {msg.suggestions && msg.suggestions.length > 0 && msg.role === "assistant" && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {msg.suggestions.map((suggestion, j) => (
                    <button
                      key={j}
                      onClick={() => handleSend(suggestion)}
                      disabled={isLoading}
                      className="rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1 text-xs text-zinc-600 dark:text-zinc-400 transition hover:border-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-900/20 disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {msg.role === "user" && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500 text-white">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="inline-block rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-500" />
                  <span className="text-sm text-zinc-500">Thinking...</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Widget Bar */}
      <div className="px-3 py-2 flex items-center gap-1.5 border-t border-zinc-200 dark:border-zinc-800">
        <span className="text-[9px] text-zinc-400 mr-2">Using:</span>
        <button className="flex items-center gap-1 px-2 py-1 text-[10px] bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 rounded transition-all duration-150 focus:outline-none">
          <Sparkles className="w-3 h-3" />
          <span>Cascadian AI</span>
        </button>
        <button className="flex items-center gap-1 px-2 py-1 text-[10px] bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400 transition-all duration-150 focus:outline-none opacity-50 cursor-not-allowed">
          <Database className="w-3 h-3" />
          <span>On-Chain</span>
        </button>
        <button className="flex items-center gap-1 px-2 py-1 text-[10px] bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400 transition-all duration-150 focus:outline-none opacity-50 cursor-not-allowed">
          <Globe className="w-3 h-3" />
          <span>Web</span>
        </button>
      </div>

      {/* Input Area */}
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
        <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} transition-all duration-150 focus-within:border-cyan-500/50 focus-within:ring-2 focus-within:ring-cyan-500/10`}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask a question..."
            rows={2}
            disabled={isLoading}
            className="w-full px-4 py-3 bg-transparent text-sm text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none resize-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-zinc-400">
                <Zap className="w-3 h-3 inline mr-1" />
                AI-powered analysis
              </span>
            </div>
            <button
              onClick={() => handleSend()}
              disabled={isLoading || !input.trim()}
              className={`p-2 ${isLoading || !input.trim() ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-400" : "bg-cyan-500 text-white hover:bg-cyan-600"} ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed`}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
