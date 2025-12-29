"use client";

import { useState, useEffect } from "react";
import { ChevronRight, ChevronLeft, Send } from "lucide-react";

interface DeepResearchPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

// Research steps
const researchSteps = [
  {
    id: 1,
    type: "plan",
    status: "complete",
    title: "Research Plan",
    content: "Analyzing Fed Rate Cut December 2025",
    details: [
      "Query FOMC minutes and Fed statements",
      "Analyze historical rate cut patterns",
      "Cross-reference smart money positioning",
      "Synthesize insider trading signals",
    ],
  },
  {
    id: 2,
    type: "search",
    status: "complete",
    title: "Fed Communications",
    content: "Querying FOMC minutes, Fed speeches...",
    results: [
      "23 relevant Fed communications found",
      "9/12 FOMC members signaled dovish stance",
      "Powell: inflation concerns easing",
    ],
  },
  {
    id: 3,
    type: "database",
    status: "complete",
    title: "On-Chain Analysis",
    content: "Querying wallet activity patterns...",
    results: [
      "Smart money: 82% YES positioning",
      "Top 50 wallets +$4.2M in 7 days",
      "Insider correlation: 0.87",
    ],
  },
  {
    id: 4,
    type: "synthesis",
    status: "active",
    title: "Synthesizing",
    content: "Generating final analysis...",
    results: [],
  },
];

/**
 * Deep Research Panel - OpenBB Copilot Style
 * Theme-aware AI research assistant panel
 */
export function DeepResearchPanel({ isOpen, onToggle }: DeepResearchPanelProps) {
  const [activeStep, setActiveStep] = useState(3);

  useEffect(() => {
    if (activeStep < researchSteps.length - 1) {
      const timer = setTimeout(() => setActiveStep((prev) => prev + 1), 3000);
      return () => clearTimeout(timer);
    }
  }, [activeStep]);

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="w-8 bg-card border-l border-border flex items-center justify-center hover:bg-muted"
      >
        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="w-80 bg-card border-l border-border flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-xs font-medium">Cascadian Copilot</span>
        </div>
        <button onClick={onToggle} className="text-muted-foreground hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Chat message */}
      <div className="p-3 border-b border-border">
        <div className="bg-muted rounded px-3 py-2 text-xs mb-2">
          What&apos;s the likelihood of a Fed rate cut in December 2025? Are there insider signals?
        </div>
        <div className="text-[10px] text-muted-foreground">2:34 PM</div>
      </div>

      {/* Research Thread */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-[10px] text-muted-foreground mb-3 flex items-center gap-2">
          <span>RESEARCH IN PROGRESS</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="space-y-2">
          {researchSteps.map((step, index) => {
            const isActive = index === activeStep;
            const isComplete = index < activeStep || step.status === "complete";

            return (
              <div
                key={step.id}
                className={`border rounded p-2 ${
                  isActive
                    ? "border-border bg-muted/50"
                    : isComplete
                    ? "border-border/50 bg-card"
                    : "border-border/50 bg-card opacity-40"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {isActive ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  ) : isComplete ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                  )}
                  <span className="text-[10px] text-foreground">{step.title}</span>
                </div>

                {(isActive || isComplete) && (
                  <>
                    <div className="text-[10px] text-muted-foreground mb-1">{step.content}</div>

                    {step.details && (
                      <div className="text-[10px] text-muted-foreground/70 space-y-0.5 ml-3">
                        {step.details.map((d, i) => (
                          <div key={i}>- {d}</div>
                        ))}
                      </div>
                    )}

                    {step.results && step.results.length > 0 && (
                      <div className="text-[10px] text-green-500 space-y-0.5 mt-1 ml-3">
                        {step.results.map((r, i) => (
                          <div key={i}>+ {r}</div>
                        ))}
                      </div>
                    )}

                    {isActive && step.results?.length === 0 && (
                      <div className="text-[10px] text-blue-500 mt-1">Processing...</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ask a follow-up..."
            className="flex-1 bg-muted border border-border rounded px-3 py-1.5 text-xs placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button className="bg-muted hover:bg-muted/80 border border-border rounded px-3 py-1.5">
            <Send className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
