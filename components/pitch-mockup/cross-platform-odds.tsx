"use client";

/**
 * Cross Platform Odds Widget - OpenBB Terminal Style
 * Shows odds across Polymarket, Kalshi, PredictIt
 */
export function CrossPlatformOdds() {
  const platforms = [
    { name: "Polymarket", yes: 87, volume: "$24.5M" },
    { name: "Kalshi", yes: 84, volume: "$8.2M" },
    { name: "PredictIt", yes: 82, volume: "$1.4M" },
    { name: "Robinhood", yes: 85, volume: "$3.1M" },
  ];

  const consensus = Math.round(platforms.reduce((acc, p) => acc + p.yes, 0) / platforms.length);

  return (
    <div className="h-full bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">Cross-Platform Odds</span>
        <span className="text-xs text-blue-500">LIVE</span>
      </div>

      {/* Consensus */}
      <div className="bg-muted/50 rounded p-2 mb-3">
        <div className="text-xs text-muted-foreground">Market Consensus</div>
        <div className="text-2xl font-mono font-bold text-blue-500">{consensus}%</div>
      </div>

      {/* Platform breakdown */}
      <div className="space-y-2 text-xs">
        {platforms.map((p) => (
          <div key={p.name} className="flex items-center justify-between">
            <span className="text-muted-foreground">{p.name}</span>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">{p.volume}</span>
              <span className="font-mono font-semibold w-10 text-right">{p.yes}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
