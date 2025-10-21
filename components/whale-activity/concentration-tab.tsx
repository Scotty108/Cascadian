'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { Info, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { ConcentrationData, WhaleActivityFilters } from '@/components/whale-activity-interface/types';

interface ConcentrationTabProps {
  filters: WhaleActivityFilters;
}

export function ConcentrationTab({ filters }: ConcentrationTabProps) {
  const [data, setData] = useState<ConcentrationData[]>([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  useEffect(() => {
    const fetchConcentration = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('limit', '20');
        params.set('sort_by', 'whale_share_pct');

        const response = await fetch(`/api/whale/concentration?${params.toString()}`);
        const result = await response.json();

        if (result.success) {
          setData(result.data);
        }
      } catch (error) {
        console.error('Error fetching concentration:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchConcentration();
  }, [filters]);

  const getConcentrationColor = (whaleSharePct: number) => {
    if (whaleSharePct >= 80) return isDark ? '#7f1d1d' : '#991b1b'; // Very high - red
    if (whaleSharePct >= 70) return isDark ? '#ea580c' : '#f97316'; // High - orange
    if (whaleSharePct >= 60) return isDark ? '#ca8a04' : '#eab308'; // Medium - yellow
    if (whaleSharePct >= 50) return isDark ? '#16a34a' : '#22c55e'; // Low - green
    return isDark ? '#065f46' : '#14532d'; // Very low - dark green
  };

  const chartOption = {
    backgroundColor: isDark ? '#0b1220' : '#f8fafc',
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        const item = data[params.dataIndex];
        return `
          <div style="padding: 8px;">
            <strong>${item.market_title}</strong><br/>
            Whale Share: <strong>${item.whale_share_pct.toFixed(1)}%</strong><br/>
            Concentration (HHI): <strong>${item.herfindahl_index.toFixed(2)}</strong><br/>
            Volume: $${item.total_whale_volume.toLocaleString()}<br/>
            Whales: ${item.unique_whales}<br/>
            Sentiment: <strong>${item.sentiment}</strong>
          </div>
        `;
      },
    },
    grid: {
      left: '3%',
      right: '3%',
      bottom: '10%',
      top: '10%',
      containLabel: true,
    },
    xAxis: {
      type: 'value',
      name: 'Whale Share of Market (%)',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: {
        color: isDark ? '#94a3b8' : '#64748b',
        fontSize: 12,
      },
      axisLabel: {
        formatter: '{value}%',
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
    yAxis: {
      type: 'value',
      name: 'Concentration Index (HHI)',
      nameLocation: 'middle',
      nameGap: 50,
      nameTextStyle: {
        color: isDark ? '#94a3b8' : '#64748b',
        fontSize: 12,
      },
      axisLabel: {
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
    series: [
      {
        type: 'scatter',
        symbolSize: (dataItem: number[]) => {
          // Size based on total volume (index 2)
          return Math.max(10, Math.min(60, dataItem[2] / 5000));
        },
        data: data.map(item => [
          item.whale_share_pct,
          item.herfindahl_index,
          item.total_whale_volume,
          item.market_title,
        ]),
        itemStyle: {
          color: (params: any) => {
            return getConcentrationColor(params.value[0]);
          },
          opacity: 0.8,
        },
        emphasis: {
          itemStyle: {
            opacity: 1,
            shadowBlur: 10,
            shadowColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)',
          },
        },
      },
    ],
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading concentration data...</div>
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
            <p className="font-medium text-blue-900 dark:text-blue-200">About Market Concentration</p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              This chart shows how concentrated whale trading is in each market. Higher whale share % means whales control
              more of the market volume. Higher HHI (Herfindahl Index) means trading is concentrated among fewer wallets.
            </p>
          </div>
        </div>
      </div>

      {/* Scatter Chart */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="text-lg font-semibold mb-4">Whale Concentration by Market</h3>
        <div className="h-[400px]">
          <ReactECharts
            option={chartOption}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
        <div className="mt-4 text-xs text-muted-foreground text-center">
          Bubble size = Total whale volume | Color = Concentration risk (red = high, green = low)
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Market</TableHead>
              <TableHead className="text-right">Whale Share</TableHead>
              <TableHead className="text-right">HHI</TableHead>
              <TableHead className="text-right">Total Volume</TableHead>
              <TableHead className="text-right">Unique Whales</TableHead>
              <TableHead className="text-right">Top Whale</TableHead>
              <TableHead className="text-right">Sentiment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.market_id}>
                <TableCell>
                  <Link
                    href={`/analysis/market/${item.market_id}`}
                    className="hover:underline max-w-[300px] truncate block"
                  >
                    {item.market_title}
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className={`font-medium ${item.whale_share_pct >= 70 ? 'text-red-600' : ''}`}>
                      {item.whale_share_pct.toFixed(1)}%
                    </span>
                    {item.whale_share_pct >= 70 && <AlertTriangle className="h-4 w-4 text-red-500" />}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <span className={item.herfindahl_index >= 0.25 ? 'text-amber-600' : ''}>
                    {item.herfindahl_index.toFixed(2)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  ${item.total_whale_volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell className="text-right">{item.unique_whales}</TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/analysis/wallet/${item.top_wallet.address}`}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {item.top_wallet.alias || item.top_wallet.address.slice(0, 8) + '...'}
                  </Link>
                  <div className="text-xs text-muted-foreground">{item.top_wallet.share_pct.toFixed(1)}%</div>
                </TableCell>
                <TableCell className="text-right">
                  <Badge
                    variant={item.sentiment === 'BULLISH' ? 'default' : item.sentiment === 'BEARISH' ? 'destructive' : 'secondary'}
                    className="flex items-center gap-1 w-fit ml-auto"
                  >
                    {item.sentiment === 'BULLISH' && <TrendingUp className="h-3 w-3" />}
                    {item.sentiment === 'BEARISH' && <TrendingDown className="h-3 w-3" />}
                    {item.sentiment}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {data.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {data.length} market{data.length !== 1 ? 's' : ''} with whale activity
        </div>
      )}
    </div>
  );
}
