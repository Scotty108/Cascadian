'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardTab } from '@/components/insiders/dashboard-tab';
import { MarketWatchTab } from '@/components/insiders/market-watch-tab';

export default function InsidersPage() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Insiders Detection</h1>
        <p className="text-muted-foreground">
          Monitor suspicious trading patterns and potential insider activity across markets
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 lg:w-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="market-watch">Market Watch</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <DashboardTab />
        </TabsContent>

        <TabsContent value="market-watch" className="space-y-6">
          <MarketWatchTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
