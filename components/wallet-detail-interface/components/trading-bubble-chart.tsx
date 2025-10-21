'use client';

import { useState, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { stratify, pack } from 'd3-hierarchy';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import type { FinishedBet } from '../types';

interface TradingBubbleChartProps {
  finishedBets: FinishedBet[];
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

export function TradingBubbleChart({ finishedBets }: TradingBubbleChartProps) {
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
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - selectedPeriod);

    const filteredBets = finishedBets.filter((bet) => {
      const betDate = new Date(bet.closed_date);
      return selectedPeriod === 999999 || betDate >= cutoffDate;
    });

    if (filteredBets.length === 0) {
      return { seriesData: [], filteredCount: 0 };
    }

    const rows: TradeRow[] = filteredBets.map((bet) => ({
      category: bet.category,
      marketId: bet.position_id,
      marketLabel: bet.market_title,
      invested: bet.invested,
      pnlUsd: bet.realized_pnl,
      roi: bet.roi / 100,
      side: bet.side,
    }));

    const data = buildSeriesData(rows);

    return { seriesData: data, filteredCount: filteredBets.length };
  }, [finishedBets, selectedPeriod]);

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
          stroke: isDark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.4)',
          lineWidth: 1,
        },
        emphasis: {
          style: {
            shadowBlur: 18,
            shadowColor: isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.2)',
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
      backgroundColor: isDark ? '#0b1220' : '#f8fafc',
      dataset: { source: seriesData },
      tooltip: {
        confine: true,
        formatter: (p: any) => {
          const d = p.data;
          const sideDisplay = d.side ? `<br/>Side: <strong>${d.side}</strong>` : '';
          return `
            <div style="padding: 8px;">
              <strong>${d.name}</strong>${sideDisplay}<br/>
              Invested: $${Math.round(d.value).toLocaleString()}<br/>
              ROI: <span style="color: ${d.roi >= 0 ? '#22c55e' : '#ef4444'}; font-weight: bold;">
                ${(d.roi * 100).toFixed(1)}%
              </span>
            </div>
          `;
        },
      },
      visualMap: {
        type: 'piecewise',
        dimension: 'roi',
        left: 10,
        bottom: 10,
        pieces: [
          { min: 4, color: isDark ? '#065f46' : '#14532d', label: '>400%' },
          { min: 2, max: 4, color: isDark ? '#16a34a' : '#16a34a', label: '200-400%' },
          { min: 1, max: 2, color: isDark ? '#22c55e' : '#22c55e', label: '100-200%' },
          { min: 0.5, max: 1, color: isDark ? '#4ade80' : '#4ade80', label: '50-100%' },
          { min: 0.1, max: 0.5, color: isDark ? '#86efac' : '#86efac', label: '10-50%' },
          { min: 0, max: 0.1, color: isDark ? '#d1fae5' : '#d1fae5', label: '0-10%' },
          { min: -0.5, max: 0, color: isDark ? '#fca5a5' : '#fca5a5', label: '-50-0%' },
          { min: -1, max: -0.5, color: isDark ? '#dc2626' : '#ef4444', label: '-100 to -50%' },
          { max: -1, color: isDark ? '#7f1d1d' : '#991b1b', label: '-100%' },
        ],
        textStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-semibold">Trading Activity Bubble Map</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Categories contain trades | Size = Invested USD | Color = ROI profitability
          </p>
        </div>
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
      </div>
      {seriesData.length > 0 ? (
        <>
          <div className="h-[620px] rounded-lg overflow-hidden">
            <ReactECharts
              option={option}
              style={{ height: '100%', width: '100%' }}
              opts={{ renderer: 'canvas' }}
              onChartReady={onChartReady}
            />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-4 text-sm">
            <p className="text-muted-foreground">
              Hover over bubbles to see trade details
            </p>
            <span className="text-muted-foreground">{filteredCount} trades shown</span>
          </div>
        </>
      ) : (
        <div className="h-[620px] bg-slate-100 dark:bg-slate-950 rounded-lg p-4 flex items-center justify-center">
          <p className="text-muted-foreground">No trades found in the selected period</p>
        </div>
      )}
    </div>
  );
}
