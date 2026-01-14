// @ts-nocheck
'use client';

import { useState, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { stratify, pack } from 'd3-hierarchy';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import { Layers, Info, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from '@/components/ui/progress';
interface ClosedPosition {
  title?: string
  slug?: string
  market?: string
  question?: string  // WIO field
  realizedPnl?: number
  realized_pnl?: number
  profit?: number
  pnl_usd?: number  // WIO field
  avgPrice?: number
  entry_price?: number
  entryPrice?: number
  totalBought?: number
  size?: number
  cost_usd?: number  // WIO field
  side?: 'YES' | 'NO' | string
  closed_at?: string
  endDate?: string
  ts_close?: string  // WIO field
  ts_open?: string   // WIO field
  conditionId?: string
  position_id?: string
  tokenId?: string
  market_id?: string  // WIO field
  category?: string   // WIO field
  roi?: number        // WIO field
}

interface CategoryStats {
  category: string;
  positions: number;
  wins: number;
  losses: number;
  win_rate: number;
  pnl_usd: number;
}

interface TradingBubbleChartProps {
  closedPositions: ClosedPosition[];
  categoryStats?: CategoryStats[];
}

interface TradeRow {
  category: string;
  marketId: string;
  marketLabel: string;
  invested: number;
  pnlUsd: number;
  roi: number;
  side: 'YES' | 'NO';
}

interface SeriesNode {
  id: string;
  name: string;
  value: number;
  roi: number;
  depth: number;
  index: number;
  side?: 'YES' | 'NO';
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

export function TradingBubbleChart({ closedPositions, categoryStats }: TradingBubbleChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState(999999);
  const chartRef = useRef<any>(null);
  const { theme } = useTheme();

  const isDark = theme === 'dark';

  const periods = [
    { label: '7 Days', value: 7 },
    { label: '30 Days', value: 30 },
    { label: '90 Days', value: 90 },
    { label: 'All Time', value: 999999 },
  ];

  const buildSeriesData = (rows: TradeRow[]): SeriesNode[] => {
    const byCat = new Map<string, TradeRow[]>();
    for (const r of rows) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }

    const series: SeriesNode[] = [];
    const rootInvested = rows.reduce((s, r) => s + r.invested, 0);
    const rootPnl = rows.reduce((s, r) => s + r.pnlUsd, 0);
    series.push({
      id: 'root',
      name: 'root',
      value: rootInvested,
      roi: rootInvested ? rootPnl / rootInvested : 0,
      depth: 0,
      index: 0,
    });

    let index = 1;
    for (const [cat, arr] of byCat.entries()) {
      const invested = arr.reduce((s, r) => s + r.invested, 0);
      const pnl = arr.reduce((s, r) => s + r.pnlUsd, 0);
      const roi = invested ? pnl / invested : 0;
      series.push({
        id: `root.${cat}`,
        name: cat,
        value: invested,
        roi,
        depth: 1,
        index: index++,
      });

      for (const r of arr) {
        series.push({
          id: `root.${cat}.${r.marketId}`,
          name: r.marketLabel,
          value: r.invested,
          roi: r.roi,
          depth: 2,
          index: index++,
          side: r.side,
        });
      }
    }
    return series;
  };

  const { seriesData, filteredCount } = useMemo(() => {
    if (!closedPositions || closedPositions.length === 0) {
      return { seriesData: [], filteredCount: 0 };
    }

    // Check if this is pre-aggregated bubble chart data (has positions_count field)
    const isPreAggregated = closedPositions[0] && 'positions_count' in closedPositions[0];

    let filteredPositions = closedPositions;

    // Only apply date filtering for non-aggregated data
    if (!isPreAggregated && selectedPeriod !== 999999) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - selectedPeriod);

      filteredPositions = closedPositions.filter((pos) => {
        const closedDate = pos.ts_close || pos.closed_at || pos.endDate || pos.ts_open;
        if (!closedDate) return true; // Include if no date (pre-aggregated)
        const betDate = new Date(closedDate);
        return betDate >= cutoffDate;
      });
    }

    if (filteredPositions.length === 0) {
      return { seriesData: [], filteredCount: 0 };
    }

    const rows: TradeRow[] = filteredPositions.map((pos) => {
      const title = pos.question || pos.title || pos.market || pos.slug || '';
      const pnl = pos.pnl_usd || pos.realizedPnl || pos.realized_pnl || pos.profit || 0;
      const invested = pos.cost_usd || (pos.avgPrice || pos.entry_price || pos.entryPrice || 0) * (pos.totalBought || pos.size || 1);
      const roi = pos.roi !== undefined ? pos.roi : (invested > 0 ? pnl / invested : 0);

      // Use category from API (enriched from Polymarket's category field) instead of keyword matching!
      const category = pos.category || 'Other';

      return {
        category,
        marketId: pos.market_id || pos.conditionId || pos.position_id || pos.tokenId || title,
        marketLabel: title,
        invested,
        pnlUsd: pnl,
        roi,
        side: (pos.side === 'YES' || pos.side === 'NO' ? pos.side : 'YES') as 'YES' | 'NO',
      };
    });

    const data = buildSeriesData(rows);

    // For pre-aggregated data, count is the total positions represented
    const totalCount = isPreAggregated
      ? filteredPositions.reduce((sum, pos) => sum + ((pos as any).positions_count || 1), 0)
      : filteredPositions.length;

    return { seriesData: data, filteredCount: totalCount };
  }, [closedPositions, selectedPeriod]);

  const option = useMemo(() => {
    if (seriesData.length === 0) {
      return {};
    }

    let displayRoot = stratify<SeriesNode>()
      .id((d) => d.id)
      .parentId((d) => {
        const i = d.id.lastIndexOf('.');
        return i < 0 ? null : d.id.slice(0, i);
      })(seriesData)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const overallLayout = (params: any, api: any) => {
      const ctx = params.context;
      pack<SeriesNode>()
        .size([api.getWidth() - 2, api.getHeight() - 2])
        .padding(4)(displayRoot as any);
      ctx.nodes = {};
      (displayRoot as any).descendants().forEach((n: any) => {
        ctx.nodes[n.id] = n;
      });
    };

    const renderItem = (params: any, api: any) => {
      const ctx = params.context;
      if (!ctx.layout) {
        ctx.layout = true;
        overallLayout(params, api);
      }
      const nodePath = api.value('id');
      const node = ctx.nodes[nodePath];
      if (!node) return;

      const isLeaf = !node.children || node.children.length === 0;
      const focus = new Uint32Array(
        node.descendants().map((n: any) => n.data.index)
      );

      const showLabel = node.r > 40 && node.depth === 1;
      const labelText = showLabel ? node.data.name : '';
      const baseZ2 = api.value('depth') * 2;

      const circleElement = {
        type: 'circle',
        focus: focus,
        shape: { cx: node.x, cy: node.y, r: node.r },
        transition: ['shape'],
        z2: baseZ2,
        style: {
          fill: api.visual('color'),
          stroke: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
          lineWidth: isLeaf ? 1 : 2,
        },
        emphasis: {
          style: {
            stroke: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.25)',
            lineWidth: 2,
            shadowBlur: 12,
            shadowColor: isDark ? 'rgba(0,224,170,0.3)' : 'rgba(0,0,0,0.15)',
          },
        },
      };

      if (showLabel) {
        return {
          type: 'group',
          children: [
            circleElement,
            {
              type: 'text',
              z2: 10000,
              style: {
                text: labelText,
                x: node.x,
                y: node.y,
                width: node.r * 1.6,
                overflow: 'truncate',
                fontSize: Math.max(12, node.r / 5),
                fill: '#ffffff',
                fontWeight: 'bold',
                textShadowColor: 'rgba(0, 0, 0, 0.8)',
                textShadowBlur: 4,
                textShadowOffsetX: 1,
                textShadowOffsetY: 1,
                align: 'center',
                verticalAlign: 'middle',
              },
            },
          ],
        };
      }

      return circleElement;
    };

    return {
      backgroundColor: 'transparent',
      dataset: { source: seriesData },
      tooltip: {
        confine: true,
        backgroundColor: isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        borderColor: isDark ? 'rgba(63, 63, 70, 0.5)' : 'rgba(228, 228, 231, 0.8)',
        borderWidth: 1,
        borderRadius: 8,
        padding: [12, 16],
        textStyle: {
          color: isDark ? '#fafafa' : '#18181b',
          fontSize: 13,
        },
        formatter: (p: any) => {
          const d = p.data;
          const sideDisplay = d.side ? `<div style="margin-top: 4px; font-size: 12px; color: ${isDark ? '#a1a1aa' : '#71717a'};">Side: <span style="color: ${d.side === 'YES' ? '#22c55e' : '#ef4444'}; font-weight: 600;">${d.side}</span></div>` : '';
          const roiColor = d.roi >= 0 ? '#22c55e' : '#ef4444';
          return `
            <div>
              <div style="font-weight: 600; margin-bottom: 8px; max-width: 200px; line-height: 1.3;">${d.name}</div>
              <div style="display: flex; justify-content: space-between; gap: 16px; font-size: 13px;">
                <span style="color: ${isDark ? '#a1a1aa' : '#71717a'};">Invested</span>
                <span style="font-weight: 600;">$${Math.round(d.value).toLocaleString()}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 16px; margin-top: 4px; font-size: 13px;">
                <span style="color: ${isDark ? '#a1a1aa' : '#71717a'};">ROI</span>
                <span style="color: ${roiColor}; font-weight: 600;">${d.roi >= 0 ? '+' : ''}${(d.roi * 100).toFixed(1)}%</span>
              </div>
              ${sideDisplay}
            </div>
          `;
        },
      },
      visualMap: {
        type: 'piecewise',
        dimension: 'roi',
        orient: 'horizontal',
        left: 'center',
        bottom: 8,
        itemWidth: 14,
        itemHeight: 14,
        itemGap: 6,
        pieces: [
          { min: 1, color: isDark ? 'rgba(34, 197, 94, 0.7)' : 'rgba(34, 197, 94, 0.6)', label: '>100%' },
          { min: 0.25, max: 1, color: isDark ? 'rgba(74, 222, 128, 0.7)' : 'rgba(74, 222, 128, 0.6)', label: '25-100%' },
          { min: 0, max: 0.25, color: isDark ? 'rgba(134, 239, 172, 0.6)' : 'rgba(187, 247, 208, 0.7)', label: '0-25%' },
          { min: -0.5, max: 0, color: isDark ? 'rgba(252, 165, 165, 0.6)' : 'rgba(254, 202, 202, 0.7)', label: '-50-0%' },
          { max: -0.5, color: isDark ? 'rgba(239, 68, 68, 0.7)' : 'rgba(248, 113, 113, 0.7)', label: '<-50%' },
        ],
        textStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 11,
        },
      },
      hoverLayerThreshold: Infinity,
      series: {
        type: 'custom',
        coordinateSystem: 'none',
        renderItem,
        encode: {
          tooltip: 'value',
          itemName: 'id',
        },
        progressive: 0,
      },
    };
  }, [seriesData, isDark]);

  const onChartReady = (chartInstance: any) => {
    chartRef.current = chartInstance;
    // Click handlers removed - no drill-down behavior
  };

  // Check if data is pre-aggregated (no date filtering possible)
  const isPreAggregated = closedPositions?.[0] && 'positions_count' in closedPositions[0];

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#00E0AA]/10">
            <Layers className="h-5 w-5 text-[#00E0AA]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Trading Activity</h2>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-4 w-4 text-muted-foreground/50" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">Bubble size represents invested USD. Color shows ROI performance from green (profit) to red (loss).</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-sm text-muted-foreground">
              Size = Invested | Color = ROI
            </p>
          </div>
        </div>
        {/* Only show time filters if data has individual dates (not pre-aggregated) */}
        {!isPreAggregated && (
          <div className="flex gap-2">
            {periods.map((period) => (
              <Button
                key={period.value}
                variant={selectedPeriod === period.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedPeriod(period.value)}
              >
                {period.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Chart Container */}
      {seriesData.length > 0 ? (
        <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden flex-1 flex flex-col">
          <div className="flex-1 flex flex-col lg:flex-row min-h-[300px]">
            {/* Bubble Chart */}
            <div className={`flex-1 p-2 pb-10 ${categoryStats && categoryStats.length > 0 ? 'lg:border-r lg:border-border/50' : ''}`}>
              <ReactECharts
                option={option}
                style={{ height: '100%', width: '100%' }}
                opts={{ renderer: 'canvas' }}
                onChartReady={onChartReady}
              />
            </div>

            {/* Category Stats Panel */}
            {categoryStats && categoryStats.length > 0 && (
              <div className="lg:w-[280px] p-4 flex flex-col border-t lg:border-t-0 border-border/50">
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">Performance by Category</h3>
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {categoryStats.map((category) => {
                    const winRate = category.win_rate * 100;
                    const pnlPositive = category.pnl_usd >= 0;
                    const colorClass = CATEGORY_COLORS[category.category] || CATEGORY_COLORS.Unknown;
                    const totalPositions = categoryStats.reduce((sum, c) => sum + c.positions, 0);
                    const percentage = totalPositions > 0 ? (category.positions / totalPositions) * 100 : 0;

                    return (
                      <div key={category.category} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${colorClass}`} />
                            <span className="text-sm font-medium">{category.category}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-0.5">
                              {winRate >= 55 ? (
                                <TrendingUp className="h-3 w-3 text-emerald-500" />
                              ) : winRate <= 45 ? (
                                <TrendingDown className="h-3 w-3 text-red-500" />
                              ) : (
                                <Minus className="h-3 w-3 text-amber-500" />
                              )}
                              <span className={`text-xs font-semibold ${
                                winRate >= 55 ? "text-emerald-500" : winRate <= 45 ? "text-red-500" : "text-amber-500"
                              }`}>
                                {winRate.toFixed(0)}%
                              </span>
                            </div>
                            <span className={`text-xs font-semibold ${pnlPositive ? "text-emerald-500" : "text-red-500"}`}>
                              {formatPnL(category.pnl_usd)}
                            </span>
                          </div>
                        </div>
                        <Progress value={percentage} className="h-1" />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground">
                  {categoryStats.length} categories
                </div>
              </div>
            )}
          </div>
          {/* Footer */}
          <div className="px-4 py-3 border-t border-border/50 bg-muted/30 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Hover over bubbles for details</span>
            <span className="font-medium text-muted-foreground">{filteredCount.toLocaleString()} positions</span>
          </div>
        </div>
      ) : (
        <div className="h-[300px] rounded-xl border border-border/50 bg-muted/20 flex items-center justify-center">
          <p className="text-muted-foreground">No trades found in the selected period</p>
        </div>
      )}
    </div>
  );
}
