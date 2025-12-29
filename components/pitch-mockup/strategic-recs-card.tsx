"use client";

import { Lightbulb, Building2, Briefcase, User, Clock } from "lucide-react";

/**
 * Strategic Recommendations Card - Enterprise Style
 * Professional actionable recommendations
 */
export function StrategicRecsCard() {
  return (
    <div className="h-full bg-card border border-border rounded-xl p-5 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Strategic Recommendations</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          AI-Generated
        </span>
      </div>

      {/* Recommendations by Persona */}
      <div className="space-y-4 text-sm flex-1">
        {/* Hedge Funds */}
        <div className="border-l-2 border-border pl-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">For Hedge Funds</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            If the market hasn&apos;t priced in the cut, go long risk assets. If already priced in
            (check VIX, credit spreads), consider &quot;sell the news&quot; positioning.
          </p>
        </div>

        {/* Corporate Treasurers */}
        <div className="border-l-2 border-border pl-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">For Corporate Treasurers</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Delay any major debt issuance until post-announcement for better rates.
            A 0.25% cut on a $1B+ facility represents significant savings.
          </p>
        </div>

        {/* Individual Investors */}
        <div className="border-l-2 border-border pl-3">
          <div className="flex items-center gap-2 mb-1.5">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">For Individual Investors</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Consider refinancing variable-rate debt. Rotate into rate-sensitive sectors
            (REITs, utilities, growth tech).
          </p>
        </div>
      </div>

      {/* Timing Note */}
      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex items-start gap-2">
          <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Timing:</span> Execute trades 24-48 hours
            before announcement for optimal positioning. Smart money is already moving.
          </p>
        </div>
      </div>

      {/* Action Summary */}
      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
              Verdict
            </div>
            <div className="text-sm font-semibold text-blue-500">BUY YES @ 87¢</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
              Target
            </div>
            <div className="text-sm font-mono font-semibold text-emerald-500">94¢</div>
          </div>
        </div>
      </div>
    </div>
  );
}
