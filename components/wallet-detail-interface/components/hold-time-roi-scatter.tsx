// @ts-nocheck
'use client';

import { useMemo, useState, useEffect } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { Clock, Info } from 'lucide-react';
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
  hold_minutes?: number;
  holdMinutes?: number;
  roi?: number;
  pnl_usd?: number;
  realizedPnl?: number;
  cost_usd?: number;
  side?: string;
  category?: string;
}

interface HoldTimeRoiScatterProps {
  closedPositions: ClosedPosition[];
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

export function HoldTimeRoiScatter({ closedPositions }: HoldTimeRoiScatterProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [mounted, setMounted] = useState(false);

  // Prevent SSR/hydration issues with ECharts tooltips
  useEffect(() => {
    setMounted(true);
  }, []);

  const { scatterData, stats } = useMemo(() => {
    if (!closedPositions || closedPositions.length === 0) {
      return { scatterData: [], stats: { avgHoldWin: 0, avgHoldLoss: 0, correlation: 0 } };
    }

    const holdWins: number[] = [];
    const holdLosses: number[] = [];

    const data = closedPositions
      .filter(pos => {
        const holdTime = pos.hold_minutes ?? pos.holdMinutes;
        return holdTime !== undefined && holdTime > 0;
      })
      .map(pos => {
        const holdTime = pos.hold_minutes ?? pos.holdMinutes ?? 0;
        const roi = pos.roi ?? 0;
        const pnl = pos.pnl_usd ?? pos.realizedPnl ?? 0;
        const size = pos.cost_usd ?? 100;
        const isProfitable = pnl >= 0;

        if (isProfitable) holdWins.push(holdTime);
        else holdLosses.push(holdTime);

        return {
          value: [holdTime, roi * 100, size, pnl],
          name: pos.question || pos.title || pos.market || 'Unknown',
          category: pos.category || 'Other',
          side: pos.side || 'YES',
          isProfitable,
        };
      });

    const avgHoldWin = holdWins.length > 0
      ? holdWins.reduce((a, b) => a + b, 0) / holdWins.length
      : 0;
    const avgHoldLoss = holdLosses.length > 0
      ? holdLosses.reduce((a, b) => a + b, 0) / holdLosses.length
      : 0;

    return {
      scatterData: data,
      stats: { avgHoldWin, avgHoldLoss, correlation: 0 }
    };
  }, [closedPositions]);

  const option = useMemo(() => {
    if (scatterData.length === 0) return {};

    const sizes = scatterData.map(d => d.value[2]);
    const maxSize = Math.max(...sizes);
    const minSize = Math.min(...sizes);

    const holdTimes = scatterData.map(d => d.value[0]);
    const maxHold = Math.max(...holdTimes);

    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 800,
      grid: {
        left: 70,
        right: 30,
        top: 30,
        bottom: 50,
      },
      xAxis: {
        type: 'log',
        name: 'Hold Time',
        nameLocation: 'middle',
        nameGap: 35,
        nameTextStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 12,
          fontWeight: 500,
        },
        min: 1,
        axisLabel: {
          formatter: (v: number) => formatDuration(v),
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
        name: 'ROI (%)',
        nameLocation: 'middle',
        nameGap: 50,
        nameTextStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
          fontSize: 12,
          fontWeight: 500,
        },
        axisLabel: {
          formatter: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`,
          color: isDark ? '#94a3b8' : '#64748b',
        },
        axisLine: {
          lineStyle: { color: isDark ? '#334155' : '#e2e8f0' },
        },
        splitLine: {
          lineStyle: { color: isDark ? '#1e293b' : '#f1f5f9' },
        },
      },
      // Zero line for ROI
      markLine: {
        silent: true,
        data: [{ yAxis: 0 }],
        lineStyle: {
          color: isDark ? '#475569' : '#94a3b8',
          type: 'dashed',
        },
        label: { show: false },
      },
      series: [
        {
          type: 'scatter',
          data: scatterData.map(d => ({
            value: [d.value[0], d.value[1]],
            name: d.name,
            category: d.category,
            side: d.side,
            size: d.value[2],
            pnl: d.value[3],
            roi: d.value[1],
            isProfitable: d.isProfitable,
          })),
          symbolSize: (data: any) => {
            const size = data.size || 100;
            const normalized = maxSize > minSize
              ? (size - minSize) / (maxSize - minSize)
              : 0.5;
            return Math.max(12, Math.min(45, 12 + normalized * 33));
          },
          itemStyle: {
            color: (params: any) => {
              const isProfitable = params.data.isProfitable;
              return isProfitable
                ? (isDark ? 'rgba(34, 197, 94, 0.75)' : 'rgba(34, 197, 94, 0.8)')
                : (isDark ? 'rgba(239, 68, 68, 0.75)' : 'rgba(239, 68, 68, 0.8)');
            },
            borderColor: (params: any) => {
              return params.data.isProfitable
                ? (isDark ? 'rgba(34, 197, 94, 0.9)' : 'rgba(34, 197, 94, 1)')
                : (isDark ? 'rgba(239, 68, 68, 0.9)' : 'rgba(239, 68, 68, 1)');
            },
            borderWidth: 1.5,
          },
          emphasis: {
            itemStyle: {
              borderColor: '#fff',
              borderWidth: 2,
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.3)',
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
        trigger: 'item',
        confine: true,
        appendToBody: true,
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
          if (!params || !params.data) return '';
          const d = params.data;
          const holdTime = d.value[0];
          const roi = d.roi;
          const pnlColor = d.isProfitable ? '#22c55e' : '#ef4444';

          return `
            <div style="min-width: 200px; max-width: 280px;">
              <div style="font-weight: 600; margin-bottom: 8px; line-height: 1.4;">${d.name}</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Hold Time</span>
                <span style="font-weight: 600;">${formatDuration(holdTime)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">ROI</span>
                <span style="font-weight: 600; color: ${pnlColor};">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Size</span>
                <span style="font-weight: 600;">${formatCurrency(d.size)}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">P&L</span>
                <span style="font-weight: 600; color: ${pnlColor};">${d.pnl >= 0 ? '+' : ''}${formatCurrency(d.pnl)}</span>
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Clock className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Hold Time vs Returns</h2>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-4 w-4 text-muted-foreground/50" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-sm">Analyze whether holding positions longer leads to better returns. Each bubble represents a position.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-sm text-muted-foreground">
              {scatterData.length} recent positions
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Avg hold (wins):</span>
            <span className="ml-2 font-semibold text-emerald-500">{formatDuration(stats.avgHoldWin)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Avg hold (losses):</span>
            <span className="ml-2 font-semibold text-red-500">{formatDuration(stats.avgHoldLoss)}</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden">
        {mounted ? (
          <ReactECharts
            option={option}
            style={{ height: 320, width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge={true}
          />
        ) : (
          <div className="h-[320px] flex items-center justify-center text-muted-foreground">Loading...</div>
        )}

        {/* Legend */}
        <div className="px-4 py-3 border-t border-border/50 bg-muted/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">
              <span className="inline-block w-3 h-3 rounded-full mr-1.5 bg-emerald-500/60" />
              Profitable
            </span>
            <span className="text-muted-foreground">
              <span className="inline-block w-3 h-3 rounded-full mr-1.5 bg-red-500/60" />
              Loss
            </span>
            <span className="text-muted-foreground">
              Bubble size = Position size
            </span>
          </div>
          <span className="text-muted-foreground">
            X-axis uses log scale for better distribution
          </span>
        </div>
      </div>
    </div>
  );
}
