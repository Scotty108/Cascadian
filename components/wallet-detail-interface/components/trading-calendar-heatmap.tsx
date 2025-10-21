'use client';

import { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Button } from '@/components/ui/button';
import { useTheme } from 'next-themes';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FinishedBet } from '../types';

interface TradingCalendarHeatmapProps {
  finishedBets: FinishedBet[];
}

type MetricType = 'trades' | 'volume' | 'pnl';
type YearType = '2025' | '2024' | 'all';

export function TradingCalendarHeatmap({ finishedBets }: TradingCalendarHeatmapProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('trades');
  const [selectedYear, setSelectedYear] = useState<YearType>('2025');
  const { theme } = useTheme();

  const isDark = theme === 'dark';

  const metrics = [
    { value: 'trades' as MetricType, label: 'Trade Count' },
    { value: 'volume' as MetricType, label: 'Volume (USD)' },
    { value: 'pnl' as MetricType, label: 'PnL (USD)' },
  ];

  const years = [
    { value: '2025' as YearType, label: '2025' },
    { value: '2024' as YearType, label: '2024' },
    { value: 'all' as YearType, label: 'All Time' },
  ];

  const { calendarData, maxValue, minValue } = useMemo(() => {
    const dailyData = new Map<string, {
      trades: number;
      volume: number;
      pnl: number;
    }>();

    finishedBets.forEach((bet) => {
      const date = new Date(bet.closed_date);
      const dateStr = date.toISOString().split('T')[0];

      const year = date.getFullYear().toString();
      if (selectedYear !== 'all' && year !== selectedYear) {
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
      data.volume += bet.invested;
      data.pnl += bet.realized_pnl;
    });

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

    return {
      calendarData: data,
      maxValue: max,
      minValue: min,
    };
  }, [finishedBets, selectedMetric, selectedYear]);

  const getCalendarRange = (): string | string[] => {
    if (selectedYear === 'all') {
      return ['2024-01-01', '2025-12-31'];
    }
    return selectedYear;
  };

  const getVisualMapConfig = () => {
    if (selectedMetric === 'pnl') {
      return {
        type: 'piecewise' as const,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: 20,
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
        },
      };
    } else {
      return {
        type: 'continuous' as const,
        orient: 'horizontal' as const,
        left: 'center',
        bottom: 20,
        min: 0,
        max: maxValue,
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
    calendar: selectedYear === 'all'
      ? [
          {
            top: 80,
            left: 100,
            right: 30,
            cellSize: ['auto', 20],
            range: '2024',
            itemStyle: {
              borderWidth: 0.5,
              borderColor: isDark ? '#1e293b' : '#cbd5e1',
            },
            yearLabel: { show: true, color: isDark ? '#fff' : '#1e293b' },
            monthLabel: { color: isDark ? '#94a3b8' : '#64748b' },
            dayLabel: { color: isDark ? '#94a3b8' : '#64748b' },
            splitLine: {
              show: true,
              lineStyle: {
                color: isDark ? '#334155' : '#e2e8f0',
                width: 2,
              },
            },
          },
          {
            top: 260,
            left: 100,
            right: 30,
            cellSize: ['auto', 20],
            range: '2025',
            itemStyle: {
              borderWidth: 0.5,
              borderColor: isDark ? '#1e293b' : '#cbd5e1',
            },
            yearLabel: { show: true, color: isDark ? '#fff' : '#1e293b' },
            monthLabel: { color: isDark ? '#94a3b8' : '#64748b' },
            dayLabel: { color: isDark ? '#94a3b8' : '#64748b' },
            splitLine: {
              show: true,
              lineStyle: {
                color: isDark ? '#334155' : '#e2e8f0',
                width: 2,
              },
            },
          },
        ]
      : {
          top: 80,
          left: 100,
          right: 30,
          cellSize: ['auto', 20],
          range: getCalendarRange(),
          itemStyle: {
            borderWidth: 0.5,
            borderColor: isDark ? '#1e293b' : '#cbd5e1',
          },
          yearLabel: { show: true, color: isDark ? '#fff' : '#1e293b' },
          monthLabel: { color: isDark ? '#94a3b8' : '#64748b' },
          dayLabel: { color: isDark ? '#94a3b8' : '#64748b' },
          splitLine: {
            show: true,
            lineStyle: {
              color: isDark ? '#334155' : '#e2e8f0',
              width: 2,
            },
          },
        },
    series: selectedYear === 'all'
      ? [
          {
            type: 'heatmap',
            coordinateSystem: 'calendar',
            calendarIndex: 0,
            data: calendarData.filter((item) => item[0].startsWith('2024')),
          },
          {
            type: 'heatmap',
            coordinateSystem: 'calendar',
            calendarIndex: 1,
            data: calendarData.filter((item) => item[0].startsWith('2025')),
          },
        ]
      : {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: calendarData,
        },
  };

  const getMetricDescription = () => {
    switch (selectedMetric) {
      case 'trades':
        return 'Number of trades closed per day';
      case 'volume':
        return 'Total investment volume per day';
      case 'pnl':
        return 'Daily profit/loss from closed trades';
      default:
        return '';
    }
  };

  const height = selectedYear === 'all' ? 520 : 280;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-semibold">Trading Activity Calendar</h2>
          <p className="text-sm text-muted-foreground mt-1">{getMetricDescription()}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={selectedMetric} onValueChange={(value) => setSelectedMetric(value as MetricType)}>
            <SelectTrigger className="w-[140px]">
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
          <div className="flex gap-2">
            {years.map((year) => (
              <Button
                key={year.value}
                variant={selectedYear === year.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedYear(year.value)}
              >
                {year.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className={`h-[${height}px] bg-slate-100 dark:bg-slate-950 rounded-lg p-4`} style={{ height: `${height}px` }}>
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
}
