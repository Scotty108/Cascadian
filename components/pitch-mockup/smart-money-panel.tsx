"use client";

/**
 * Smart Money Panel - OpenBB Terminal Style
 * Shows smart money positioning and flow
 */
export function SmartMoneyPanel() {
  return (
    <div className="h-full bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">Smart Money Signal</span>
        <span className="text-xs px-1.5 py-0.5 bg-blue-500/10 text-blue-500 border border-blue-500/30 rounded">
          BULLISH
        </span>
      </div>

      {/* Sentiment bar */}
      <div className="mb-3">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-blue-500" style={{ width: "82%" }} />
        </div>
        <div className="flex justify-between text-[10px] mt-1 text-muted-foreground">
          <span>82% YES</span>
          <span>18% NO</span>
        </div>
      </div>

      {/* Stats */}
      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Top 50 Wallets</span>
          <span className="font-mono">38 YES / 12 NO</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">24h Flow</span>
          <span className="font-mono text-green-500">+$2.3M YES</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Avg Position</span>
          <span className="font-mono">$125K</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Accuracy (90d)</span>
          <span className="font-mono">89%</span>
        </div>
      </div>
    </div>
  );
}
