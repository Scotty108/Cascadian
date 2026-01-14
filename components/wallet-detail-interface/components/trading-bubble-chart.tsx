// @ts-nocheck
'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { stratify, pack, treemap, hierarchy } from 'd3-hierarchy';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import {
  Layers, Info, TrendingUp, TrendingDown, Minus,
  Circle, LayoutGrid, BarChart3, List, ExternalLink, X
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

interface ClosedPosition {
  title?: string
  slug?: string
  market?: string
  question?: string
  realizedPnl?: number
  realized_pnl?: number
  profit?: number
  pnl_usd?: number
  avgPrice?: number
  entry_price?: number
  entryPrice?: number
  totalBought?: number
  size?: number
  cost_usd?: number
  side?: 'YES' | 'NO' | string
  closed_at?: string
  endDate?: string
  ts_close?: string
  ts_open?: string
  conditionId?: string
  position_id?: string
  tokenId?: string
  market_id?: string
  category?: string
  roi?: number
  image_url?: string | null
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
  imageUrl?: string | null;
  entryPrice?: number;
}

type ViewMode = 'bubble' | 'treemap' | 'bar' | 'list';

const CATEGORY_COLORS: Record<string, string> = {
  World: "#3b82f6",
  Politics: "#ef4444",
  Other: "#6b7280",
  Tech: "#8b5cf6",
  Crypto: "#f97316",
  Economy: "#22c55e",
  Finance: "#10b981",
  Sports: "#eab308",
  Culture: "#ec4899",
  Unknown: "#64748b",
};

const CATEGORY_BG_COLORS: Record<string, string> = {
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

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}

// Interpolate between two colors
function lerpColor(color1: [number, number, number], color2: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(color1[0] + (color2[0] - color1[0]) * t),
    Math.round(color1[1] + (color2[1] - color1[1]) * t),
    Math.round(color1[2] + (color2[2] - color1[2]) * t),
  ];
}

