'use client';

import { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Info } from 'lucide-react';
import type { FlowData, WhaleActivityFilters } from '@/components/whale-activity-interface/types';

interface FlowsTabProps {
  filters: WhaleActivityFilters;
}

interface FlowAggregates {
  total_buy_volume: number;
  total_sell_volume: number;
  net_flow: number;
  sentiment: 'BULLISH' | 'BEARISH';
}

export function FlowsTab({ filters }: FlowsTabProps) {
  const [flows, setFlows] = useState<FlowData[]>([]);
  const [aggregates, setAggregates] = useState<FlowAggregates | null>(null);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  useEffect(() => {
    const fetchFlows = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('timeframe', filters.timeframe);

        const response = await fetch(`/api/whale/flows?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setFlows(data.data);
          setAggregates(data.aggregates);
        }
      } catch (error) {
        console.error('Error fetching flows:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFlows();
  }, [filters]);

  const chartOption = {
    backgroundColor: isDark ? '#0b1220' : '#f8fafc',
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
      },
      formatter: (params: any) => {
        const data = params[0];
        const index = data.dataIndex;
        const flow = flows[index];
        return `
          <div style="padding: 8px;">
            <strong>${new Date(flow.timestamp).toLocaleString()}</strong><br/>
            <span style="color: #22c55e;">● Buy Volume: $${flow.buy_volume.toLocaleString()}</span><br/>
            <span style="color: #ef4444;">● Sell Volume: $${flow.sell_volume.toLocaleString()}</span><br/>
            <strong>Net Flow: ${flow.net_flow >= 0 ? '+' : ''}$${flow.net_flow.toLocaleString()}</strong><br/>
            Buyers: ${flow.unique_buyers} | Sellers: ${flow.unique_sellers}
          </div>
        `;
      },
    },
    legend: {
      data: ['Buy Volume', 'Sell Volume', 'Net Flow'],
      textStyle: {
        color: isDark ? '#94a3b8' : '#64748b',
      },
      top: 10,
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '15%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: flows.map(f => new Date(f.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      axisLabel: {
        color: isDark ? '#94a3b8' : '#64748b',
        rotate: filters.timeframe === '7d' || filters.timeframe === '30d' ? 45 : 0,
      },
      axisLine: {
        lineStyle: {
          color: isDark ? '#334155' : '#e2e8f0',
        },
      },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Volume ($)',
        position: 'left',
        nameTextStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
        },
        axisLabel: {
          formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
          color: isDark ? '#94a3b8' : '#64748b',
        },
        axisLine: {
          lineStyle: {
            color: isDark ? '#334155' : '#e2e8f0',
          },
        },
        splitLine: {
          lineStyle: {
            color: isDark ? '#1e293b' : '#f1f5f9',
          },
        },
      },
      {
        type: 'value',
        name: 'Net Flow ($)',
        position: 'right',
        nameTextStyle: {
          color: isDark ? '#94a3b8' : '#64748b',
        },
        axisLabel: {
          formatter: (value: number) => `${value >= 0 ? '+' : ''}$${(value / 1000).toFixed(0)}k`,
          color: isDark ? '#94a3b8' : '#64748b',
        },
        axisLine: {
          lineStyle: {
            color: isDark ? '#334155' : '#e2e8f0',
          },
        },
        splitLine: {
          show: false,
        },
      },
    ],
    series: [
      {
        name: 'Buy Volume',
        type: 'line',
        data: flows.map(f => f.buy_volume),
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: isDark ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.2)' },
              { offset: 1, color: isDark ? 'rgba(34, 197, 94, 0.05)' : 'rgba(34, 197, 94, 0.01)' },
            ],
          },
        },
        lineStyle: {
          color: '#22c55e',
          width: 2,
        },
        itemStyle: {
          color: '#22c55e',
        },
        smooth: true,
      },
      {
        name: 'Sell Volume',
        type: 'line',
        data: flows.map(f => f.sell_volume),
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: isDark ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.2)' },
              { offset: 1, color: isDark ? 'rgba(239, 68, 68, 0.05)' : 'rgba(239, 68, 68, 0.01)' },
            ],
          },
        },
        lineStyle: {
          color: '#ef4444',
          width: 2,
        },
        itemStyle: {
          color: '#ef4444',
        },
        smooth: true,
      },
      {
        name: 'Net Flow',
        type: 'bar',
        yAxisIndex: 1,
        data: flows.map(f => f.net_flow),
        itemStyle: {
          color: (params: any) => {
            return params.value >= 0 ? '#22c55e' : '#ef4444';
          },
          opacity: 0.6,
        },
      },
    ],
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading flow data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info Card */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 p-4 rounded-lg">
        <div className="flex items-start gap-2">
          <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-blue-900 dark:text-blue-200">About Whale Flows</p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Whale flows track the aggregate buy and sell volume from large traders over time. Sustained net positive
              flow (more buying than selling) suggests bullish sentiment, while net negative flow suggests bearish sentiment.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {aggregates && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Buy Volume</p>
                <p className="text-2xl font-bold mt-1 text-green-600">
                  ${(aggregates.total_buy_volume / 1000).toFixed(0)}k
                </p>
              </div>
              <ArrowUpRight className="h-8 w-8 text-green-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Sell Volume</p>
                <p className="text-2xl font-bold mt-1 text-red-600">
                  ${(aggregates.total_sell_volume / 1000).toFixed(0)}k
                </p>
              </div>
              <ArrowDownRight className="h-8 w-8 text-red-500" />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Net Flow</p>
                <p className={`text-2xl font-bold mt-1 ${aggregates.net_flow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {aggregates.net_flow >= 0 ? '+' : ''}${(aggregates.net_flow / 1000).toFixed(0)}k
                </p>
              </div>
              {aggregates.net_flow >= 0 ? (
                <TrendingUp className="h-8 w-8 text-green-500" />
              ) : (
                <TrendingDown className="h-8 w-8 text-red-500" />
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Whale Sentiment</p>
                <p className={`text-2xl font-bold mt-1 ${aggregates.sentiment === 'BULLISH' ? 'text-green-600' : 'text-red-600'}`}>
                  {aggregates.sentiment}
                </p>
              </div>
              {aggregates.sentiment === 'BULLISH' ? (
                <TrendingUp className="h-8 w-8 text-green-500" />
              ) : (
                <TrendingDown className="h-8 w-8 text-red-500" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Flow Chart */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="text-lg font-semibold mb-4">Whale Flow Over Time</h3>
        <div className="h-[500px]">
          <ReactECharts
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      </div>
    </div>
  );
}
