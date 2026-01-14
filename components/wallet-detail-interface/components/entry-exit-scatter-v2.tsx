// @ts-nocheck
'use client';

import { useMemo, useRef, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { Target, TrendingUp, TrendingDown } from 'lucide-react';

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
}

interface EntryExitScatterV2Props {
  closedPositions: ClosedPosition[];
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `$${(abs / 1000).toFixed(1)}k`;
  return `$${abs.toFixed(0)}`;
}

function formatPnL(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? '+' : '-';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function EntryExitScatterV2({ closedPositions }: EntryExitScatterV2Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const chartRef = useRef<any>(null);

  const { scatterData, stats } = useMemo(() => {
    if (!closedPositions || closedPositions.length === 0) {
      return { scatterData: [], stats: { wins: 0, losses: 0, totalPnl: 0, avgWinRoi: 0, avgLossRoi: 0 } };
    }

    let wins = 0;
    let losses = 0;
    let totalPnl = 0;
    let totalWinRoi = 0;
    let totalLossRoi = 0;

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

        if (isProfitable) {
          wins++;
          totalWinRoi += roi;
        } else {
          losses++;
          totalLossRoi += roi;
        }
        totalPnl += pnl;

        return {
          entry,
          exit,
          size,
          pnl,
          roi,
          isProfitable,
          name: pos.question || pos.title || pos.market || 'Unknown',
          category: pos.category || 'Other',
          side: pos.side || 'YES',
        };
      });

    return {
      scatterData: data,
      stats: {
        wins,
        losses,
        totalPnl,
        avgWinRoi: wins > 0 ? totalWinRoi / wins : 0,
        avgLossRoi: losses > 0 ? totalLossRoi / losses : 0,
      }
    };
  }, [closedPositions]);

  // Calculate bubble size range based on position sizes
  const { minSize, maxSize } = useMemo(() => {
    if (scatterData.length === 0) return { minSize: 0, maxSize: 1 };
    const sizes = scatterData.map(d => d.size);
    return {
      minSize: Math.min(...sizes),
      maxSize: Math.max(...sizes),
    };
  }, [scatterData]);

  const getBubbleSize = useCallback((size: number) => {
    if (maxSize === minSize) return 20;
    const normalized = (size - minSize) / (maxSize - minSize);
    // Exponential scaling for better visual differentiation
    return Math.max(10, Math.min(55, 10 + Math.pow(normalized, 0.6) * 45));
  }, [minSize, maxSize]);

  const option = useMemo(() => {
    if (scatterData.length === 0) return {};

    // Colors
    const profitColor = '#10b981';
    const lossColor = '#ef4444';
    const profitBg = isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.06)';
    const lossBg = isDark ? 'rgba(239, 68, 68, 0.08)' : 'rgba(239, 68, 68, 0.06)';
    const lineColor = isDark ? 'rgba(148, 163, 184, 0.4)' : 'rgba(100, 116, 139, 0.3)';
    const gridColor = isDark ? 'rgba(51, 65, 85, 0.3)' : 'rgba(226, 232, 240, 0.8)';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 600,
      animationEasing: 'cubicOut',
      grid: {
        left: 55,
        right: 25,
        top: 25,
        bottom: 55,
        containLabel: false,
      },
      xAxis: {
        type: 'value',
        name: 'Entry Price',
        nameLocation: 'middle',
        nameGap: 38,
        nameTextStyle: {
          color: textColor,
          fontSize: 12,
          fontWeight: 500,
        },
        min: 0,
        max: 1,
        interval: 0.2,
        axisLabel: {
          formatter: (v: number) => `${(v * 100).toFixed(0)}¢`,
          color: textColor,
          fontSize: 11,
        },
        axisLine: {
          show: true,
          lineStyle: { color: gridColor, width: 1 },
        },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: { color: gridColor, width: 1, type: 'solid' },
        },
      },
      yAxis: {
        type: 'value',
        name: 'Exit Price',
        nameLocation: 'middle',
        nameGap: 42,
        nameTextStyle: {
          color: textColor,
          fontSize: 12,
          fontWeight: 500,
        },
        min: 0,
        max: 1,
        interval: 0.2,
        axisLabel: {
          formatter: (v: number) => `${(v * 100).toFixed(0)}¢`,
          color: textColor,
          fontSize: 11,
        },
        axisLine: {
          show: true,
          lineStyle: { color: gridColor, width: 1 },
        },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: { color: gridColor, width: 1, type: 'solid' },
        },
      },
      series: [
        // Profit zone (above diagonal) - using polygon with data coordinates
        {
          type: 'custom',
          renderItem: (params: any, api: any) => {
            // Convert data coordinates to pixel coordinates
            const p1 = api.coord([0, 0]);
            const p2 = api.coord([0, 1]);
            const p3 = api.coord([1, 1]);

            return {
              type: 'polygon',
              shape: {
                points: [p1, p2, p3],
              },
              style: {
                fill: profitBg,
              },
              z: -2,
            };
          },
          data: [0], // dummy data to trigger render
          silent: true,
        },
        // Loss zone (below diagonal)
        {
          type: 'custom',
          renderItem: (params: any, api: any) => {
            const p1 = api.coord([0, 0]);
            const p2 = api.coord([1, 1]);
            const p3 = api.coord([1, 0]);

            return {
              type: 'polygon',
              shape: {
                points: [p1, p2, p3],
              },
              style: {
                fill: lossBg,
              },
              z: -2,
            };
          },
          data: [0],
          silent: true,
        },
        // Breakeven diagonal line
        {
          type: 'line',
          data: [[0, 0], [1, 1]],
          lineStyle: {
            color: lineColor,
            width: 2,
            type: 'dashed',
          },
          symbol: 'none',
          silent: true,
          z: 0,
        },
        // Scatter points - Losses (render first, behind wins)
        {
          type: 'scatter',
          name: 'Losses',
          data: scatterData
            .filter(d => !d.isProfitable)
            .map(d => ({
              value: [d.entry, d.exit, d.size],
              ...d,
            })),
          symbolSize: (value: any) => getBubbleSize(value[2] || 100),
          itemStyle: {
            color: isDark ? 'rgba(239, 68, 68, 0.2)' : 'rgba(239, 68, 68, 0.25)',
            borderColor: isDark ? 'rgba(239, 68, 68, 0.7)' : 'rgba(239, 68, 68, 0.8)',
            borderWidth: 1.5,
          },
          emphasis: {
            scale: 1.15,
            itemStyle: {
              color: isDark ? 'rgba(239, 68, 68, 0.45)' : 'rgba(239, 68, 68, 0.5)',
              borderColor: lossColor,
              borderWidth: 2.5,
              shadowBlur: 12,
              shadowColor: 'rgba(239, 68, 68, 0.4)',
            },
          },
          z: 1,
        },
        // Scatter points - Wins (render on top)
        {
          type: 'scatter',
          name: 'Wins',
          data: scatterData
            .filter(d => d.isProfitable)
            .map(d => ({
              value: [d.entry, d.exit, d.size],
              ...d,
            })),
          symbolSize: (value: any) => getBubbleSize(value[2] || 100),
          itemStyle: {
            color: isDark ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.25)',
            borderColor: isDark ? 'rgba(16, 185, 129, 0.7)' : 'rgba(16, 185, 129, 0.8)',
            borderWidth: 1.5,
          },
          emphasis: {
            scale: 1.15,
            itemStyle: {
              color: isDark ? 'rgba(16, 185, 129, 0.45)' : 'rgba(16, 185, 129, 0.5)',
              borderColor: profitColor,
              borderWidth: 2.5,
              shadowBlur: 12,
              shadowColor: 'rgba(16, 185, 129, 0.4)',
            },
          },
          z: 2,
        },
      ],
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.98)',
        borderColor: isDark ? 'rgba(51, 65, 85, 0.6)' : 'rgba(226, 232, 240, 1)',
        borderWidth: 1,
        borderRadius: 12,
        padding: [14, 18],
        extraCssText: 'box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);',
        textStyle: {
          color: isDark ? '#f1f5f9' : '#1e293b',
          fontSize: 12,
        },
        formatter: (params: any) => {
          if (!params.data || params.seriesType !== 'scatter') return '';
          const d = params.data;
          const pnlColor = d.isProfitable ? profitColor : lossColor;
          const roiFormatted = `${d.roi >= 0 ? '+' : ''}${(d.roi * 100).toFixed(1)}%`;

          return `
            <div style="min-width: 220px;">
              <div style="font-weight: 600; font-size: 13px; margin-bottom: 12px; line-height: 1.4; color: ${isDark ? '#f8fafc' : '#0f172a'};">
                ${d.name}
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px;">
                <div>
                  <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: ${isDark ? '#64748b' : '#94a3b8'}; margin-bottom: 2px;">Entry</div>
                  <div style="font-weight: 600; font-size: 14px;">${(d.entry * 100).toFixed(0)}¢</div>
                </div>
                <div>
                  <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: ${isDark ? '#64748b' : '#94a3b8'}; margin-bottom: 2px;">Exit</div>
                  <div style="font-weight: 600; font-size: 14px;">${(d.exit * 100).toFixed(0)}¢</div>
                </div>
                <div>
                  <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: ${isDark ? '#64748b' : '#94a3b8'}; margin-bottom: 2px;">Size</div>
                  <div style="font-weight: 600; font-size: 14px;">${formatCurrency(d.size)}</div>
                </div>
                <div>
                  <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: ${isDark ? '#64748b' : '#94a3b8'}; margin-bottom: 2px;">ROI</div>
                  <div style="font-weight: 600; font-size: 14px; color: ${pnlColor};">${roiFormatted}</div>
                </div>
              </div>
              <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid ${isDark ? 'rgba(51, 65, 85, 0.5)' : 'rgba(226, 232, 240, 1)'};">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 11px; color: ${isDark ? '#64748b' : '#94a3b8'};">P&L</span>
                  <span style="font-weight: 700; font-size: 16px; color: ${pnlColor};">${formatPnL(d.pnl)}</span>
                </div>
              </div>
            </div>
          `;
        },
      },
    };
  }, [scatterData, isDark, getBubbleSize]);

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
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 rounded-xl blur-lg" />
            <div className="relative p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20">
              <Target className="h-5 w-5 text-emerald-500" />
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Trade Execution Analysis</h2>
            <p className="text-sm text-muted-foreground">
              {scatterData.length} recent positions
            </p>
          </div>
        </div>

        {/* Stats Pills */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-sm font-semibold text-emerald-500">{stats.wins}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
            <TrendingDown className="h-3.5 w-3.5 text-red-500" />
            <span className="text-sm font-semibold text-red-500">{stats.losses}</span>
          </div>
          <div className="px-3 py-1.5 rounded-full bg-muted/50 border border-border/50">
            <span className="text-sm font-semibold">{winRate}%</span>
          </div>
        </div>
      </div>

      {/* Chart Container */}
      <div className="relative rounded-2xl border border-border/50 bg-gradient-to-b from-muted/30 to-muted/10 overflow-hidden">
        {/* Chart */}
        <div className="p-4">
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: 320, width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge={true}
          />
        </div>

        {/* Bottom Stats Bar */}
        <div className="px-5 py-4 border-t border-border/50 bg-muted/20">
          <div className="flex items-center justify-between">
            {/* Legend */}
            <div className="flex items-center gap-6 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30" />
                <span className="text-muted-foreground">Profitable trades</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500 shadow-lg shadow-red-500/30" />
                <span className="text-muted-foreground">Losing trades</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
                </svg>
                <span>Bubble size = Position size</span>
              </div>
            </div>

            {/* Total P&L */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Total P&L</span>
              <div className={`px-4 py-1.5 rounded-lg font-bold text-lg ${
                stats.totalPnl >= 0
                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                  : 'bg-red-500/10 text-red-500 border border-red-500/20'
              }`}>
                {formatPnL(stats.totalPnl)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
