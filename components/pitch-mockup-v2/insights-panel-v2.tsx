"use client";

/**
 * Insights Panel - OpenBB Terminal Style
 * AI-generated insights and recommendations
 */
export function InsightsPanel() {
  return (
    <div className="h-full bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">AI Insights</span>
        <span className="text-xs px-1.5 py-0.5 bg-blue-500/10 text-blue-500 border border-blue-500/30 rounded">
          3 NEW
        </span>
      </div>

      {/* Cascadian Score */}
      <div className="bg-muted/50 rounded p-2 mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">Cascadian Score</span>
          <span className="text-lg font-mono font-bold text-blue-500">94%</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">vs Market 87%</span>
          <span className="text-green-500">+7% Edge</span>
        </div>
      </div>

      {/* Key insights */}
      <div className="space-y-2 text-xs">
        <div className="border-l-2 border-blue-500 pl-2">
          <div className="text-blue-500 text-[10px]">OPPORTUNITY</div>
          <div className="text-foreground">Market underpricing by 7%</div>
        </div>
        <div className="border-l-2 border-muted pl-2">
          <div className="text-muted-foreground text-[10px]">SIGNAL</div>
          <div className="text-foreground">9/12 FOMC members dovish</div>
        </div>
        <div className="border-l-2 border-muted pl-2">
          <div className="text-muted-foreground text-[10px]">FLOW</div>
          <div className="text-foreground">+$4.2M smart money in 7d</div>
        </div>
      </div>
    </div>
  );
}
