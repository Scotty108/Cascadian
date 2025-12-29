"use client";

import { TrendingUp } from "lucide-react";

// ============================================
// TOGGLE: Change to "heatmap" to revert back
// ============================================
const SMART_MONEY_VISUALIZATION: "sparkline" | "heatmap" = "sparkline";

// ============================================
// TOGGLE: Change to "rounded" to revert back
// ============================================
const CORNER_STYLE: "rounded" | "sharp" = "sharp";

/**
 * Score Comparison Card - Enterprise Style
 * Heat map visualization with market consensus
 */
export function ScoreComparisonCard() {
  // Heat map data - simulated wallet activity over 7 days
  const heatMapData = [
    [0.3, 0.5, 0.7, 0.4, 0.8, 0.9, 0.95],
    [0.4, 0.6, 0.5, 0.7, 0.8, 0.85, 0.9],
    [0.2, 0.4, 0.6, 0.5, 0.7, 0.8, 0.88],
    [0.3, 0.3, 0.5, 0.6, 0.65, 0.75, 0.82],
  ];

  // Sparkline data - 7 days of cumulative YES position flow (in millions)
  const sparklineData = [1.2, 1.8, 2.1, 2.4, 3.1, 3.6, 4.2];

  const days = ["M", "T", "W", "T", "F", "S", "S"];

  const getHeatColor = (value: number) => {
    // Subtle gradient using zinc with cyan highlights
    if (value >= 0.85) return "bg-cyan-400/80";
    if (value >= 0.7) return "bg-cyan-400/50";
    if (value >= 0.55) return "bg-cyan-400/30";
    if (value >= 0.4) return "bg-zinc-500/40";
    return "bg-zinc-600/30";
  };

  // Generate SVG path for sparkline
  const generateSparklinePath = (data: number[]) => {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const width = 100;
    const height = 32;
    const padding = 2;

    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * (width - padding * 2) + padding;
      const y = height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });

    const linePath = `M ${points.join(" L ")}`;
    const areaPath = `${linePath} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`;

    return { linePath, areaPath };
  };

  const { linePath, areaPath } = generateSparklinePath(sparklineData);

  return (
    <div className={`h-full bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-900 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-3 flex flex-col shadow-md hover:shadow-lg transition-shadow duration-200`}>
      {/* Header */}
      <div className="mb-3">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Cascadian Prediction</span>
      </div>

      {/* Cascadian AI Score */}
      <div className="mb-3 pb-3 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-baseline gap-3">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">94%</span>
            <span className="text-sm text-zinc-500">YES</span>
          </div>
          <span className="text-zinc-300 dark:text-zinc-600">/</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-mono tabular-nums text-zinc-400">6%</span>
            <span className="text-sm text-zinc-500">NO</span>
          </div>
        </div>
        <div className="text-[10px] text-zinc-500 mt-1">
          +7 pts vs market · High confidence
        </div>
      </div>

      {/* Market Consensus - YES and NO */}
      <div className={`bg-gradient-to-br from-zinc-50 to-zinc-100/50 dark:from-zinc-800/80 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} p-3 mb-2 transition-all duration-200 hover:border-cyan-400/50 hover:bg-zinc-100/80 dark:hover:bg-zinc-800`}>
        <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">
          Market Consensus
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">87%</span>
              <span className="text-sm font-medium text-zinc-500">YES</span>
            </div>
            <div className="text-[10px] text-zinc-500 font-mono tabular-nums">87¢</div>
          </div>
          <div className="w-px bg-zinc-200 dark:bg-zinc-700" />
          <div className="flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">13%</span>
              <span className="text-sm font-medium text-zinc-500">NO</span>
            </div>
            <div className="text-[10px] text-zinc-500 font-mono tabular-nums">13¢</div>
          </div>
        </div>
      </div>

      {/* Smart Money Activity - Toggle between sparkline and heatmap */}
      <div className={`bg-gradient-to-br from-zinc-50 to-zinc-100/50 dark:from-zinc-800/80 dark:to-zinc-900 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} p-2.5 min-h-0 overflow-hidden transition-all duration-200 hover:border-cyan-400/50 hover:bg-zinc-100/80 dark:hover:bg-zinc-800`}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-zinc-400" />
            <span className="text-[9px] text-zinc-500 uppercase tracking-wide">
              Smart Money Activity
            </span>
          </div>
          <span className="text-[10px] font-mono tabular-nums text-zinc-700 dark:text-zinc-300">82% YES</span>
        </div>

        {SMART_MONEY_VISUALIZATION === "sparkline" ? (
          <>
            {/* Sparkline with gradient fill */}
            <div className="relative h-8">
              <svg
                viewBox="0 0 100 32"
                className="w-full h-full"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="sparklineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.05" />
                  </linearGradient>
                </defs>
                {/* Gradient fill area */}
                <path
                  d={areaPath}
                  fill="url(#sparklineGradient)"
                />
                {/* Line */}
                <path
                  d={linePath}
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* End dot */}
                <circle
                  cx="98"
                  cy={32 - 2 - ((4.2 - 1.2) / (4.2 - 1.2)) * 28}
                  r="2.5"
                  fill="#22d3ee"
                />
              </svg>
            </div>

            {/* Stats row + Day labels combined */}
            <div className="flex items-center justify-between text-[9px] mt-1">
              <span className="text-zinc-500">7d flow</span>
              <span className="font-mono text-cyan-600 dark:text-cyan-400 font-medium">+$4.2M</span>
            </div>
          </>
        ) : (
          <>
            {/* Heat Map Grid (original) */}
            <div className="space-y-1 mb-1.5">
              {heatMapData.slice(0, 3).map((row, rowIdx) => (
                <div key={rowIdx} className="flex gap-0.5">
                  {row.map((value, colIdx) => (
                    <div
                      key={colIdx}
                      className={`flex-1 h-2.5 rounded-sm ${getHeatColor(value)}`}
                      title={`${(value * 100).toFixed(0)}% conviction`}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Day labels */}
            <div className="flex gap-0.5">
              {days.map((day, i) => (
                <div key={i} className="flex-1 text-center text-[8px] text-zinc-500">
                  {day}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
