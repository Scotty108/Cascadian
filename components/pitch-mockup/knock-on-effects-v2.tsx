"use client";

/**
 * Knock-On Effects Panel - OpenBB Terminal Style
 * Shows market implications if event resolves YES
 */
export function KnockOnEffects() {
  const effects = [
    { sector: "Lending", impact: "Rates -0.25%", direction: "positive" },
    { sector: "Housing", impact: "Liquidity +", direction: "positive" },
    { sector: "Equities", impact: "Risk-on", direction: "positive" },
    { sector: "USD", impact: "Weaken", direction: "negative" },
    { sector: "Crypto", impact: "Bullish", direction: "positive" },
  ];

  return (
    <div className="h-full bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">Knock-On Effects</span>
        <span className="text-xs text-muted-foreground">IF YES</span>
      </div>

      {/* Effects list */}
      <div className="space-y-2 text-xs">
        {effects.map((e) => (
          <div key={e.sector} className="flex items-center justify-between">
            <span className="text-muted-foreground">{e.sector}</span>
            <span className={`font-mono ${
              e.direction === "positive" ? "text-green-500" : "text-orange-400"
            }`}>
              {e.impact}
            </span>
          </div>
        ))}
      </div>

      {/* Recommendation */}
      <div className="mt-3 pt-3 border-t border-border">
        <div className="text-[10px] text-muted-foreground mb-1">RECOMMENDATION</div>
        <div className="text-xs">
          <span className="text-blue-500 font-semibold">BUY YES</span>
          <span className="text-muted-foreground"> - 94% Cascadian confidence</span>
        </div>
      </div>
    </div>
  );
}
