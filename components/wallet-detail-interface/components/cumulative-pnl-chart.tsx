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
  ts_close?: string | null;
  ts_open?: string;
  ts_resolve?: string | null;
  closed_at?: string;
  endDate?: string;
  pnl_usd?: number;
  realizedPnl?: number;
  cost_usd?: number;
}

interface CumulativePnlChartProps {
  closedPositions: ClosedPosition[];
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '' : '-';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPnL(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function CumulativePnlChart({ closedPositions }: CumulativePnlChartProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const { chartData, stats } = useMemo(() => {
    if (!closedPositions || closedPositions.length === 0) {
      return { chartData: [], stats: { totalPnl: 0, maxPnl: 0, minPnl: 0, maxDrawdown: 0 } };
    }

    // Helper to get the best date for a position
    // Priority: ts_close (if not empty) > ts_resolve > closed_at > endDate > ts_open
    const getPositionDate = (pos: ClosedPosition): string | null => {
      // ts_close from ClickHouse can be empty string for NULL
      if (pos.ts_close && pos.ts_close.length > 0) return pos.ts_close;
      if (pos.ts_resolve && pos.ts_resolve.length > 0) return pos.ts_resolve;
      if (pos.closed_at) return pos.closed_at;
      if (pos.endDate) return pos.endDate;
      if (pos.ts_open) return pos.ts_open;
      return null;
    };

    // Sort by close/resolve date
    const sorted = [...closedPositions]
      .filter(pos => {
        const date = getPositionDate(pos);
        return date && (pos.pnl_usd !== undefined || pos.realizedPnl !== undefined);
      })
      .sort((a, b) => {
        const dateA = new Date(getPositionDate(a) || 0);
        const dateB = new Date(getPositionDate(b) || 0);
        return dateA.getTime() - dateB.getTime();
      });

    if (sorted.length === 0) {
      return { chartData: [], stats: { totalPnl: 0, maxPnl: 0, minPnl: 0, maxDrawdown: 0 } };
    }

    let cumulative = 0;
    let maxPnl = 0;
    let minPnl = 0;
    let peak = 0;
    let maxDrawdown = 0;

    const data = sorted.map((pos, index) => {
      const pnl = pos.pnl_usd ?? pos.realizedPnl ?? 0;
      cumulative += pnl;

      if (cumulative > maxPnl) maxPnl = cumulative;
      if (cumulative < minPnl) minPnl = cumulative;

      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      const date = new Date(getPositionDate(pos) || 0);

      return {
        date: date.toISOString(),
        value: cumulative,
        pnl: pnl,
        name: pos.question || pos.title || 'Unknown',
        tradeNum: index + 1,
      };
    });

    return {
      chartData: data,
      stats: {
        totalPnl: cumulative,
        maxPnl,
        minPnl,
        maxDrawdown,
      }
    };
  }, [closedPositions]);

  const option = useMemo(() => {
    if (chartData.length === 0) return {};

    const dates = chartData.map(d => d.date);
    const values = chartData.map(d => d.value);

    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 1000,
      grid: {
        left: 70,
        right: 30,
        top: 20,
        bottom: 50,
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: {
          formatter: (v: string) => {
            const date = new Date(v);
            return `${date.getMonth() + 1}/${date.getDate()}`;
          },
          color: isDark ? '#94a3b8' : '#64748b',
          interval: Math.max(0, Math.floor(dates.length / 8)),
        },
        axisLine: {
          lineStyle: { color: isDark ? '#334155' : '#e2e8f0' },
        },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (v: number) => formatCurrency(v),
          color: isDark ? '#94a3b8' : '#64748b',
        },
        axisLine: { show: false },
        splitLine: {
          lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9' },
        },
      },
      series: [
        {
          type: 'line',
          data: chartData.map(d => ({
            value: d.value,
            name: d.name,
            pnl: d.pnl,
            tradeNum: d.tradeNum,
            date: d.date,
          })),
          smooth: 0.3,
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: chartData.length < 50,
          lineStyle: {
            width: 3,
            color: stats.totalPnl >= 0
              ? (isDark ? '#22c55e' : '#16a34a')
              : (isDark ? '#ef4444' : '#dc2626'),
          },
          itemStyle: {
            color: stats.totalPnl >= 0
              ? (isDark ? '#22c55e' : '#16a34a')
              : (isDark ? '#ef4444' : '#dc2626'),
            borderColor: '#fff',
            borderWidth: 2,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: stats.totalPnl >= 0
                ? [
                    { offset: 0, color: isDark ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.2)' },
                    { offset: 1, color: isDark ? 'rgba(34, 197, 94, 0.02)' : 'rgba(34, 197, 94, 0.02)' },
                  ]
                : [
                    { offset: 0, color: isDark ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.2)' },
                    { offset: 1, color: isDark ? 'rgba(239, 68, 68, 0.02)' : 'rgba(239, 68, 68, 0.02)' },
                  ],
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ yAxis: 0 }],
            lineStyle: {
              color: isDark ? '#475569' : '#94a3b8',
              type: 'dashed',
              width: 1,
            },
            label: { show: false },
          },
        },
      ],
      tooltip: {
        trigger: 'axis',
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
          const p = params[0];
          if (!p || !p.data) return '';
          const d = p.data;
          const date = new Date(d.date);
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const pnlColor = d.pnl >= 0 ? '#22c55e' : '#ef4444';
          const cumColor = d.value >= 0 ? '#22c55e' : '#ef4444';

          return `
            <div style="min-width: 180px;">
              <div style="font-weight: 600; margin-bottom: 8px;">${dateStr}</div>
              <div style="font-size: 11px; color: ${isDark ? '#71717a' : '#a1a1aa'}; margin-bottom: 8px; line-height: 1.4;">${d.name}</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Trade P&L</span>
                <span style="font-weight: 600; color: ${pnlColor};">${formatPnL(d.pnl)}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Cumulative</span>
                <span style="font-weight: 600; color: ${cumColor};">${formatPnL(d.value)}</span>
              </div>
              <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid ${isDark ? '#27272a' : '#e4e4e7'};">
                <span style="color: ${isDark ? '#71717a' : '#a1a1aa'}; font-size: 11px;">Trade #${d.tradeNum}</span>
              </div>
            </div>
          `;
        },
      },
    };
  }, [chartData, stats, isDark]);

  if (chartData.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${stats.totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
            <TrendingUp className={`h-5 w-5 ${stats.totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">P&L Over Time</h2>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-4 w-4 text-muted-foreground/50" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">Track cumulative profit and loss over time. Each point represents a closed position.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-sm text-muted-foreground">
              {chartData.length} recent positions
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Peak:</span>
            <span className="ml-2 font-semibold text-emerald-500">{formatPnL(stats.maxPnl)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Max Drawdown:</span>
            <span className="ml-2 font-semibold text-red-500">-{formatCurrency(stats.maxDrawdown)}</span>
          </div>
          <div className={`px-3 py-1 rounded-full ${stats.totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
            <span className={`font-semibold ${stats.totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {formatPnL(stats.totalPnl)}
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden">
        <ReactECharts
          option={option}
          style={{ height: 300, width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge={true}
        />
      </div>
    </div>
  );
}
