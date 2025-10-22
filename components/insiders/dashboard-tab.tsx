'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Eye, Shield, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { InsiderWallet } from '@/components/whale-activity-interface/types';

export function DashboardTab() {
  const [wallets, setWallets] = useState<InsiderWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const fetchWallets = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('min_score', '4.0');
        if (statusFilter !== 'all') params.set('status', statusFilter);

        const response = await fetch(`/api/insiders/wallets?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setWallets(data.data);
        }
      } catch (error) {
        console.error('Error fetching insider wallets:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchWallets();
  }, [statusFilter]);

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-red-600 dark:text-red-400';
    if (score >= 7) return 'text-orange-600 dark:text-orange-400';
    if (score >= 6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-blue-600 dark:text-blue-400';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'flagged':
        return <Badge variant="destructive">Flagged</Badge>;
      case 'monitoring':
        return <Badge variant="default" className="bg-amber-500">Monitoring</Badge>;
      case 'confirmed':
        return <Badge variant="destructive">Confirmed</Badge>;
      case 'cleared':
        return <Badge variant="outline">Cleared</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading flagged wallets...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alert Banner */}
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-4 rounded-lg">
        <div className="flex items-start gap-2">
          <Shield className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-900 dark:text-red-200">Insider Activity Detection</p>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              These wallets exhibit suspicious patterns consistent with insider trading: unusual timing (trades right
              before major events), high win rates with minimal time to outcome, and coordinated cluster behavior.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Flagged Wallets</p>
              <p className="text-2xl font-bold mt-1 text-red-600">
                {wallets.filter(w => w.investigation_status === 'flagged').length}
              </p>
            </div>
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Monitoring</p>
              <p className="text-2xl font-bold mt-1 text-amber-600">
                {wallets.filter(w => w.investigation_status === 'monitoring').length}
              </p>
            </div>
            <Clock className="h-8 w-8 text-amber-500" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Avg Insider Score</p>
              <p className="text-2xl font-bold mt-1">
                {(wallets.reduce((sum, w) => sum + w.insider_score, 0) / wallets.length).toFixed(1)}
              </p>
            </div>
            <Shield className="h-8 w-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Volume</p>
              <p className="text-2xl font-bold mt-1">
                ${(wallets.reduce((sum, w) => sum + w.total_volume, 0) / 1000).toFixed(0)}k
              </p>
            </div>
            <Eye className="h-8 w-8 text-green-500" />
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">Filter by status:</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="flagged">Flagged</SelectItem>
            <SelectItem value="monitoring">Monitoring</SelectItem>
            <SelectItem value="cleared">Cleared</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Wallets Table */}
      <div className="border rounded-lg overflow-hidden">
        <div
          className="overflow-x-auto"
          style={{
            maxHeight: '600px',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
            <thead className="sticky top-0 z-40 bg-background border-b border-border">
              <tr>
                <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Wallet</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Insider Score</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Timing</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Volume</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Outcome</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Cluster</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Win Rate</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Avg Time</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Status</th>
                <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {wallets.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-2 py-8 text-center text-muted-foreground">
                    No flagged wallets found
                  </td>
                </tr>
              ) : (
                wallets.map((wallet) => (
                  <tr key={wallet.address} className={`border-b border-border hover:bg-muted/30 transition ${wallet.investigation_status === 'flagged' ? 'bg-red-50 dark:bg-red-950/10' : ''}`}>
                    <td className="px-2 py-1.5 align-middle">
                      <Link
                        href={`/analysis/wallet/${wallet.address}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {wallet.alias || wallet.address.slice(0, 8) + '...'}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <span className={`text-xl font-bold ${getScoreColor(wallet.insider_score)}`}>
                        {wallet.insider_score.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <span className="text-sm">{wallet.timing_score.toFixed(1)}</span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <span className="text-sm">{wallet.volume_score.toFixed(1)}</span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <span className="text-sm">{wallet.outcome_score.toFixed(1)}</span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <span className="text-sm">{wallet.cluster_score.toFixed(1)}</span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <span className={wallet.win_rate >= 0.75 ? 'text-red-600 font-medium' : ''}>
                        {(wallet.win_rate * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <span className={wallet.avg_time_to_outcome_minutes < 60 ? 'text-red-600 font-medium' : ''}>
                        {wallet.avg_time_to_outcome_minutes}m
                      </span>
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      {getStatusBadge(wallet.investigation_status)}
                    </td>
                    <td className="px-2 py-1.5 align-middle text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/analysis/wallet/${wallet.address}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {wallets.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {wallets.length} flagged wallet{wallets.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
