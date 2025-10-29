'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardTab } from '@/components/insiders/dashboard-tab';
import { MarketWatchTab } from '@/components/insiders/market-watch-tab';
import { Activity, Shield } from 'lucide-react';

export default function InsidersPage() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Detection System</span>
          </div>
          <Badge variant="outline" className="border-border/50">
            <Activity className="h-3 w-3 mr-1" />
            Live Monitoring
          </Badge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Insiders Detection</h1>
        <p className="text-sm text-muted-foreground">
          Monitor suspicious trading patterns and potential insider activity across markets
        </p>
      </div>

      {/* Tabs */}
      <div className="px-6 py-4 border-b border-border/50">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 lg:w-auto">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="market-watch">Market Watch</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsContent value="dashboard" className="mt-0">
            <DashboardTab />
          </TabsContent>

          <TabsContent value="market-watch" className="mt-0">
            <MarketWatchTab />
          </TabsContent>
        </Tabs>
      </div>
    </Card>
  );
}
