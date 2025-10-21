'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Eye, Wallet, DollarSign } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { WhalePosition, WhaleActivityFilters } from '@/components/whale-activity-interface/types';

interface PositionsTabProps {
  filters: WhaleActivityFilters;
}

export function PositionsTab({ filters }: PositionsTabProps) {
  const [positions, setPositions] = useState<WhalePosition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPositions = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('timeframe', filters.timeframe);
        if (filters.min_amount) params.set('min_amount', filters.min_amount.toString());
        if (filters.max_amount) params.set('max_amount', filters.max_amount.toString());
        if (filters.categories?.length) params.set('category', filters.categories[0]);
        if (filters.wallets?.length) params.set('wallet', filters.wallets[0]);
        if (filters.min_sws) params.set('min_sws', filters.min_sws.toString());

        const response = await fetch(`/api/whale/positions?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setPositions(data.data);
        }
      } catch (error) {
        console.error('Error fetching positions:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPositions();
  }, [filters]);

  // Calculate summary metrics
  const totalInvested = positions.reduce((sum, p) => sum + p.invested_usd, 0);
  const totalValue = positions.reduce((sum, p) => sum + p.current_value_usd, 0);
  const totalPnL = positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading positions...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Invested</p>
              <p className="text-2xl font-bold mt-1">
                ${totalInvested.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <DollarSign className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Current Value</p>
              <p className="text-2xl font-bold mt-1">
                ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <Wallet className="h-8 w-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Unrealized P&L</p>
              <p className={`text-2xl font-bold mt-1 ${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            {totalPnL >= 0 ? (
              <TrendingUp className="h-8 w-8 text-green-500" />
            ) : (
              <TrendingDown className="h-8 w-8 text-red-500" />
            )}
          </div>
        </div>
      </div>

      {/* Positions Table */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Wallet</TableHead>
              <TableHead>Market</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">Avg Entry</TableHead>
              <TableHead className="text-right">Current Price</TableHead>
              <TableHead className="text-right">Invested</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">P&L</TableHead>
              <TableHead className="text-right">SWS</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                  No positions found matching the filters
                </TableCell>
              </TableRow>
            ) : (
              positions.map((position) => (
                <TableRow key={position.position_id}>
                  <TableCell>
                    <Link
                      href={`/analysis/wallet/${position.wallet_address}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {position.wallet_alias || position.wallet_address.slice(0, 8) + '...'}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/analysis/market/${position.market_id}`}
                      className="hover:underline max-w-[200px] truncate block"
                    >
                      {position.market_title}
                    </Link>
                    <span className="text-xs text-muted-foreground">{position.category}</span>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        position.side === 'YES'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      }`}
                    >
                      {position.side}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{position.shares.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{position.avg_entry_price.toFixed(2)}¢</TableCell>
                  <TableCell className="text-right">{position.current_price.toFixed(2)}¢</TableCell>
                  <TableCell className="text-right">
                    ${position.invested_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right">
                    ${position.current_value_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={position.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {position.unrealized_pnl >= 0 ? '+' : ''}
                      ${position.unrealized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      <span className="text-xs ml-1">({position.unrealized_pnl_pct.toFixed(1)}%)</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {position.sws_score ? (
                      <span className="font-medium">{position.sws_score.toFixed(1)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/analysis/wallet/${position.wallet_address}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {positions.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {positions.length} position{positions.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
