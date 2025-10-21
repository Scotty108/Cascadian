'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Eye, Shield, Clock } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Wallet</TableHead>
              <TableHead className="text-right">Insider Score</TableHead>
              <TableHead className="text-right">Timing</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">Outcome</TableHead>
              <TableHead className="text-right">Cluster</TableHead>
              <TableHead className="text-right">Win Rate</TableHead>
              <TableHead className="text-right">Avg Time</TableHead>
              <TableHead className="text-right">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {wallets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                  No flagged wallets found
                </TableCell>
              </TableRow>
            ) : (
              wallets.map((wallet) => (
                <TableRow key={wallet.address} className={wallet.investigation_status === 'flagged' ? 'bg-red-50 dark:bg-red-950/10' : ''}>
                  <TableCell>
                    <Link
                      href={`/analysis/wallet/${wallet.address}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      {wallet.alias || wallet.address.slice(0, 8) + '...'}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`text-xl font-bold ${getScoreColor(wallet.insider_score)}`}>
                      {wallet.insider_score.toFixed(1)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm">{wallet.timing_score.toFixed(1)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm">{wallet.volume_score.toFixed(1)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm">{wallet.outcome_score.toFixed(1)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm">{wallet.cluster_score.toFixed(1)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={wallet.win_rate >= 0.75 ? 'text-red-600 font-medium' : ''}>
                      {(wallet.win_rate * 100).toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={wallet.avg_time_to_outcome_minutes < 60 ? 'text-red-600 font-medium' : ''}>
                      {wallet.avg_time_to_outcome_minutes}m
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {getStatusBadge(wallet.investigation_status)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/analysis/wallet/${wallet.address}`}>
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

      {wallets.length > 0 && (
        <div className="text-sm text-muted-foreground text-center">
          Showing {wallets.length} flagged wallet{wallets.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
