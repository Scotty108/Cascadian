"use client";

/**
 * Score Cards - Bloomberg Terminal Style
 * Compact grid of key metrics: cross-platform odds, smart money, forecasters
 */
export function ScoreCards() {
  return (
    <div className="h-full grid grid-cols-4 gap-3">
      {/* Cross-Platform Odds */}
      <div className="bg-[#111111] border border-[#252525] rounded p-3">
        <div className="text-[#555] text-[10px] mb-2">CROSS-PLATFORM ODDS</div>
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-[#666]">Polymarket</span>
            <span className="font-mono text-[#e5e5e5]">87%</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[#666]">Kalshi</span>
            <span className="font-mono text-[#e5e5e5]">84%</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[#666]">PredictIt</span>
            <span className="font-mono text-[#e5e5e5]">82%</span>
          </div>
          <div className="border-t border-[#252525] pt-1.5 mt-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-[#555]">Consensus</span>
              <span className="font-mono text-[#4a9eff]">84%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cascadian Score */}
      <div className="bg-[#111111] border border-[#252525] rounded p-3">
        <div className="text-[#555] text-[10px] mb-2">CASCADIAN SCORE</div>
        <div className="flex items-end gap-4 mb-2">
          <div>
            <div className="text-[10px] text-[#555]">MARKET</div>
            <div className="text-xl font-mono text-[#888]">87%</div>
          </div>
          <div>
            <div className="text-[10px] text-[#555]">CASCADIAN</div>
            <div className="text-xl font-mono text-[#e5e5e5]">94%</div>
          </div>
        </div>
        <div className="bg-[#1a2a1a] border border-[#2a3a2a] rounded px-2 py-1">
          <div className="flex justify-between text-xs">
            <span className="text-[#6a8a6a]">Alpha Edge</span>
            <span className="font-mono text-[#6a9a6a]">+7%</span>
          </div>
        </div>
      </div>

      {/* Smart Money */}
      <div className="bg-[#111111] border border-[#252525] rounded p-3">
        <div className="text-[#555] text-[10px] mb-2">SMART MONEY SIGNAL</div>
        <div className="mb-2">
          <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
            <div className="h-full bg-[#4a9eff]" style={{ width: "82%" }} />
          </div>
          <div className="flex justify-between text-[10px] mt-1">
            <span className="text-[#666]">82% YES</span>
            <span className="text-[#666]">18% NO</span>
          </div>
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-[#555]">Top 50 Wallets</span>
            <span className="text-[#e5e5e5]">38 YES / 12 NO</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#555]">24h Flow</span>
            <span className="text-[#6a9a6a]">+$2.3M YES</span>
          </div>
        </div>
      </div>

      {/* Super Forecasters */}
      <div className="bg-[#111111] border border-[#252525] rounded p-3">
        <div className="text-[#555] text-[10px] mb-2">SUPER FORECASTERS</div>
        <div className="flex items-center gap-4 mb-2">
          <div className="text-center">
            <div className="text-xl font-mono text-[#4a9eff]">38</div>
            <div className="text-[10px] text-[#555]">YES</div>
          </div>
          <div className="text-[#333]">|</div>
          <div className="text-center">
            <div className="text-xl font-mono text-[#666]">9</div>
            <div className="text-[10px] text-[#555]">NO</div>
          </div>
        </div>
        <div className="text-xs text-[#555]">
          81% consensus among 47 tracked forecasters with 85%+ accuracy
        </div>
      </div>
    </div>
  );
}
