"use client";

import { FileText, ExternalLink } from "lucide-react";

/**
 * Market Analysis Card - Enterprise Style
 * Dense research report with sources and evidence
 */
export function MarketAnalysisCard() {
  return (
    <div className="h-full bg-card border border-border rounded-xl p-4 flex flex-col shadow-md hover:shadow-lg transition-shadow duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Market Analysis Report</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          Updated 2h ago · 23 sources
        </span>
      </div>

      {/* Main Analysis Text - Smaller, denser */}
      <div className="space-y-2.5 text-[11px] leading-relaxed flex-1">
        <p className="text-foreground">
          The Federal Reserve is widely expected to cut rates at the December 2025 FOMC meeting.
          Our analysis of <span className="text-blue-500 cursor-pointer hover:underline">23 Fed communications</span> reveals
          a clear dovish pivot, with 9 of 12 FOMC members signaling support for rate reduction.
        </p>

        <p className="text-muted-foreground">
          Key signals driving our <span className="text-blue-500 font-medium">94% confidence score</span> include
          Powell&apos;s <span className="text-blue-500 cursor-pointer hover:underline">November 15 speech</span> explicitly
          mentioning &quot;easing inflation concerns&quot; and &quot;room for policy adjustment.&quot; Core PCE has trended
          below 2.5% for three consecutive months (<span className="text-blue-500 cursor-pointer hover:underline">BLS data</span>),
          while labor market indicators show controlled cooling without recession triggers.
        </p>

        <p className="text-muted-foreground">
          Cross-referencing with <span className="text-blue-500 cursor-pointer hover:underline">CME FedWatch</span> (89%),
          <span className="text-blue-500 cursor-pointer hover:underline">Kalshi</span> (84%), and internal smart money
          tracking (82% YES), we identify a <span className="text-emerald-500 font-medium">7-point mispricing gap</span> between
          current market (87%) and our AI projection (<span className="text-blue-500 font-medium">94%</span>).
        </p>

        <p className="text-muted-foreground">
          Historical analysis of similar setups (dovish Fed + cooling PCE + stable employment) shows
          <span className="text-emerald-500 font-medium"> 91% accuracy</span> in predicting rate cuts over the past
          8 FOMC cycles (<span className="text-blue-500 cursor-pointer hover:underline">methodology</span>).
        </p>

        {/* Sources & Evidence Section */}
        <div className="border-t border-border pt-2.5 mt-2">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">
            Key Data Points & Sources
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
            <div className="flex items-center justify-between p-1.5 -mx-1 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
              <span className="text-muted-foreground">Core PCE (Nov)</span>
              <span className="font-mono tabular-nums">2.3% <span className="text-emerald-500">↓0.5%</span></span>
            </div>
            <div className="flex items-center justify-between p-1.5 -mx-1 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
              <span className="text-muted-foreground">Unemployment</span>
              <span className="font-mono tabular-nums">4.2% <span className="text-muted-foreground/50">—</span></span>
            </div>
            <div className="flex items-center justify-between p-1.5 -mx-1 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
              <span className="text-muted-foreground">Fed Dot Plot Target</span>
              <span className="font-mono tabular-nums">4.25%</span>
            </div>
            <div className="flex items-center justify-between p-1.5 -mx-1 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
              <span className="text-muted-foreground">CME FedWatch</span>
              <span className="font-mono tabular-nums text-blue-500">89%</span>
            </div>
            <div className="flex items-center justify-between p-1.5 -mx-1 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
              <span className="text-muted-foreground">FOMC Sentiment</span>
              <span className="font-mono tabular-nums">9/12 dovish</span>
            </div>
            <div className="flex items-center justify-between p-1.5 -mx-1 rounded transition-all duration-200 hover:bg-cyan-50/50 dark:hover:bg-cyan-900/20 hover:scale-[1.02]">
              <span className="text-muted-foreground">Smart Money</span>
              <span className="font-mono tabular-nums text-blue-500">82% YES</span>
            </div>
          </div>
        </div>

        {/* Source Links */}
        <div className="border-t border-border pt-2">
          <div className="flex flex-wrap gap-2 text-[9px]">
            <span className="text-blue-500 cursor-pointer hover:text-blue-400 transition-colors duration-150 flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />Fed Minutes
            </span>
            <span className="text-blue-500 cursor-pointer hover:text-blue-400 transition-colors duration-150 flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />BLS Employment
            </span>
            <span className="text-blue-500 cursor-pointer hover:text-blue-400 transition-colors duration-150 flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />PCE Index
            </span>
            <span className="text-blue-500 cursor-pointer hover:text-blue-400 transition-colors duration-150 flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />CME FedWatch
            </span>
            <span className="text-blue-500 cursor-pointer hover:text-blue-400 transition-colors duration-150 flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />Powell Speech
            </span>
            <span className="text-muted-foreground">+18 more</span>
          </div>
        </div>
      </div>
    </div>
  );
}
