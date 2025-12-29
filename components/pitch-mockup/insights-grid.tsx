"use client";

/**
 * Insights Grid - Bloomberg Terminal Style
 * Compact recommendations and knock-on effects
 */
export function InsightsGrid() {
  return (
    <div className="h-full bg-[#111111] border border-[#252525] rounded p-3 flex flex-col">
      <div className="text-[#555] text-[10px] mb-2">INSIGHTS & RECOMMENDATIONS</div>

      {/* Key insight */}
      <div className="bg-[#0f1a0f] border border-[#1a2a1a] rounded px-2 py-1.5 mb-2">
        <div className="text-[10px] text-[#6a8a6a] mb-0.5">OPPORTUNITY</div>
        <div className="text-xs text-[#e5e5e5]">
          Market underpricing by 7% vs Cascadian model. Consider YES position.
        </div>
      </div>

      {/* Knock-on effects */}
      <div className="flex-1 space-y-1.5 text-[11px]">
        <div className="text-[#555] text-[10px]">IF YES (RATE CUT):</div>
        <div className="flex justify-between">
          <span className="text-[#666]">Lending Rates</span>
          <span className="text-[#6a9a6a]">Decrease 0.25-0.50%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">Housing Liquidity</span>
          <span className="text-[#6a9a6a]">Increase</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">Risk Assets</span>
          <span className="text-[#6a9a6a]">Bullish</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#666]">USD Index</span>
          <span className="text-[#9a6a6a]">Weaken</span>
        </div>
      </div>
    </div>
  );
}