// ROI color helper - continuous gradient for unique colors per bubble
function getRoiColor(roi: number, isDark: boolean): string {
  const alpha = isDark ? 0.8 : 0.75;

  // Color stops for continuous interpolation
  const colors = isDark ? {
    deepGreen: [16, 185, 129] as [number, number, number],   // roi >= 1.0
    green: [52, 211, 153] as [number, number, number],       // roi = 0.5
    lightGreen: [134, 239, 172] as [number, number, number], // roi = 0.25
    paleGreen: [187, 247, 208] as [number, number, number],  // roi = 0
    yellow: [253, 224, 71] as [number, number, number],      // roi = -0.25
    orange: [251, 146, 60] as [number, number, number],      // roi = -0.5
    red: [248, 113, 113] as [number, number, number],        // roi <= -1.0
  } : {
    deepGreen: [5, 150, 105] as [number, number, number],
    green: [16, 185, 129] as [number, number, number],
    lightGreen: [74, 222, 128] as [number, number, number],
    paleGreen: [134, 239, 172] as [number, number, number],
    yellow: [250, 204, 21] as [number, number, number],
    orange: [249, 115, 22] as [number, number, number],
    red: [239, 68, 68] as [number, number, number],
  };

  let rgb: [number, number, number];

  if (roi >= 1.0) {
    rgb = colors.deepGreen;
  } else if (roi >= 0.5) {
    // Interpolate between deepGreen and green
    const t = (roi - 0.5) / 0.5;
    rgb = lerpColor(colors.green, colors.deepGreen, t);
  } else if (roi >= 0.25) {
    const t = (roi - 0.25) / 0.25;
    rgb = lerpColor(colors.lightGreen, colors.green, t);
  } else if (roi >= 0) {
    const t = roi / 0.25;
    rgb = lerpColor(colors.paleGreen, colors.lightGreen, t);
  } else if (roi >= -0.25) {
    const t = (roi + 0.25) / 0.25;
    rgb = lerpColor(colors.yellow, colors.paleGreen, t);
  } else if (roi >= -0.5) {
    const t = (roi + 0.5) / 0.25;
    rgb = lerpColor(colors.orange, colors.yellow, t);
  } else if (roi >= -1.0) {
    const t = (roi + 1.0) / 0.5;
    rgb = lerpColor(colors.red, colors.orange, t);
  } else {
    rgb = colors.red;
  }

  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

interface SelectedEvent {
  name: string;
  marketId: string;
  category: string;
  pnl: number;
  roi: number;
  invested: number;
  side: string;
  imageUrl?: string | null;
  entryPrice?: number;
}

export function TradingBubbleChart({ closedPositions, categoryStats }: TradingBubbleChartProps) {
  const [selectedPeriod, setSelectedPeriod] = useState(999999);
  const [viewMode, setViewMode] = useState<ViewMode>('bubble');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SelectedEvent | null>(null);
  const { theme } = useTheme();
  const chartRef = useRef<any>(null);

  const isDark = theme === 'dark';

  // Handle chart ready - set up background click to deselect
  const onChartReady = useCallback((instance: any) => {
    if (instance) {
      const zr = instance.getZr();
      zr.on('click', (params: any) => {
        // If click is not on a target element (bubble), deselect
        if (!params.target) {
          setSelectedEvent(null);
        }
      });
    }
  }, []);

  // Handle category selection - clean transition, no zoom animation
  const handleCategorySelect = (category: string | null) => {
    setSelectedCategory(category);
    setSelectedEvent(null);
  };

  const periods = [
    { label: '1D', value: 1 },
    { label: '7D', value: 7 },
    { label: '30D', value: 30 },
    { label: '90D', value: 90 },
    { label: 'All', value: 999999 },
  ];

  // Process data into rows
  const { rows, filteredCount } = useMemo(() => {
    if (!closedPositions || closedPositions.length === 0) {
      return { rows: [], filteredCount: 0 };
    }

    const isPreAggregated = closedPositions[0] && 'positions_count' in closedPositions[0];
    let filteredPositions = closedPositions;

    if (!isPreAggregated && selectedPeriod !== 999999) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - selectedPeriod);
      filteredPositions = closedPositions.filter((pos) => {
        const closedDate = pos.ts_close || pos.closed_at || pos.endDate || pos.ts_open;
        if (!closedDate) return true;
        return new Date(closedDate) >= cutoffDate;
      });
    }

    // Apply category filter
    if (selectedCategory) {
      filteredPositions = filteredPositions.filter((pos) => {
        const category = pos.category || 'Other';
        return category === selectedCategory;
      });
    }

    if (filteredPositions.length === 0) {
      return { rows: [], filteredCount: 0 };
    }

    const processedRows: TradeRow[] = filteredPositions.map((pos) => {
      const title = pos.question || pos.title || pos.market || pos.slug || '';
      const pnl = pos.pnl_usd || pos.realizedPnl || pos.realized_pnl || pos.profit || 0;
      const invested = pos.cost_usd || (pos.avgPrice || pos.entry_price || pos.entryPrice || 0) * (pos.totalBought || pos.size || 1);
      const roi = pos.roi !== undefined ? pos.roi : (invested > 0 ? pnl / invested : 0);
      const category = pos.category || 'Other';
      const entryPrice = pos.avgPrice || pos.entry_price || pos.entryPrice;

      return {
        category,
        marketId: pos.market_id || pos.conditionId || pos.position_id || pos.tokenId || title,
        marketLabel: title,
        invested,
        pnlUsd: pnl,
        roi,
        side: (pos.side === 'YES' || pos.side === 'NO' ? pos.side : 'YES') as 'YES' | 'NO',
        imageUrl: pos.image_url,
        entryPrice,
      };
    });

    const totalCount = isPreAggregated
      ? filteredPositions.reduce((sum, pos) => sum + ((pos as any).positions_count || 1), 0)
      : filteredPositions.length;

    return { rows: processedRows, filteredCount: totalCount };
  }, [closedPositions, selectedPeriod, selectedCategory]);

  // Aggregate by category for bar chart
  const categoryData = useMemo(() => {
    const byCat = new Map<string, { invested: number; pnl: number; count: number }>();
    for (const r of rows) {
      if (!byCat.has(r.category)) {
        byCat.set(r.category, { invested: 0, pnl: 0, count: 0 });
      }
      const cat = byCat.get(r.category)!;
      cat.invested += r.invested;
      cat.pnl += r.pnlUsd;
      cat.count += 1;
    }
    return Array.from(byCat.entries())
      .map(([name, data]) => ({
        name,
        invested: data.invested,
        pnl: data.pnl,
        roi: data.invested > 0 ? data.pnl / data.invested : 0,
        count: data.count,
      }))
      .sort((a, b) => b.invested - a.invested);
  }, [rows]);

  // Build bubble chart series data
  const bubbleSeriesData = useMemo(() => {
    if (rows.length === 0) return [];

    const byCat = new Map<string, TradeRow[]>();
    for (const r of rows) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }

    const series: any[] = [];
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
      series.push({
        id: `root.${cat}`,
        name: cat,
        value: invested,
        roi: invested ? pnl / invested : 0,
        depth: 1,
        index: index++,
        category: cat,
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
          pnl: r.pnlUsd,
          category: cat,
          imageUrl: r.imageUrl,
          entryPrice: r.entryPrice,
        });
      }
    }
    return series;
  }, [rows]);

  // Bubble chart option
  const bubbleOption = useMemo(() => {
    if (bubbleSeriesData.length === 0) return {};

    let displayRoot = stratify<any>()
      .id((d) => d.id)
      .parentId((d) => {
        const i = d.id.lastIndexOf('.');
        return i < 0 ? null : d.id.slice(0, i);
      })(bubbleSeriesData)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const overallLayout = (params: any, api: any) => {
      const ctx = params.context;
      const padding = 80; // Space for legend on left
      pack<any>()
        .size([api.getWidth() - padding - 2, api.getHeight() - 2])
        .padding(5)(displayRoot as any);

      // Offset all nodes to the right to make room for legend
      (displayRoot as any).descendants().forEach((n: any) => {
        n.x += padding;
      });

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

      // Check if this node is the selected event
      const nodeMarketId = nodePath.split('.').pop();
      const isSelected = selectedEvent && nodeMarketId === selectedEvent.marketId;

      const showLabel = node.r > 35 && node.depth === 1;
      const baseZ2 = api.value('depth') * 2;

      // Get the base color and parse RGB for gradient
      const baseColor = api.visual('color');

      // Extract RGB from the color string for gradient creation
      const parseColor = (color: string) => {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
        }
        // Fallback for hex colors
        const hexMatch = color.match(/#([a-fA-F0-9]{2})([a-fA-F0-9]{2})([a-fA-F0-9]{2})/);
        if (hexMatch) {
          return { r: parseInt(hexMatch[1], 16), g: parseInt(hexMatch[2], 16), b: parseInt(hexMatch[3], 16) };
        }
        return { r: 100, g: 200, b: 150 }; // Default teal-ish
      };

      const rgb = parseColor(baseColor);

      // Clean glassmorphism - more transparent
      const gradientFill = {
        type: 'radial',
        x: 0.5,
        y: 0.5,
        r: 1,
        colorStops: isDark ? [
          { offset: 0, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)` },
          { offset: 1, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)` },
        ] : [
          { offset: 0, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)` },
          { offset: 1, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)` },
        ],
      };

      const circleElement = {
        type: 'circle',
        focus: focus,
        shape: {
          cx: node.x,
          cy: node.y,
          r: node.r,
        },
        transition: ['shape', 'style'],
        z2: baseZ2,
        style: {
          fill: gradientFill,
          // Very thin subtle border
          stroke: isSelected
            ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.7)`
            : `rgba(255, 255, 255, ${isDark ? 0.12 : 0.2})`,
          lineWidth: isSelected ? 1.5 : 0.5,
          // Subtle shadow
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.1)',
          shadowOffsetX: 2,
          shadowOffsetY: 2,
        },
        emphasis: {
          style: {
            stroke: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`,
            lineWidth: 1.5,
            shadowBlur: 16,
            shadowColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`,
          },
        },
        blur: {
          style: {
            opacity: isLeaf ? 0.4 : 0.25,
          },
        },
        // Smooth transitions for hover effects
        emphasisDisabled: false,
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
                text: node.data.name,
                x: node.x,
                y: node.y,
                width: node.r * 1.8,
                overflow: 'truncate',
                fontSize: Math.max(14, Math.min(20, node.r / 3)),
                fill: '#ffffff',
                fontWeight: 700,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                textShadowColor: 'rgba(0, 0, 0, 0.7)',
                textShadowBlur: 4,
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
      dataset: { source: bubbleSeriesData },
      animation: true,
      animationDuration: 500,
      animationEasing: 'cubicOut',
      tooltip: {
        confine: true,
        enterable: true,
        showDelay: 50,
        hideDelay: 150,
        transitionDuration: 0.15,
        backgroundColor: isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        borderColor: isDark ? 'rgba(63, 63, 70, 0.5)' : 'rgba(228, 228, 231, 0.8)',
        borderWidth: 1,
        borderRadius: 8,
        padding: [12, 16],
        extraCssText: `${isDark ? 'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);' : 'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);'} transition: opacity 0.15s ease-out, transform 0.15s ease-out;`,
        textStyle: {
          color: isDark ? '#fafafa' : '#18181b',
          fontSize: 12,
        },
        formatter: (p: any) => {
          const d = p.data;
          if (d.depth === 0) return null;

          const roiColor = d.roi >= 0 ? '#22c55e' : '#ef4444';
          // Removed image from tooltip - causes glitchy rendering as it loads
          // Images are shown in the selected event panel instead
          const pnlDisplay = d.pnl !== undefined ? `
            <div style="display: flex; justify-content: space-between; gap: 24px; margin-top: 6px;">
              <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">P&L</span>
              <span style="color: ${d.pnl >= 0 ? '#22c55e' : '#ef4444'}; font-weight: 600;">${formatPnL(d.pnl)}</span>
            </div>
          ` : '';
          const sideDisplay = d.side ? `
            <div style="display: flex; justify-content: space-between; gap: 24px; margin-top: 6px;">
              <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Side</span>
              <span style="color: ${d.side === 'YES' ? '#22c55e' : '#ef4444'}; font-weight: 600;">${d.side}</span>
            </div>
          ` : '';
          const categoryBadge = d.category ? `
            <div style="margin-bottom: 10px;">
              <span style="background: ${CATEGORY_COLORS[d.category] || CATEGORY_COLORS.Unknown}20; color: ${CATEGORY_COLORS[d.category] || CATEGORY_COLORS.Unknown}; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;">${d.category}</span>
            </div>
          ` : '';
          // Entry/exit price display for leaf nodes
          const priceDisplay = (d.depth === 2 && d.entryPrice) ? `
            <div style="display: flex; justify-content: space-between; gap: 24px; margin-top: 6px;">
              <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Entry</span>
              <span style="font-weight: 600;">${(d.entryPrice * 100).toFixed(0)}¢</span>
            </div>
            ${d.roi !== undefined ? `
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-top: 6px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Exit</span>
                <span style="font-weight: 600;">${Math.min(100, Math.max(0, (d.entryPrice * (1 + d.roi)) * 100)).toFixed(0)}¢</span>
              </div>
            ` : ''}
          ` : '';

          return `
            <div style="min-width: 200px; max-width: 260px;">
              ${categoryBadge}
              <div style="font-weight: 600; margin-bottom: 10px; line-height: 1.4;">${d.name}</div>
              <div style="display: flex; justify-content: space-between; gap: 24px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Invested</span>
                <span style="font-weight: 600;">${formatCurrency(d.value)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-top: 6px;">
                <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">ROI</span>
                <span style="color: ${roiColor}; font-weight: 600;">${d.roi >= 0 ? '+' : ''}${(d.roi * 100).toFixed(1)}%</span>
              </div>
              ${pnlDisplay}
              ${sideDisplay}
              ${priceDisplay}
            </div>
          `;
        },
      },
      visualMap: {
        type: 'piecewise',
        dimension: 'roi',
        orient: 'vertical',
        left: 12,
        top: 'middle',
        itemWidth: 20,
        itemHeight: 20,
        itemGap: 14,
        pieces: [
          { min: 1, color: isDark ? '#10b981' : '#059669', label: '100%+' },
          { min: 0.25, max: 1, color: isDark ? '#34d399' : '#10b981', label: '25-100%' },
          { min: 0, max: 0.25, color: isDark ? '#6ee7b7' : '#34d399', label: '0-25%' },
          { min: -0.5, max: 0, color: isDark ? '#fca5a5' : '#f87171', label: '-50-0%' },
          { max: -0.5, color: isDark ? '#ef4444' : '#dc2626', label: '<-50%' },
        ],
        textStyle: {
          color: isDark ? '#a1a1aa' : '#71717a',
          fontSize: 13,
          fontWeight: 500,
        },
      },
      hoverLayerThreshold: Infinity,
      useUTC: true,
      series: {
        type: 'custom',
        coordinateSystem: 'none',
        renderItem,
        encode: {
          tooltip: 'value',
          itemName: 'id',
        },
        progressive: 0,
        emphasis: {
          focus: 'ancestor',
          blurScope: 'coordinateSystem',
        },
        animationDurationUpdate: 300,
        animationEasingUpdate: 'cubicOut',
      },
    };
  }, [bubbleSeriesData, isDark, selectedEvent]);

  // Treemap option - clean, modern design
  const treemapOption = useMemo(() => {
    if (rows.length === 0) return {};

    // Filter out undefined/empty categories and build clean hierarchy
    const validCategories = categoryData.filter(cat => cat.name && cat.name !== 'undefined');

    const treeData = validCategories.map(cat => {
      const catColor = CATEGORY_COLORS[cat.name] || CATEGORY_COLORS.Unknown;
      // Create slightly darker/lighter variants for depth
      const baseColor = catColor;

      return {
        name: cat.name,
        value: cat.invested,
        roi: cat.roi,
        pnl: cat.pnl,
        count: cat.count,
        isCategory: true,
        itemStyle: {
          color: baseColor,
          borderColor: 'transparent',
          borderWidth: 0,
          borderRadius: 4,
        },
        children: rows
          .filter(r => r.category === cat.name)
          .map(r => ({
            name: r.marketLabel,
            value: r.invested,
            roi: r.roi,
            pnl: r.pnlUsd,
            side: r.side,
            category: r.category,
            imageUrl: r.imageUrl,
            marketId: r.marketId,
            isCategory: false,
            itemStyle: {
              color: getRoiColor(r.roi, isDark),
              borderColor: 'transparent',
              borderWidth: 0,
              borderRadius: 3,
            },
          })),
      };
    });

    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 300,
      animationEasing: 'cubicOut',
      tooltip: {
        confine: true,
        enterable: true,
        showDelay: 50,
        hideDelay: 150,
        transitionDuration: 0.15,
        backgroundColor: isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        borderColor: isDark ? 'rgba(63, 63, 70, 0.5)' : 'rgba(228, 228, 231, 0.8)',
        borderWidth: 1,
        borderRadius: 10,
        padding: [12, 16],
        extraCssText: `box-shadow: 0 8px 24px ${isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.12)'}; backdrop-filter: blur(8px); transition: opacity 0.15s ease-out;`,
        textStyle: {
          color: isDark ? '#fafafa' : '#18181b',
          fontSize: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        },
        formatter: (p: any) => {
          const d = p.data;
          if (!d) return '';

          if (d.isCategory || d.children) {
            // Category level tooltip
            const pnlColor = d.pnl >= 0 ? '#22c55e' : '#ef4444';
            return `
              <div style="min-width: 160px; font-family: system-ui, -apple-system, sans-serif;">
                <div style="font-weight: 700; font-size: 15px; margin-bottom: 10px; color: ${isDark ? '#fff' : '#18181b'};">${d.name}</div>
                <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 6px;">
                  <span style="color: ${isDark ? '#a1a1aa' : '#71717a'};">Invested</span>
                  <span style="font-weight: 600;">${formatCurrency(d.value)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 6px;">
                  <span style="color: ${isDark ? '#a1a1aa' : '#71717a'};">P&L</span>
                  <span style="color: ${pnlColor}; font-weight: 600;">${formatPnL(d.pnl)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; gap: 20px;">
                  <span style="color: ${isDark ? '#a1a1aa' : '#71717a'};">Positions</span>
                  <span style="font-weight: 600;">${d.count}</span>
                </div>
                <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid ${isDark ? '#3f3f46' : '#e4e4e7'}; font-size: 11px; color: ${isDark ? '#71717a' : '#a1a1aa'};">
                  Click to filter by this category
                </div>
              </div>
            `;
          }

          // Market level tooltip - removed image for smoother performance
          const roiColor = d.roi >= 0 ? '#22c55e' : '#ef4444';
          const pnlColor = d.pnl >= 0 ? '#22c55e' : '#ef4444';
          return `
            <div style="min-width: 200px; max-width: 280px; font-family: system-ui, -apple-system, sans-serif;">
              <div style="font-weight: 600; margin-bottom: 10px; line-height: 1.4; font-size: 13px; color: ${isDark ? '#fff' : '#18181b'};">${d.name}</div>
              <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 5px;">
                <span style="color: ${isDark ? '#a1a1aa' : '#71717a'};">Invested</span>
                <span style="font-weight: 600;">${formatCurrency(d.value)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 5px;">
                <span style="color: ${isDark ? '#a1a1aa' : '#71717a'};">ROI</span>
                <span style="color: ${roiColor}; font-weight: 600;">${d.roi >= 0 ? '+' : ''}${(d.roi * 100).toFixed(1)}%</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 20px;">
                <span style="color: ${isDark ? '#a1a1aa' : '#71717a'};">P&L</span>
                <span style="color: ${pnlColor}; font-weight: 600;">${formatPnL(d.pnl)}</span>
              </div>
              ${d.side ? `
                <div style="display: flex; justify-content: space-between; gap: 20px; margin-top: 5px;">
                  <span style="color: ${isDark ? '#a1a1aa' : '#71717a'};">Side</span>
                  <span style="color: ${d.side === 'YES' ? '#22c55e' : '#ef4444'}; font-weight: 600;">${d.side}</span>
                </div>
              ` : ''}
            </div>
          `;
        },
      },
      series: [{
        type: 'treemap',
        data: treeData,
        left: 4,
        top: 4,
        right: 4,
        bottom: 4,
        roam: false,
        nodeClick: false, // We handle clicks via onEvents
        breadcrumb: { show: false },
        squareRatio: 0.7,
        label: {
          show: true,
          formatter: (p: any) => {
            if (!p.data.name) return '';
            return p.data.name; // Show full name, let overflow handle truncation
          },
          fontSize: 12,
          color: '#fff',
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textShadowColor: 'rgba(0,0,0,0.85)',
          textShadowBlur: 6,
          padding: [8, 10],
          lineHeight: 16,
          overflow: 'break', // Word wrap for longer text
          ellipsis: '…',
        },
        upperLabel: {
          show: true,
          height: 28,
          color: '#fff',
          fontSize: 13,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          backgroundColor: 'transparent',
          textShadowColor: 'rgba(0,0,0,0.9)',
          textShadowBlur: 5,
          padding: [6, 12],
          formatter: (p: any) => {
            if (!p.data.name) return '';
            return `${p.data.name}  ·  ${p.data.count || 0}`;
          },
        },
        itemStyle: {
          borderColor: 'transparent',
          borderWidth: 0,
          gapWidth: 1,
          borderRadius: 4,
        },
        levels: [
          {
            // Category level (depth 0)
            itemStyle: {
              borderColor: 'transparent',
              borderWidth: 0,
              gapWidth: 2,
              borderRadius: 4,
            },
            upperLabel: {
              show: true,
            },
          },
          {
            // Market level (depth 1)
            itemStyle: {
              borderColor: 'transparent',
              borderWidth: 0,
              gapWidth: 1,
              borderRadius: 3,
            },
            label: {
              show: true,
              position: 'insideTopLeft',
              distance: 6,
              fontSize: 11,
              fontWeight: 500,
              overflow: 'break',
              lineHeight: 14,
            },
          },
        ],
        emphasis: {
          label: {
            fontSize: 12,
            fontWeight: 600,
          },
          upperLabel: {
            fontSize: 13,
            fontWeight: 700,
          },
          itemStyle: {
            borderColor: '#00E0AA',
            borderWidth: 3,
            shadowBlur: 12,
            shadowColor: 'rgba(0, 224, 170, 0.4)',
          },
        },
      }],
    };
  }, [categoryData, rows, isDark]);

  // Bar chart option - Shows wins vs losses per category
  const barOption = useMemo(() => {
    // Use categoryStats if available for wins/losses data
    const statsToUse = categoryStats && categoryStats.length > 0 ? categoryStats : null;
    if (!statsToUse && categoryData.length === 0) return {};

    const categories = statsToUse
      ? statsToUse.map(c => c.category)
      : categoryData.map(c => c.name);

    const winsData = statsToUse
      ? statsToUse.map(c => c.wins)
      : categoryData.map(() => 0);

    const lossesData = statsToUse
      ? statsToUse.map(c => -c.losses) // Negative for opposite direction
      : categoryData.map(() => 0);

    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 500,
      legend: {
        data: ['Wins', 'Losses'],
        top: 0,
        textStyle: { color: isDark ? '#94a3b8' : '#64748b', fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        enterable: true,
        showDelay: 50,
        hideDelay: 150,
        transitionDuration: 0.15,
        backgroundColor: isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        borderColor: isDark ? 'rgba(63, 63, 70, 0.5)' : 'rgba(228, 228, 231, 0.8)',
        borderWidth: 1,
        borderRadius: 8,
        padding: [12, 16],
        extraCssText: 'transition: opacity 0.15s ease-out;',
        formatter: (params: any) => {
          const catName = params[0]?.name;
          const stat = statsToUse?.find(c => c.category === catName);
          const catData = categoryData.find(c => c.name === catName);
          if (!stat && !catData) return '';

          const wins = stat?.wins ?? 0;
          const losses = stat?.losses ?? 0;
          const winRate = stat?.win_rate ?? (catData ? (wins / (wins + losses) || 0) : 0);
          const pnl = stat?.pnl_usd ?? catData?.pnl ?? 0;

          return `
            <div style="min-width: 140px;">
              <div style="font-weight: 600; margin-bottom: 8px;">${catName}</div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: #22c55e;">● Wins</span>
                <span style="font-weight: 600;">${wins}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span style="color: #ef4444;">● Losses</span>
                <span style="font-weight: 600;">${losses}</span>
              </div>
              <div style="border-top: 1px solid ${isDark ? '#27272a' : '#e4e4e7'}; margin-top: 8px; padding-top: 8px;">
                <div style="display: flex; justify-content: space-between;">
                  <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">Win Rate</span>
                  <span style="font-weight: 600; color: ${winRate >= 0.5 ? '#22c55e' : '#ef4444'};">${(winRate * 100).toFixed(0)}%</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 4px;">
                  <span style="color: ${isDark ? '#94a3b8' : '#64748b'};">P&L</span>
                  <span style="font-weight: 600; color: ${pnl >= 0 ? '#22c55e' : '#ef4444'};">${formatPnL(pnl)}</span>
                </div>
              </div>
            </div>
          `;
        },
      },
      grid: {
        left: 100,
        right: 40,
        top: 35,
        bottom: 20,
      },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          lineStyle: { color: isDark ? '#27272a' : '#e4e4e7' },
        },
        axisLabel: {
          color: isDark ? '#71717a' : '#a1a1aa',
          formatter: (v: number) => Math.abs(v).toString(),
        },
      },
      yAxis: {
        type: 'category',
        data: categories,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: isDark ? '#d4d4d8' : '#3f3f46',
          fontWeight: 500,
        },
      },
      series: [
        {
          name: 'Wins',
          type: 'bar',
          stack: 'total',
          data: winsData.map((v, i) => ({
            value: v,
            itemStyle: {
              color: '#22c55e',
              borderRadius: v > 0 ? [0, 4, 4, 0] : 0,
            },
          })),
          barWidth: '50%',
          label: {
            show: true,
            position: 'right',
            formatter: (p: any) => p.value > 0 ? p.value : '',
            color: '#22c55e',
            fontSize: 11,
            fontWeight: 600,
          },
        },
        {
          name: 'Losses',
          type: 'bar',
          stack: 'total',
          data: lossesData.map((v) => ({
            value: v,
            itemStyle: {
              color: '#ef4444',
              borderRadius: v < 0 ? [4, 0, 0, 4] : 0,
            },
          })),
          barWidth: '50%',
          label: {
            show: true,
            position: 'left',
            formatter: (p: any) => p.value < 0 ? Math.abs(p.value) : '',
            color: '#ef4444',
            fontSize: 11,
            fontWeight: 600,
          },
        },
      ],
    };
  }, [categoryData, categoryStats, isDark]);

  const isPreAggregated = closedPositions?.[0] && 'positions_count' in closedPositions[0];

  // Compute detailed stats for selected category
  const selectedCategoryDetails = useMemo(() => {
    if (!selectedCategory) return null;

    const categoryRows = rows.filter(r => r.category === selectedCategory);
    if (categoryRows.length === 0) return null;

    const stats = categoryStats?.find(c => c.category === selectedCategory);
    const catData = categoryData.find(c => c.name === selectedCategory);

    // Sort by ROI for best/worst
    const sortedByRoi = [...categoryRows].sort((a, b) => b.roi - a.roi);
    const bestTrades = sortedByRoi.slice(0, 3);
    const worstTrades = sortedByRoi.slice(-3).reverse();

    // Sort by P&L for biggest wins/losses
    const sortedByPnl = [...categoryRows].sort((a, b) => b.pnlUsd - a.pnlUsd);
    const biggestWins = sortedByPnl.filter(r => r.pnlUsd > 0).slice(0, 3);
    const biggestLosses = sortedByPnl.filter(r => r.pnlUsd < 0).slice(-3).reverse();

    const totalInvested = categoryRows.reduce((sum, r) => sum + r.invested, 0);
    const totalPnl = categoryRows.reduce((sum, r) => sum + r.pnlUsd, 0);
    const avgRoi = totalInvested > 0 ? totalPnl / totalInvested : 0;
    const wins = categoryRows.filter(r => r.pnlUsd > 0).length;
    const losses = categoryRows.filter(r => r.pnlUsd <= 0).length;
    const winRate = categoryRows.length > 0 ? wins / categoryRows.length : 0;

    // Side breakdown
    const yesTrades = categoryRows.filter(r => r.side === 'YES');
    const noTrades = categoryRows.filter(r => r.side === 'NO');
    const yesWinRate = yesTrades.length > 0 ? yesTrades.filter(r => r.pnlUsd > 0).length / yesTrades.length : 0;
    const noWinRate = noTrades.length > 0 ? noTrades.filter(r => r.pnlUsd > 0).length / noTrades.length : 0;

    return {
      category: selectedCategory,
      positions: categoryRows.length,
      wins: stats?.wins ?? wins,
      losses: stats?.losses ?? losses,
      winRate: stats?.win_rate ?? winRate,
      totalInvested,
      totalPnl: stats?.pnl_usd ?? totalPnl,
      avgRoi,
      bestTrades,
      worstTrades,
      biggestWins,
      biggestLosses,
      yesTrades: yesTrades.length,
      noTrades: noTrades.length,
      yesWinRate,
      noWinRate,
      yesPnl: yesTrades.reduce((sum, r) => sum + r.pnlUsd, 0),
      noPnl: noTrades.reduce((sum, r) => sum + r.pnlUsd, 0),
    };
  }, [selectedCategory, rows, categoryStats, categoryData]);

  const currentOption = viewMode === 'bubble' ? bubbleOption : viewMode === 'treemap' ? treemapOption : barOption;

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
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
                    <p className="text-sm">Visualize trading positions by category. Size = invested amount, Color = ROI performance.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-sm text-muted-foreground">
              {filteredCount.toLocaleString()} positions
              {selectedCategory && <span className="text-[#00E0AA]"> in {selectedCategory}</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Switcher */}
          <Tabs value={viewMode} onValueChange={(v) => {
            // Clear category selection when switching to bar view to prevent auto-opening detail panel
            if (v === 'bar') {
              setSelectedCategory(null);
              setSelectedEvent(null);
            }
            setViewMode(v as ViewMode);
          }}>
            <TabsList className="h-9 p-1">
              <TabsTrigger value="bubble" className="px-2.5 py-1.5 gap-1.5">
                <Circle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-xs">Bubble</span>
              </TabsTrigger>
              <TabsTrigger value="treemap" className="px-2.5 py-1.5 gap-1.5">
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-xs">Treemap</span>
              </TabsTrigger>
              <TabsTrigger value="bar" className="px-2.5 py-1.5 gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-xs">Bar</span>
              </TabsTrigger>
              <TabsTrigger value="list" className="px-2.5 py-1.5 gap-1.5">
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline text-xs">List</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Period Filter - only show when data can be filtered */}
          {!isPreAggregated && (
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
              {periods.map((period) => (
                <button
                  key={period.value}
                  onClick={() => setSelectedPeriod(period.value)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-all ${
                    selectedPeriod === period.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {period.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category Filter Pills */}
      {categoryData.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Filter:</span>
          <button
            onClick={() => handleCategorySelect(null)}
            className={`px-2.5 py-1 text-xs rounded-full transition-all ${
              !selectedCategory
                ? "bg-[#00E0AA] text-white"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            All
          </button>
          {categoryData.slice(0, 8).map((cat) => (
            <button
              key={cat.name}
              onClick={() => handleCategorySelect(selectedCategory === cat.name ? null : cat.name)}
              className={`px-2.5 py-1 text-xs rounded-full transition-all flex items-center gap-1.5 ${
                selectedCategory === cat.name
                  ? "bg-[#00E0AA] text-white"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[cat.name] || CATEGORY_COLORS.Unknown }}
              />
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Chart Container */}
      {rows.length > 0 ? (
        <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden flex-1 flex flex-col relative">
          {viewMode === 'list' ? (
            /* List View */
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left p-3 font-medium text-muted-foreground">Market</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Category</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Invested</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">P&L</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">ROI</th>
                    <th className="text-center p-3 font-medium text-muted-foreground">Side</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 max-w-[300px] truncate" title={row.marketLabel}>
                        {row.marketLabel}
                      </td>
                      <td className="p-3">
                        <Badge variant="secondary" className="text-xs" style={{
                          backgroundColor: `${CATEGORY_COLORS[row.category] || CATEGORY_COLORS.Unknown}20`,
                          color: CATEGORY_COLORS[row.category] || CATEGORY_COLORS.Unknown,
                        }}>
                          {row.category}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-medium">{formatCurrency(row.invested)}</td>
                      <td className={`p-3 text-right font-semibold ${row.pnlUsd >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {formatPnL(row.pnlUsd)}
                      </td>
                      <td className={`p-3 text-right font-semibold ${row.roi >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {row.roi >= 0 ? '+' : ''}{(row.roi * 100).toFixed(1)}%
                      </td>
                      <td className="p-3 text-center">
                        <span className={`text-xs font-semibold ${row.side === 'YES' ? 'text-emerald-500' : 'text-red-500'}`}>
                          {row.side}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 100 && (
                <div className="p-3 text-center text-sm text-muted-foreground bg-muted/30">
                  Showing 100 of {rows.length} positions
                </div>
              )}
            </div>
          ) : (
            /* Chart Views */
            <div className="flex flex-col lg:flex-row h-[380px]">
              <div
                className={`flex-1 p-2 ${categoryStats && categoryStats.length > 0 ? 'lg:border-r lg:border-border/30' : ''}`}
              >
                <ReactECharts
                  ref={chartRef}
                  key={`chart-${viewMode}-${selectedCategory || 'all'}`}
                  option={currentOption}
                  style={{ height: '100%', width: '100%' }}
                  opts={{ renderer: 'canvas', devicePixelRatio: 2 }}
                  notMerge={true}
                  lazyUpdate={true}
                  onChartReady={onChartReady}
                  onEvents={{
                    click: (params: any) => {
                      // Handle bar chart clicks
                      if (viewMode === 'bar') {
                        const clickedCategory = params.name;
                        if (clickedCategory) {
                          handleCategorySelect(selectedCategory === clickedCategory ? null : clickedCategory);
                        }
                        return;
                      }

                      // Handle treemap clicks
                      if (viewMode === 'treemap') {
                        // Click on category (has children or isCategory flag)
                        if (params.data?.isCategory || params.data?.children) {
                          const clickedCategory = params.data.name;
                          if (clickedCategory) {
                            handleCategorySelect(selectedCategory === clickedCategory ? null : clickedCategory);
                          }
                        }
                        return;
                      }

                      if (viewMode !== 'bubble') return;

                      // Handle clicking on category bubbles (depth 1)
                      if (params.data?.depth === 1 && params.data?.category) {
                        const clickedCategory = params.data.category;
                        handleCategorySelect(selectedCategory === clickedCategory ? null : clickedCategory);
                      }
                      // Handle clicking on event bubbles (depth 2 - leaf nodes)
                      else if (params.data?.depth === 2) {
                        setSelectedEvent({
                          name: params.data.name,
                          marketId: params.data.id?.split('.').pop() || '',
                          category: params.data.category,
                          pnl: params.data.pnl || 0,
                          roi: params.data.roi || 0,
                          invested: params.data.value || 0,
                          side: params.data.side || 'YES',
                          imageUrl: params.data.imageUrl,
                          entryPrice: params.data.entryPrice,
                        });
                      }
                    },
                  }}
                />
              </div>

              {/* Category Stats Panel */}
              {categoryStats && categoryStats.length > 0 && (
                <div className="lg:w-[420px] p-4 flex flex-col border-t lg:border-t-0 border-border/30 bg-muted/5">
                  <div className="mb-3 flex-shrink-0">
                    <h3 className="text-sm font-semibold">Performance by Category</h3>
                    <p className="text-xs text-muted-foreground">Click to filter chart</p>
                  </div>

                  {/* Header Row */}
                  <div className="grid grid-cols-[1fr,52px,72px,56px] gap-3 px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wide border-b border-border/30 mb-2 flex-shrink-0">
                    <span>Category</span>
                    <span className="text-right">Win%</span>
                    <span className="text-right">P&L</span>
                    <span className="text-right">Record</span>
                  </div>

                  <div className="space-y-1 overflow-y-auto flex-1 min-h-0">
                    {categoryStats.map((category) => {
                      const winRate = category.win_rate * 100;
                      const pnlPositive = category.pnl_usd >= 0;
                      const isSelected = selectedCategory === category.category;

                      return (
                        <button
                          key={category.category}
                          onClick={() => handleCategorySelect(isSelected ? null : category.category)}
                          className={`w-full grid grid-cols-[1fr,52px,72px,56px] gap-3 items-center px-3 py-2.5 rounded-lg transition-all text-sm ${
                            isSelected ? 'bg-[#00E0AA]/10 ring-1 ring-[#00E0AA]/30' : 'hover:bg-muted/50'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: CATEGORY_COLORS[category.category] || CATEGORY_COLORS.Unknown }}
                            />
                            <span className="font-medium truncate">{category.category}</span>
                            <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">({category.positions})</span>
                          </div>
                          <span className={`text-right font-medium tabular-nums ${
                            winRate >= 60 ? "text-emerald-500" : winRate <= 40 ? "text-red-400" : "text-foreground"
                          }`}>
                            {winRate.toFixed(0)}%
                          </span>
                          <span className={`text-right font-medium tabular-nums ${pnlPositive ? "text-emerald-500" : "text-red-400"}`}>
                            {formatPnL(category.pnl_usd)}
                          </span>
                          <span className="text-right text-muted-foreground tabular-nums">
                            {category.wins}-{category.losses}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border/50 bg-muted/30 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {viewMode === 'list' ? 'Sortable list view' :
               viewMode === 'bar' ? 'Click bars for category details' :
               viewMode === 'treemap' ? 'Click categories to filter • Hover for details' :
               'Click bubbles to select • Hover for details'}
            </span>
            <span className="font-medium text-muted-foreground">{filteredCount.toLocaleString()} positions</span>
          </div>

          {/* Selected Event Panel */}
          {selectedEvent && viewMode === 'bubble' && (
            <div className="absolute bottom-14 left-4 right-4 md:left-auto md:right-4 md:w-[320px] bg-card border border-border rounded-xl shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-300 z-10">
              {/* Close button - always visible */}
              <button
                onClick={() => setSelectedEvent(null)}
                className="absolute top-2 right-2 z-20 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              {/* Image header */}
              {selectedEvent.imageUrl && (
                <div className="h-20 overflow-hidden rounded-t-xl">
                  <img
                    src={selectedEvent.imageUrl}
                    alt={selectedEvent.name}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}

              <div className="p-4">

                {/* Category badge */}
                <div className="mb-2">
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: `${CATEGORY_COLORS[selectedEvent.category] || CATEGORY_COLORS.Unknown}20`,
                      color: CATEGORY_COLORS[selectedEvent.category] || CATEGORY_COLORS.Unknown,
                    }}
                  >
                    {selectedEvent.category}
                  </span>
                </div>

                {/* Title */}
                <h4 className="font-semibold text-sm mb-3 line-clamp-2">{selectedEvent.name}</h4>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div>
                    <span className="text-xs text-muted-foreground">Side</span>
                    <p className={`font-semibold ${selectedEvent.side === 'YES' ? 'text-emerald-500' : 'text-red-500'}`}>
                      {selectedEvent.side}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Invested</span>
                    <p className="font-semibold">{formatCurrency(selectedEvent.invested)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">P&L</span>
                    <p className={`font-semibold ${selectedEvent.pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {formatPnL(selectedEvent.pnl)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">ROI</span>
                    <p className={`font-semibold ${selectedEvent.roi >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {selectedEvent.roi >= 0 ? '+' : ''}{(selectedEvent.roi * 100).toFixed(1)}%
                    </p>
                  </div>
                  {selectedEvent.entryPrice && (
                    <>
                      <div>
                        <span className="text-xs text-muted-foreground">Entry Price</span>
                        <p className="font-semibold">{(selectedEvent.entryPrice * 100).toFixed(0)}¢</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Exit Price</span>
                        <p className="font-semibold">
                          {Math.min(100, Math.max(0, (selectedEvent.entryPrice * (1 + selectedEvent.roi)) * 100)).toFixed(0)}¢
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* Go to market button */}
                <a
                  href={`/analysis/market/${selectedEvent.marketId}`}
                  className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-[#00E0AA] hover:bg-[#00E0AA]/90 text-black font-semibold text-sm rounded-lg transition-colors"
                >
                  <span>View Market</span>
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          )}

          {/* Category Detail Panel - shows when category selected in bar view */}
          {selectedCategoryDetails && viewMode === 'bar' && (
            <>
              {/* Backdrop to close on outside click */}
              <div
                className="absolute inset-0 z-[5]"
                onClick={() => handleCategorySelect(null)}
              />
              <div className="absolute bottom-14 left-4 right-4 md:left-4 md:right-4 bg-card border border-border rounded-xl shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-300 z-10 max-h-[320px] overflow-hidden">
                {/* Close button */}
                <button
                  onClick={() => handleCategorySelect(null)}
                className="absolute top-3 right-3 z-20 p-1.5 rounded-full bg-muted hover:bg-muted/80 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="p-4">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[selectedCategoryDetails.category] || CATEGORY_COLORS.Unknown }}
                  />
                  <h3 className="text-lg font-bold">{selectedCategoryDetails.category}</h3>
                  <span className="text-sm text-muted-foreground">
                    {selectedCategoryDetails.positions} positions
                  </span>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  {/* Win Rate with mini bar */}
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
                    <div className="flex items-end gap-2">
                      <span className={`text-xl font-bold ${selectedCategoryDetails.winRate >= 0.5 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {(selectedCategoryDetails.winRate * 100).toFixed(0)}%
                      </span>
                      <span className="text-xs text-muted-foreground mb-1">
                        {selectedCategoryDetails.wins}W-{selectedCategoryDetails.losses}L
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${selectedCategoryDetails.winRate * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Total P&L */}
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-xs text-muted-foreground mb-1">Total P&L</div>
                    <span className={`text-xl font-bold ${selectedCategoryDetails.totalPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {formatPnL(selectedCategoryDetails.totalPnl)}
                    </span>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatCurrency(selectedCategoryDetails.totalInvested)} invested
                    </div>
                  </div>

                  {/* Avg ROI */}
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-xs text-muted-foreground mb-1">Avg ROI</div>
                    <span className={`text-xl font-bold ${selectedCategoryDetails.avgRoi >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {selectedCategoryDetails.avgRoi >= 0 ? '+' : ''}{(selectedCategoryDetails.avgRoi * 100).toFixed(1)}%
                    </span>
                  </div>

                  {/* Side Breakdown */}
                  <div className="bg-muted/30 rounded-lg p-3">
                    <div className="text-xs text-muted-foreground mb-1">By Side</div>
                    <div className="flex items-center gap-3 text-sm">
                      <div>
                        <span className="text-emerald-500 font-semibold">YES</span>
                        <span className="text-muted-foreground ml-1">({selectedCategoryDetails.yesTrades})</span>
                      </div>
                      <div>
                        <span className="text-red-500 font-semibold">NO</span>
                        <span className="text-muted-foreground ml-1">({selectedCategoryDetails.noTrades})</span>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-1 text-xs">
                      <span className={selectedCategoryDetails.yesPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                        {formatPnL(selectedCategoryDetails.yesPnl)}
                      </span>
                      <span className="text-muted-foreground">/</span>
                      <span className={selectedCategoryDetails.noPnl >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                        {formatPnL(selectedCategoryDetails.noPnl)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Best & Worst Trades */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Best Trades */}
                  {selectedCategoryDetails.biggestWins.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-emerald-500 mb-2 flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        Top Winners
                      </div>
                      <div className="space-y-1.5">
                        {selectedCategoryDetails.biggestWins.slice(0, 3).map((trade, i) => (
                          <div key={i} className="flex items-center justify-between text-sm bg-emerald-500/5 rounded-lg px-2.5 py-1.5">
                            <span className="truncate flex-1 mr-2 text-xs">{trade.marketLabel}</span>
                            <span className="text-emerald-500 font-semibold text-xs whitespace-nowrap">
                              {formatPnL(trade.pnlUsd)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Worst Trades */}
                  {selectedCategoryDetails.biggestLosses.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-red-500 mb-2 flex items-center gap-1">
                        <TrendingDown className="h-3 w-3" />
                        Biggest Losses
                      </div>
                      <div className="space-y-1.5">
                        {selectedCategoryDetails.biggestLosses.slice(0, 3).map((trade, i) => (
                          <div key={i} className="flex items-center justify-between text-sm bg-red-500/5 rounded-lg px-2.5 py-1.5">
                            <span className="truncate flex-1 mr-2 text-xs">{trade.marketLabel}</span>
                            <span className="text-red-500 font-semibold text-xs whitespace-nowrap">
                              {formatPnL(trade.pnlUsd)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            </>
          )}
        </div>
      ) : (
        <div className="h-[300px] rounded-xl border border-border/50 bg-muted/20 flex items-center justify-center">
          <p className="text-muted-foreground">No trades found in the selected period</p>
        </div>
      )}
    </div>
  );
}
