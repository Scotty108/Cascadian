"use client";

/**
 * Event Header - OpenBB Terminal Style
 * Compact header with key stats, theme-aware
 */
export function EventHeader() {
  return (
    <div className="flex items-center justify-between py-2 px-4 bg-card border border-border rounded-lg">
      {/* Left: Title */}
      <div className="flex items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Fed Rate Cut December 2025</h1>
            <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-500 border border-blue-500/30 rounded">
              LIVE
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Will the Federal Reserve cut interest rates at the December 2025 FOMC meeting?
          </p>
        </div>
      </div>

      {/* Right: Key stats */}
      <div className="flex items-center gap-6 text-xs">
        <div className="text-right">
          <div className="text-muted-foreground">Volume</div>
          <div className="font-mono font-semibold">$24.5M</div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground">Traders</div>
          <div className="font-mono font-semibold">45,892</div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground">Closes</div>
          <div className="font-mono font-semibold">Dec 18, 2025</div>
        </div>
        <div className="text-right">
          <div className="text-muted-foreground">Liquidity</div>
          <div className="font-mono font-semibold">$2.1M</div>
        </div>
      </div>
    </div>
  );
}
