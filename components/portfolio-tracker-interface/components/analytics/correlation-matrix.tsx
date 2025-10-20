"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Mock correlation data
const correlationData = [
  { asset1: "BTC", asset2: "BTC", correlation: 1.0 },
  { asset1: "BTC", asset2: "ETH", correlation: 0.85 },
  { asset1: "BTC", asset2: "SOL", correlation: 0.72 },
  { asset1: "BTC", asset2: "ADA", correlation: 0.68 },
  { asset1: "BTC", asset2: "DOT", correlation: 0.71 },
  { asset1: "ETH", asset2: "BTC", correlation: 0.85 },
  { asset1: "ETH", asset2: "ETH", correlation: 1.0 },
  { asset1: "ETH", asset2: "SOL", correlation: 0.79 },
  { asset1: "ETH", asset2: "ADA", correlation: 0.74 },
  { asset1: "ETH", asset2: "DOT", correlation: 0.82 },
  { asset1: "SOL", asset2: "BTC", correlation: 0.72 },
  { asset1: "SOL", asset2: "ETH", correlation: 0.79 },
  { asset1: "SOL", asset2: "SOL", correlation: 1.0 },
  { asset1: "SOL", asset2: "ADA", correlation: 0.65 },
  { asset1: "SOL", asset2: "DOT", correlation: 0.71 },
  { asset1: "ADA", asset2: "BTC", correlation: 0.68 },
  { asset1: "ADA", asset2: "ETH", correlation: 0.74 },
  { asset1: "ADA", asset2: "SOL", correlation: 0.65 },
  { asset1: "ADA", asset2: "ADA", correlation: 1.0 },
  { asset1: "ADA", asset2: "DOT", correlation: 0.78 },
  { asset1: "DOT", asset2: "BTC", correlation: 0.71 },
  { asset1: "DOT", asset2: "ETH", correlation: 0.82 },
  { asset1: "DOT", asset2: "SOL", correlation: 0.71 },
  { asset1: "DOT", asset2: "ADA", correlation: 0.78 },
  { asset1: "DOT", asset2: "DOT", correlation: 1.0 },
];

const assets = ["BTC", "ETH", "SOL", "ADA", "DOT"];

const getCorrelationColor = (correlation: number) => {
  if (correlation >= 0.8) return "#ef4444"; // Strong positive - red
  if (correlation >= 0.6) return "#f97316"; // Moderate positive - orange
  if (correlation >= 0.4) return "#eab308"; // Weak positive - yellow
  if (correlation >= 0.2) return "#84cc16"; // Very weak positive - lime
  if (correlation >= -0.2) return "#6b7280"; // No correlation - gray
  if (correlation >= -0.4) return "#06b6d4"; // Very weak negative - cyan
  if (correlation >= -0.6) return "#3b82f6"; // Weak negative - blue
  if (correlation >= -0.8) return "#8b5cf6"; // Moderate negative - purple
  return "#a855f7"; // Strong negative - violet
};

export function CorrelationMatrix() {
  const cellSize = 60;
  const matrixSize = assets.length * cellSize;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Asset Correlation Matrix</CardTitle>
        <CardDescription>Correlation coefficients between your portfolio assets (30-day rolling)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center space-y-4">
          <div className="relative">
            <svg width={matrixSize + 100} height={matrixSize + 100}>
              {/* Y-axis labels */}
              {assets.map((asset, i) => (
                <text key={`y-${asset}`} x={40} y={50 + i * cellSize + cellSize / 2} textAnchor="middle" dominantBaseline="middle" className="text-sm font-medium fill-current">
                  {asset}
                </text>
              ))}

              {/* X-axis labels */}
              {assets.map((asset, i) => (
                <text key={`x-${asset}`} x={50 + i * cellSize + cellSize / 2} y={35} textAnchor="middle" dominantBaseline="middle" className="text-sm font-medium fill-current">
                  {asset}
                </text>
              ))}

              {/* Correlation cells */}
              {correlationData.map((item, index) => {
                const row = assets.indexOf(item.asset1);
                const col = assets.indexOf(item.asset2);
                const x = 50 + col * cellSize;
                const y = 50 + row * cellSize;

                return (
                  <g key={index}>
                    <rect x={x} y={y} width={cellSize - 1} height={cellSize - 1} fill={getCorrelationColor(item.correlation)} opacity={0.8} className="hover:opacity-100 cursor-pointer" />
                    <text x={x + cellSize / 2} y={y + cellSize / 2} textAnchor="middle" dominantBaseline="middle" className="text-xs font-medium fill-white">
                      {item.correlation.toFixed(2)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Legend */}
          <div className="flex items-center flex-wrap gap-4 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-red-500 rounded"></div>
              <span>Strong (0.8+)</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-orange-500 rounded"></div>
              <span>Moderate (0.6-0.8)</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-yellow-500 rounded"></div>
              <span>Weak (0.4-0.6)</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-gray-500 rounded"></div>
              <span>None (-0.2-0.2)</span>
            </div>
          </div>

          <div className="text-xs text-muted-foreground text-center max-w-md">
            Values closer to 1 indicate strong positive correlation (assets move together), while values closer to -1 indicate strong negative correlation (assets move in opposite directions).
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
