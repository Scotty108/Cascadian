"use client";

/**
 * Forecaster Panel - OpenBB Terminal Style
 * Shows super forecaster consensus
 */
export function ForecasterPanel() {
  const forecasters = [
    { name: "PhilipTetlock", accuracy: 94, vote: "YES" },
    { name: "NateSilver", accuracy: 91, vote: "YES" },
    { name: "ScottAlexander", accuracy: 89, vote: "YES" },
    { name: "EliezerY", accuracy: 87, vote: "NO" },
  ];

  return (
    <div className="h-full bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">Super Forecasters</span>
        <span className="text-xs text-muted-foreground">47 Active</span>
      </div>

      {/* Vote breakdown */}
      <div className="flex items-center gap-4 mb-3">
        <div className="text-center">
          <div className="text-2xl font-mono font-bold text-blue-500">38</div>
          <div className="text-[10px] text-muted-foreground">YES</div>
        </div>
        <div className="text-muted-foreground">|</div>
        <div className="text-center">
          <div className="text-2xl font-mono font-bold text-muted-foreground">9</div>
          <div className="text-[10px] text-muted-foreground">NO</div>
        </div>
        <div className="flex-1 text-right">
          <div className="text-xs text-muted-foreground">Consensus</div>
          <div className="text-lg font-mono font-semibold">81%</div>
        </div>
      </div>

      {/* Top forecasters */}
      <div className="space-y-1.5 text-xs">
        {forecasters.map((f) => (
          <div key={f.name} className="flex items-center justify-between">
            <span className="text-muted-foreground truncate">{f.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{f.accuracy}%</span>
              <span className={`font-mono ${f.vote === "YES" ? "text-blue-500" : "text-muted-foreground"}`}>
                {f.vote}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
