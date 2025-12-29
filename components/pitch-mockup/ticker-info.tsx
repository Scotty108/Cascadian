"use client";

/**
 * Ticker Info Widget - OpenBB Terminal Style
 * Shows current probability and key metrics
 */
export function TickerInfo() {
  return (
    <div className="h-full bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">Event Information</span>
        <span className="text-xs px-1.5 py-0.5 bg-muted rounded">FOMC</span>
      </div>

      {/* Main probability */}
      <div className="mb-4">
        <div className="text-3xl font-mono font-bold text-blue-500">87%</div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-blue-500">+2.3%</span>
          <span className="text-muted-foreground">24h change</span>
        </div>
      </div>

      {/* Mini stats */}
      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Current YES</span>
          <span className="font-mono">87.0%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Current NO</span>
          <span className="font-mono">13.0%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">7d High</span>
          <span className="font-mono">89.2%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">7d Low</span>
          <span className="font-mono">78.5%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Category</span>
          <span className="font-mono">Macro</span>
        </div>
      </div>
    </div>
  );
}
