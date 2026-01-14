"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Minus, PieChart } from "lucide-react";
import type { CategoryStats } from "@/hooks/use-wallet-wio";

interface CategoryBreakdownProps {
  categories: CategoryStats[];
}

const CATEGORY_COLORS: Record<string, string> = {
  World: "bg-blue-500",
  Politics: "bg-red-500",
  Other: "bg-gray-500",
  Tech: "bg-purple-500",
  Crypto: "bg-orange-500",
  Economy: "bg-green-500",
  Finance: "bg-emerald-500",
  Sports: "bg-yellow-500",
  Culture: "bg-pink-500",
  Unknown: "bg-slate-500",
};

function formatPnL(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function CategoryBreakdown({ categories }: CategoryBreakdownProps) {
  if (!categories || categories.length === 0) {
    return null;
  }

  const totalPositions = categories.reduce((sum, c) => sum + c.positions, 0);

  return (
    <Card className="p-6 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      <div className="flex items-center gap-2 mb-6">
        <PieChart className="h-5 w-5 text-[#00E0AA]" />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Performance by Category
        </h2>
      </div>

      <div className="space-y-4">
        {categories.map((category) => {
          const winRate = category.win_rate * 100;
          const pnlPositive = category.pnl_usd >= 0;
          const colorClass = CATEGORY_COLORS[category.category] || CATEGORY_COLORS.Unknown;
          const percentage = totalPositions > 0 ? (category.positions / totalPositions) * 100 : 0;

          return (
            <div key={category.category} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${colorClass}`} />
                  <span className="font-medium text-slate-900 dark:text-white">
                    {category.category}
                  </span>
                  <Badge variant="outline" className="text-xs font-mono">
                    {category.positions}
                  </Badge>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      {winRate >= 55 ? (
                        <TrendingUp className="h-3 w-3 text-emerald-500" />
                      ) : winRate <= 45 ? (
                        <TrendingDown className="h-3 w-3 text-red-500" />
                      ) : (
                        <Minus className="h-3 w-3 text-amber-500" />
                      )}
                      <span
                        className={`text-sm font-semibold ${
                          winRate >= 55
                            ? "text-emerald-500"
                            : winRate <= 45
                            ? "text-red-500"
                            : "text-amber-500"
                        }`}
                      >
                        {winRate.toFixed(1)}%
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {category.wins}W / {category.losses}L
                    </span>
                  </div>
                  <div className="text-right min-w-[80px]">
                    <span
                      className={`font-semibold ${
                        pnlPositive ? "text-emerald-500" : "text-red-500"
                      }`}
                    >
                      {formatPnL(category.pnl_usd)}
                    </span>
                  </div>
                </div>
              </div>
              <Progress value={percentage} className="h-1.5" />
            </div>
          );
        })}
      </div>

      {/* Summary row */}
      <div className="mt-6 pt-4 border-t border-border/50">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Total: {totalPositions} resolved positions</span>
          <span>
            {categories.length} categories
          </span>
        </div>
      </div>
    </Card>
  );
}
