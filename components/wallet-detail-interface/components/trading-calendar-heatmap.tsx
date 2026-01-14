// @ts-nocheck
'use client';

import { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ClosedPosition {
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
  closed_at?: string
  endDate?: string
  ts_close?: string
  ts_open?: string
}

interface Trade {
  timestamp?: string
  created_at?: string
  trade_time?: string
  size?: number
  shares?: number
  amount_usd?: number
  price?: number
}

interface TradingCalendarHeatmapProps {
  closedPositions: ClosedPosition[];
  trades: Trade[];
}

type MetricType = 'trades' | 'volume' | 'pnl';

export function TradingCalendarHeatmap({ closedPositions, trades }: TradingCalendarHeatmapProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('trades');
  const [monthsBack, setMonthsBack] = useState(0); // 0 = current period, 1 = one period back, etc.
  const { theme } = useTheme();

  const isDark = theme === 'dark';

  const metrics = [
    { value: 'trades' as MetricType, label: 'Trade Count' },
    { value: 'volume' as MetricType, label: 'Volume (USD)' },
    { value: 'pnl' as MetricType, label: 'PnL (USD)' },
  ];

  // Calculate date range - show last 12 months ending today, with ability to go back
  const { startDate, endDate, rangeLabel } = useMemo(() => {
    const today = new Date();
    const end = new Date(today);
    end.setMonth(end.getMonth() - (monthsBack * 12));

    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);
    start.setDate(start.getDate() + 1); // Start day after to get exactly 1 year

    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    const startMonth = start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const endMonth = end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    return {
      startDate: formatDate(start),
      endDate: formatDate(end),
      rangeLabel: `${startMonth} - ${endMonth}`,
    };
  }, [monthsBack]);

  const { calendarData, maxValue, minValue, hasOlderData } = useMemo(() => {
    const dailyData = new Map<string, {
      trades: number;
      volume: number;
      pnl: number;
    }>();

    let oldestTradeDateStr: string | null = null;

    // Process trades for trade count and volume
    if (trades && trades.length > 0) {
      trades.forEach((trade) => {
        const timestamp = trade.trade_time || trade.timestamp || trade.created_at;
        if (!timestamp) return;

        const date = new Date(timestamp);
        const dateStr = date.toISOString().split('T')[0];

        // Track oldest trade date
        if (!oldestTradeDateStr || dateStr < oldestTradeDateStr) {
          oldestTradeDateStr = dateStr;
        }

        // Filter by date range
        if (dateStr < startDate || dateStr > endDate) {
          return;
        }

        if (!dailyData.has(dateStr)) {
          dailyData.set(dateStr, {
            trades: 0,
            volume: 0,
            pnl: 0,
          });
        }

        const data = dailyData.get(dateStr)!;
        data.trades += 1;
        data.volume += trade.amount_usd || (trade.size || trade.shares || 0) * (trade.price || 0);
      });
    }

    // Process closed positions for PnL
    if (closedPositions && closedPositions.length > 0) {
      closedPositions.forEach((pos) => {
        const closedDate = pos.ts_close || pos.closed_at || pos.endDate || pos.ts_open;
        if (!closedDate) return;

        const date = new Date(closedDate);
        const dateStr = date.toISOString().split('T')[0];

        // Track oldest date
        if (!oldestTradeDateStr || dateStr < oldestTradeDateStr) {
          oldestTradeDateStr = dateStr;
        }

        // Filter by date range
        if (dateStr < startDate || dateStr > endDate) {
          return;
        }

        if (!dailyData.has(dateStr)) {
          dailyData.set(dateStr, {
            trades: 0,
            volume: 0,
            pnl: 0,
          });
        }

        const data = dailyData.get(dateStr)!;
        data.pnl += pos.pnl_usd || pos.realizedPnl || pos.realized_pnl || pos.profit || 0;
      });
    }

    const data: [string, number][] = [];
    let max = 0;
    let min = 0;

    dailyData.forEach((value, date) => {
      let metricValue = 0;
      switch (selectedMetric) {
        case 'trades':
          metricValue = value.trades;
          break;
        case 'volume':
          metricValue = value.volume;
          break;
        case 'pnl':
          metricValue = value.pnl;
          break;
      }

      data.push([date, metricValue]);
      max = Math.max(max, metricValue);
      min = Math.min(min, metricValue);
    });

    // Check if there's older data beyond current view
    const hasOlder = oldestTradeDateStr ? oldestTradeDateStr < startDate : false;

    return {
      calendarData: data,
      maxValue: max,
      minValue: min,
      hasOlderData: hasOlder,
    };
  }, [closedPositions, trades, selectedMetric, startDate, endDate]);

  const getVisualMapConfig = () => {
    if (selectedMetric === 'pnl') {
      return {
        type: 'piecewise' as const,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: 10,
        pieces: [
          { min: 5000, label: '>$5k', color: '#10b981' },
          { min: 1000, max: 5000, label: '$1k-$5k', color: '#34d399' },
          { min: 100, max: 1000, label: '$100-$1k', color: '#6ee7b7' },
          { min: -100, max: 100, label: '±$100', color: '#94a3b8' },
          { min: -1000, max: -100, label: '-$100 to -$1k', color: '#fca5a5' },
          { min: -5000, max: -1000, label: '-$1k to -$5k', color: '#f87171' },
          { max: -5000, label: '<-$5k', color: '#ef4444' },
        ],
        textStyle: {
          color: isDark ? '#fff' : '#1e293b',
          fontSize: 10,
        },
      };
    } else {
      return {
        type: 'continuous' as const,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: 10,
        min: 0,
        max: maxValue || 1,
        calculable: true,
        inRange: {
          color: isDark
            ? ['#1e293b', '#0ea5e9', '#06b6d4', '#10b981', '#22c55e']
            : ['#cbd5e1', '#38bdf8', '#22d3ee', '#34d399', '#4ade80'],
        },
        textStyle: {
          color: isDark ? '#fff' : '#1e293b',
        },
      };
    }
  };

  const formatTooltip = (params: any) => {
    const value = params.value;
    const date = new Date(value[0]);
    const metricValue = value[1];

    let valueDisplay = '';
    switch (selectedMetric) {
      case 'trades':
        valueDisplay = `${metricValue} trade${metricValue !== 1 ? 's' : ''}`;
        break;
      case 'volume':
        valueDisplay = `$${metricValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        break;
      case 'pnl':
        const sign = metricValue >= 0 ? '+' : '';
        valueDisplay = `${sign}$${metricValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
        break;
    }

    return `
      <div style="padding: 8px;">
        <strong>${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</strong><br/>
        ${valueDisplay}
      </div>
    `;
  };

  const option = {
    tooltip: {
      position: 'top',
      formatter: formatTooltip,
    },
    visualMap: getVisualMapConfig(),
    calendar: {
      top: 60,
      left: 80,
      right: 30,
      bottom: 60,
      cellSize: ['auto', 15],
      range: [startDate, endDate],
      itemStyle: {
        borderWidth: 0.5,
        borderColor: isDark ? '#1e293b' : '#cbd5e1',
      },
      yearLabel: { show: false },
      monthLabel: {
        color: isDark ? '#94a3b8' : '#64748b',
        fontSize: 11,
      },
      dayLabel: {
        color: isDark ? '#94a3b8' : '#64748b',
        fontSize: 10,
        firstDay: 0,
        nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: isDark ? '#334155' : '#e2e8f0',
          width: 1,
        },
      },
    },
    series: {
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: calendarData,
    },
  };

  const getMetricDescription = () => {
    switch (selectedMetric) {
      case 'trades':
        return 'Number of trades per day';
      case 'volume':
        return 'Total volume per day';
      case 'pnl':
        return 'Daily profit/loss';
      default:
        return '';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold">Trading Activity</h2>
          <p className="text-xs text-muted-foreground">{getMetricDescription()}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={selectedMetric} onValueChange={(value) => setSelectedMetric(value as MetricType)}>
            <SelectTrigger className="w-[130px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {metrics.map((metric) => (
                <SelectItem key={metric.value} value={metric.value}>
                  {metric.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMonthsBack(monthsBack + 1)}
          disabled={!hasOlderData && monthsBack > 0}
          className="h-7 px-2"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium min-w-[160px] text-center">{rangeLabel}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMonthsBack(Math.max(0, monthsBack - 1))}
          disabled={monthsBack === 0}
          className="h-7 px-2"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {monthsBack > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMonthsBack(0)}
            className="h-7 px-2 text-xs"
          >
            Today
          </Button>
        )}
      </div>

      <div className="bg-slate-100 dark:bg-slate-950 rounded-lg p-3" style={{ height: '220px' }}>
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
}
