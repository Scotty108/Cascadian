"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PieChart, TrendingUp, TrendingDown } from "lucide-react";
import { CategoryMetrics, formatPnL, formatPercent } from "@/hooks/use-wallet-wio";

interface CategoryPerformanceProps {
  categoryMetrics: CategoryMetrics[];
}

// Category icon/color mapping
const CATEGORY_CONFIG: Record<string, { emoji: string; color: string }> = {
  politics: { emoji: '🏛️', color: 'bg-blue-500/10 text-blue-500' },
  crypto: { emoji: '₿', color: 'bg-orange-500/10 text-orange-500' },
  sports: { emoji: '⚽', color: 'bg-green-500/10 text-green-500' },
  science: { emoji: '🔬', color: 'bg-purple-500/10 text-purple-500' },
  entertainment: { emoji: '🎬', color: 'bg-pink-500/10 text-pink-500' },
  economics: { emoji: '📈', color: 'bg-amber-500/10 text-amber-500' },
  business: { emoji: '💼', color: 'bg-slate-500/10 text-slate-500' },
  world: { emoji: '🌍', color: 'bg-cyan-500/10 text-cyan-500' },
  tech: { emoji: '💻', color: 'bg-indigo-500/10 text-indigo-500' },
  culture: { emoji: '🎭', color: 'bg-rose-500/10 text-rose-500' },
};

export function CategoryPerformance({ categoryMetrics }: CategoryPerformanceProps) {
  if (categoryMetrics.length === 0) {
    return (
      <Card className="p-6 border-border/50">
        <div className="text-center py-8 text-muted-foreground">
          <PieChart className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No category performance data available.</p>
        </div>
      </Card>
    );
  }

  // Calculate totals for percentages
  const totalPositions = categoryMetrics.reduce((sum, c) => sum + c.positions_n, 0);
  const totalPnL = categoryMetrics.reduce((sum, c) => sum + c.pnl_total_usd, 0);

  // Sort by positions count
  const sortedCategories = [...categoryMetrics].sort((a, b) => b.positions_n - a.positions_n);

  // Find best and worst categories
  const bestCategory = sortedCategories.reduce((best, c) =>
    c.pnl_total_usd > best.pnl_total_usd ? c : best
  );
  const worstCategory = sortedCategories.reduce((worst, c) =>
    c.pnl_total_usd < worst.pnl_total_usd ? c : worst
  );

  return (
    <Card className="p-6 border-border/50">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <PieChart className="h-5 w-5 text-[#00E0AA]" />
          Category Performance
        </h2>
        <div className="text-sm text-muted-foreground">
          {sortedCategories.length} categories
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card className="p-4 bg-[#00E0AA]/5 border-[#00E0AA]/20">
          <div className="flex items-center gap-2 text-[#00E0AA] mb-1">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium">Best Category</span>
          </div>
          <div className="font-semibold">{bestCategory.bundle_name}</div>
          <div className="text-sm text-[#00E0AA]">
            {formatPnL(bestCategory.pnl_total_usd)} • {(bestCategory.win_rate * 100).toFixed(0)}% WR
          </div>
        </Card>
        <Card className="p-4 bg-red-500/5 border-red-500/20">
          <div className="flex items-center gap-2 text-red-500 mb-1">
            <TrendingDown className="h-4 w-4" />
            <span className="text-xs font-medium">Worst Category</span>
          </div>
          <div className="font-semibold">{worstCategory.bundle_name}</div>
          <div className="text-sm text-red-500">
            {formatPnL(worstCategory.pnl_total_usd)} • {(worstCategory.win_rate * 100).toFixed(0)}% WR
          </div>
        </Card>
      </div>

      {/* Category Table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Positions</TableHead>
              <TableHead className="text-right">PnL</TableHead>
              <TableHead className="text-right">ROI</TableHead>
              <TableHead className="text-right">Win Rate</TableHead>
              <TableHead className="text-right">Brier</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedCategories.map((category) => {
              const config = CATEGORY_CONFIG[category.scope_id] || { emoji: '📊', color: 'bg-gray-500/10 text-gray-500' };
              const positionShare = (category.positions_n / totalPositions) * 100;

              return (
                <TableRow key={category.scope_id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`${config.color} border-0`}>
                        {config.emoji}
                      </Badge>
                      <span className="font-medium">{category.bundle_name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({positionShare.toFixed(0)}%)
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {category.positions_n}
                    <span className="text-xs text-muted-foreground ml-1">
                      ({category.resolved_positions_n} resolved)
                    </span>
                  </TableCell>
                  <TableCell className={`text-right font-semibold ${category.pnl_total_usd >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                    {formatPnL(category.pnl_total_usd)}
                  </TableCell>
                  <TableCell className={`text-right ${category.roi_cost_weighted >= 0 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                    {formatPercent(category.roi_cost_weighted)}
                  </TableCell>
                  <TableCell className={`text-right ${category.win_rate >= 0.5 ? 'text-[#00E0AA]' : 'text-red-500'}`}>
                    {(category.win_rate * 100).toFixed(0)}%
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {category.brier_mean > 0 ? category.brier_mean.toFixed(3) : '-'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Visual Bar Chart */}
      <div className="mt-6 space-y-2">
        <div className="text-xs text-muted-foreground mb-2">Position Distribution</div>
        <div className="flex h-4 rounded-full overflow-hidden bg-muted/30">
          {sortedCategories.map((category, index) => {
            const config = CATEGORY_CONFIG[category.scope_id] || { color: 'bg-gray-500' };
            const width = (category.positions_n / totalPositions) * 100;

            return (
              <div
                key={category.scope_id}
                className={`${config.color.split(' ')[0].replace('/10', '')} transition-all`}
                style={{ width: `${width}%` }}
                title={`${category.bundle_name}: ${category.positions_n} positions`}
              />
            );
          })}
        </div>
      </div>
    </Card>
  );
}
