"use client";

import { useState, useEffect } from "react";
import { ChevronRight, ChevronLeft, Send, Sparkles, Database, Globe, Zap, FileText } from "lucide-react";

// ============================================
// TOGGLE: Change to "rounded" to revert back
// ============================================
const CORNER_STYLE: "rounded" | "sharp" = "sharp";

interface DeepResearchCopilotProps {
  isOpen: boolean;
  onToggle: () => void;
}

// Research steps - expanded with statistical modeling and historical analysis
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

/**
 * Deep Research Copilot - Light/Dark Mode Support
 */
export function DeepResearchCopilot({ isOpen, onToggle }: DeepResearchCopilotProps) {
  const [synthesisText, setSynthesisText] = useState("");

  useEffect(() => {
    const fullText = `Our models project a 94% probability of a December rate cut, vs 87% market pricing—a 7-point edge.

Key factors: 9/12 FOMC dovish, Core PCE at 2.3%, smart money 82% YES. Historical pattern match to Dec 2018 at 91%.`;

    let index = 0;
    const interval = setInterval(() => {
      if (index <= fullText.length) {
        setSynthesisText(fullText.slice(0, index));
        index++;
      } else {
        clearInterval(interval);
      }
    }, 12);

    return () => clearInterval(interval);
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="w-10 bg-zinc-50 dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
      >
        <ChevronLeft className="h-4 w-4 text-zinc-500" />
      </button>
    );
  }

  return (
    <div className="w-[480px] bg-zinc-50 dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-200">Cascadian Copilot</span>
        <button
          onClick={onToggle}
          className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* User Message - Right aligned */}
        <div className="flex justify-end mb-4">
          <div className="max-w-[85%]">
            <div className={`bg-zinc-100 dark:bg-zinc-900 ${CORNER_STYLE === "rounded" ? "rounded-2xl rounded-br-sm" : "rounded-lg rounded-br-sm"} px-4 py-3`}>
              <p className="text-sm leading-relaxed text-zinc-900 dark:text-zinc-200">
                What&apos;s the likelihood of a Fed rate cut in December 2025? Are there any insider signals?
              </p>
            </div>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-1 block text-right">2:34 PM</span>
          </div>
        </div>

        {/* AI Response - Left aligned */}
        <div className="mb-4">
          {/* Research Progress Card */}
          <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-4 mb-3`}>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3">
              Research Progress
            </div>

            {/* Minimal Timeline */}
            <div className="space-y-0">
              {researchSteps.map((step, index) => {
                const isActive = step.status === "active";
                const isLast = index === researchSteps.length - 1;

                return (
                  <div key={step.id} className="flex gap-3">
                    {/* Dot and line */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-1.5 h-1.5 rounded-full mt-1.5 ${
                          isActive ? "bg-zinc-400 dark:bg-zinc-600" : "bg-cyan-400"
                        }`}
                      />
                      {!isLast && (
                        <div className="w-px flex-1 bg-zinc-200 dark:bg-zinc-700 min-h-[24px]" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-3">
                      <span className={`text-xs ${isActive ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-300"}`}>
                        {step.title}
                        {isActive && <span className="text-zinc-400 dark:text-zinc-600 ml-2">...</span>}
                      </span>
                      {step.result && (
                        <p className="text-[11px] text-zinc-500 mt-0.5 font-mono">
                          {step.result}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Synthesis Output Card */}
          <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-4`}>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              Summary
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-line text-zinc-600 dark:text-zinc-400">
              {synthesisText}
              <span className="animate-pulse text-cyan-400">▌</span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-3">
            <button className={`text-[11px] px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-zinc-700 dark:text-zinc-300`}>
              View Full Report
            </button>
            <button className={`text-[11px] px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-zinc-500 flex items-center gap-1.5`}>
              <FileText className="w-3 h-3" />
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* OpenBB-style Input with Widgets */}
      <div className="border-t border-zinc-200 dark:border-zinc-800">
        {/* Widget Bar */}
        <div className="px-3 py-2 flex items-center gap-1.5 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-[9px] text-zinc-400 mr-2">Using:</span>
          <button className="flex items-center gap-1 px-2 py-1 text-[10px] bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400 transition-colors">
            <Sparkles className="w-3 h-3" />
            <span>Cascadian AI</span>
          </button>
          <button className="flex items-center gap-1 px-2 py-1 text-[10px] bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400 transition-colors">
            <Database className="w-3 h-3" />
            <span>On-Chain</span>
          </button>
          <button className="flex items-center gap-1 px-2 py-1 text-[10px] bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400 transition-colors">
            <Globe className="w-3 h-3" />
            <span>Web</span>
          </button>
        </div>

        {/* Input Area */}
        <div className="p-3">
          <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"}`}>
            <textarea
              placeholder="Ask a question..."
              rows={2}
              className="w-full px-4 py-3 bg-transparent text-sm text-zinc-900 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none resize-none"
            />
            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-zinc-400">
                  <Zap className="w-3 h-3 inline mr-1" />
                  Deep research enabled
                </span>
              </div>
              <button className={`p-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} text-zinc-600 dark:text-zinc-400 hover:text-cyan-500 transition-colors`}>
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
