'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FilterBar } from '@/components/whale-activity/filter-bar';
import { PositionsTab } from '@/components/whale-activity/positions-tab';
import { TradesTab } from '@/components/whale-activity/trades-tab';
import { ScoreboardTab } from '@/components/whale-activity/scoreboard-tab';
import { UnusualTradesTab } from '@/components/whale-activity/unusual-trades-tab';
import { ConcentrationTab } from '@/components/whale-activity/concentration-tab';
import { FlipsTab } from '@/components/whale-activity/flips-tab';
import { FlowsTab } from '@/components/whale-activity/flows-tab';
import type { WhaleActivityFilters } from '@/components/whale-activity-interface/types';

export default function WhaleActivityPage() {
  const [filters, setFilters] = useState<WhaleActivityFilters>({
    timeframe: '24h',
    action: 'all',
    side: 'all',
  });

  const [activeTab, setActiveTab] = useState('trades');

  return (
    <Card className="shadow-sm rounded-2xl overflow-hidden border-0 dark:bg-[#18181b]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Whale Activity</h1>
        <p className="text-sm text-muted-foreground">
          Track large trader positions, trades, and market-moving activity in real-time
        </p>
      </div>

      <div className="px-6 py-6 space-y-6">
        {/* Filter Bar */}
        <FilterBar filters={filters} onFiltersChange={setFilters} />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 md:grid-cols-7 lg:w-auto">
            <TabsTrigger value="trades">Live Trades</TabsTrigger>
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="unusual">Unusual</TabsTrigger>
            <TabsTrigger value="scoreboard">Scoreboard</TabsTrigger>
            <TabsTrigger value="concentration">Concentration</TabsTrigger>
            <TabsTrigger value="flips">Flips</TabsTrigger>
            <TabsTrigger value="flows">Flows</TabsTrigger>
          </TabsList>

          <TabsContent value="trades" className="space-y-6">
            <TradesTab filters={filters} />
          </TabsContent>

          <TabsContent value="positions" className="space-y-6">
            <PositionsTab filters={filters} />
          </TabsContent>

          <TabsContent value="unusual" className="space-y-6">
            <UnusualTradesTab filters={filters} />
          </TabsContent>

          <TabsContent value="scoreboard" className="space-y-6">
            <ScoreboardTab filters={filters} />
          </TabsContent>

          <TabsContent value="concentration" className="space-y-6">
            <ConcentrationTab filters={filters} />
          </TabsContent>

          <TabsContent value="flips" className="space-y-6">
            <FlipsTab filters={filters} />
          </TabsContent>

          <TabsContent value="flows" className="space-y-6">
            <FlowsTab filters={filters} />
          </TabsContent>
        </Tabs>
      </div>
    </Card>
  );
}
