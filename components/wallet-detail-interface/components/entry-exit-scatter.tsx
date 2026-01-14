// @ts-nocheck
'use client';

import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { TrendingUp, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ClosedPosition {
  question?: string;
  title?: string;
  market?: string;
  entry_price?: number;
  exit_price?: number;
  avgPrice?: number;
  entryPrice?: number;
  cost_usd?: number;
  pnl_usd?: number;
  realizedPnl?: number;
  roi?: number;
  side?: string;
  category?: string;
  image_url?: string | null;
}

interface EntryExitScatterProps {
  closedPositions: ClosedPosition[];
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

function formatPnL(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function EntryExitScatter({ closedPositions }: EntryExitScatterProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const { scatterData, stats } = useMemo(() => {
    if (!closedPositions || closedPositions.length === 0) {
      return { scatterData: [], stats: { wins: 0, losses: 0, totalPnl: 0 } };
    }

    let wins = 0;
    let losses = 0;
    let totalPnl = 0;

    const data = closedPositions
      .filter(pos => {
        const entry = pos.entry_price ?? pos.avgPrice ?? pos.entryPrice;
        const exit = pos.exit_price;
        return entry !== undefined && exit !== undefined && entry > 0;
      })
      .map(pos => {
        const entry = pos.entry_price ?? pos.avgPrice ?? pos.entryPrice ?? 0;
        const exit = pos.exit_price ?? 0;
        const size = pos.cost_usd ?? 100;
        const pnl = pos.pnl_usd ?? pos.realizedPnl ?? 0;
        const roi = pos.roi ?? (entry > 0 ? (exit - entry) / entry : 0);
        const isProfitable = pnl >= 0;

        if (isProfitable) wins++;
        else losses++;
        totalPnl += pnl;

        return {
          value: [entry, exit, size, pnl, roi],
          name: pos.question || pos.title || pos.market || 'Unknown',
          category: pos.category || 'Other',
          side: pos.side || 'YES',
          isProfitable,
          imageUrl: pos.image_url,
        };
      });

    return {
      scatterData: data,
      stats: { wins, losses, totalPnl }
    };
  }, [closedPositions]);

  const option = useMemo(() => {
    if (scatterData.length === 0) return {};

    // Calculate symbol sizes based on position size distribution
    const sizes = scatterData.map(d => d.value[2]);
    const maxSize = Math.max(...sizes);
    const minSize = Math.min(...sizes);

    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 800,
      grid: {
        left: 60,
        right: 30,
        top: 30,
        bottom: 50,
      },
      xAxis: {
        type: 'value',
        name: 'Entry Price',
        nameLocation: 'middle',
        nameGap: 35,
        nameTextStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 12,
          fontWeight: 500,
        },
        min: 0,
        max: 1,
        axisLabel: {
          formatter: (v: number) => `${(v * 100).toFixed(0)}¢`,
          color: isDark ? '#94a3b8' : '#64748b',
        },
        axisLine: {
          lineStyle: { color: isDark ? '#334155' : '#e2e8f0' },
        },
        splitLine: {
          lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9' },
        },
      },
      yAxis: {
        type: 'value',
        name: 'Exit Price',
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 12,
          fontWeight: 500,
        },
        min: 0,
        max: 1,
        axisLabel: {
          formatter: (v: number) => `${(v * 100).toFixed(0)}¢`,
          color: isDark ? '#94a3b8' : '#64748b',
        },
        axisLine: {
          lineStyle: { color: isDark ? '#334155' : '#e2e8f0' },
        },
        splitLine: {
          lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9' },
        },
      },
      // Diagonal breakeven line and gradient zones
      visualMap: {
        show: false,
        dimension: 3, // PnL
        min: -1000,
        max: 1000,
        inRange: {
          color: ['#ef4444', '#f97316', '#84cc16', '#22c55e'],
        },
      },
      graphic: [
        // Green gradient zone (above diagonal - profitable)
        {
          type: 'polygon',
          shape: {
            points: [[60, 30], [60, 350], [570, 30]].map(([x, y]) => [x, y]),
          },
          style: {
            fill: isDark
              ? 'rgba(34, 197, 94, 0.08)'
              : 'rgba(34, 197, 94, 0.12)',
          },
          z: -1,
        },
        // Red gradient zone (below diagonal - loss)
        {
          type: 'polygon',
          shape: {
            points: [[60, 350], [570, 350], [570, 30]].map(([x, y]) => [x, y]),
          },
          style: {
            fill: isDark
              ? 'rgba(239, 68, 68, 0.08)'
              : 'rgba(239, 68, 68, 0.12)',
          },
          z: -1,
        },
      ],
      // Breakeven diagonal line
      series: [
        // Diagonal line
        {
          type: 'line',
          data: [[0, 0], [1, 1]],
          lineStyle: {
            color: isDark ? '#475569' : '#94a3b8',
            width: 2,
            type: 'dashed',
          },
          symbol: 'none',
          z: 1,
        },
        // Scatter points
        {
          type: 'scatter',
          data: scatterData.map(d => ({
            value: [d.value[0], d.value[1]],
            name: d.name,
            category: d.category,
            side: d.side,
            size: d.value[2],
            pnl: d.value[3],
            roi: d.value[4],
            isProfitable: d.isProfitable,
            imageUrl: d.imageUrl,
          })),
          symbolSize: (data: any) => {
            const size = data.size || 100;
            const normalized = maxSize > minSize
              ? (size - minSize) / (maxSize - minSize)
              : 0.5;
            return Math.max(8, Math.min(40, 8 + normalized * 32));
          },
          itemStyle: {
            color: (params: any) => {
              const isProfitable = params.data.isProfitable;
              return isProfitable
                ? (isDark ? 'rgba(34, 197, 94, 0.6)' : 'rgba(34, 197, 94, 0.7)')
                : (isDark ? 'rgba(239, 68, 68, 0.6)' : 'rgba(239, 68, 68, 0.7)');
            },
            borderColor: (params: any) => {
              return params.data.isProfitable
                ? (isDark ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.4)')
                : (isDark ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.4)');
            },
            borderWidth: 1,
          },
          emphasis: {
            itemStyle: {
              borderColor: '#fff',
              borderWidth: 2,
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.3)',
            },
          },
          z: 2,
        },
      ],
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        borderColor: isDark ? 'rgba(63, 63, 70, 0.5)' : 'rgba(228, 228, 231, 0.8)',
        borderWidth: 1,
        borderRadius: 8,
        padding: [12, 16],
        textStyle: {
          color: isDark ? '#fafafa' : '#18181b',
          fontSize: 12,
        },
        formatter: (params: any) => {
          if (!params.data || params.seriesType === 'line') return '';
          const d = params.data;
          const entry = d.value[0];
          const exit = d.value[1];
          const pnlColor = d.isProfitable ? '#22c55e' : '#ef4444';

          return `
            <div style="min-width: 200px; max-width: 280px;">
              <div style="font-weight: 600; margin-bottom: 8px; line-height: 1.4;">${d.name}</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Entry</span>
                <span style="font-weight: 600;">${(entry * 100).toFixed(0)}¢</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Exit</span>
                <span style="font-weight: 600;">${(exit * 100).toFixed(0)}¢</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Size</span>
                <span style="font-weight: 600;">${formatCurrency(d.size)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">P&L</span>
                <span style="font-weight: 600; color: ${pnlColor};">${formatPnL(d.pnl)}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">ROI</span>
                <span style="font-weight: 600; color: ${pnlColor};">${d.roi >= 0 ? '+' : ''}${(d.roi * 100).toFixed(1)}%</span>
              </div>
            </div>
          `;
        },
      },
    };
  }, [scatterData, isDark]);

  if (scatterData.length === 0) {
    return null;
  }

  const winRate = stats.wins + stats.losses > 0
    ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(0)
    : '0';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#00E0AA]/10">
            <TrendingUp className="h-5 w-5 text-[#00E0AA]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Entry vs Exit Analysis</h2>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-4 w-4 text-muted-foreground/50" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">Trades above the diagonal line are profitable (sold higher than bought). Below the line are losses. Bubble size = position size.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-sm text-muted-foreground">
              {scatterData.length} closed positions • {winRate}% win rate
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
            <span className="text-muted-foreground">Wins:</span>
            <span className="font-semibold text-emerald-500">{stats.wins}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/60" />
            <span className="text-muted-foreground">Losses:</span>
            <span className="font-semibold text-red-500">{stats.losses}</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden">
        <ReactECharts
          option={option}
          style={{ height: 400, width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge={true}
        />

        {/* Legend */}
        <div className="px-4 py-3 border-t border-border/50 bg-muted/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">
              <span className="inline-block w-3 h-3 rounded-sm mr-1.5" style={{ background: 'rgba(34, 197, 94, 0.3)' }} />
              Above line = Profit
            </span>
            <span className="text-muted-foreground">
              <span className="inline-block w-3 h-3 rounded-sm mr-1.5" style={{ background: 'rgba(239, 68, 68, 0.3)' }} />
              Below line = Loss
            </span>
            <span className="text-muted-foreground">
              Bubble size = Trade value
            </span>
          </div>
          <span className={`font-medium ${stats.totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            Total P&L: {formatPnL(stats.totalPnl)}
          </span>
        </div>
      </div>
    </div>
  );
}
