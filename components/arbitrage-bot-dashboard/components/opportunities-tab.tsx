"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Download, Filter, Search, X, Zap } from "lucide-react";
import { useState } from "react";
import type { ArbitrageOpportunity } from "../types";
import { OpportunityDetailsModal } from "./modals/opportunity-details-modal";
import { OpportunityCard } from "./opportunity-card";

interface OpportunitiesTabProps {
  activeOpportunities: ArbitrageOpportunity[];
  completedOpportunities: ArbitrageOpportunity[];
  failedOpportunities: ArbitrageOpportunity[];
  onExecuteOpportunity: (opportunityId: string) => void;
}

export function OpportunitiesTab({ activeOpportunities, completedOpportunities, failedOpportunities, onExecuteOpportunity }: OpportunitiesTabProps) {
  const [selectedOpportunity, setSelectedOpportunity] = useState<ArbitrageOpportunity | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const handleViewDetails = (opportunity: ArbitrageOpportunity) => {
    setSelectedOpportunity(opportunity);
    setIsDetailsModalOpen(true);
  };

  const handleCloseDetails = () => {
    setIsDetailsModalOpen(false);
    setSelectedOpportunity(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <h3 className="text-lg font-medium">Arbitrage Opportunities</h3>
          <Badge>{activeOpportunities.length} Active</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search opportunities..." />
          </div>
          <Select defaultValue="all">
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="active" className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="min-w-[350px]">
            <TabsTrigger value="active" className="flex items-center gap-1">
              <Zap className="h-4 w-4" />
              Active
              <Badge variant="secondary" className="ml-1">
                {activeOpportunities.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="completed" className="flex items-center gap-1">
              <Check className="h-4 w-4" />
              Completed
              <Badge variant="secondary" className="ml-1">
                {completedOpportunities.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="failed" className="flex items-center gap-1">
              <X className="h-4 w-4" />
              Failed
              <Badge variant="secondary" className="ml-1">
                {failedOpportunities.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="active" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeOpportunities.length > 0 ? (
              activeOpportunities.map((opp) => <OpportunityCard key={opp.id} opportunity={opp} onExecute={onExecuteOpportunity} onViewDetails={handleViewDetails} />)
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                <Zap className="mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Active Opportunities</h3>
                <p className="text-sm text-muted-foreground">Opportunities will appear here when detected by your bots</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {completedOpportunities.length > 0 ? (
              completedOpportunities.map((opp) => <OpportunityCard key={opp.id} opportunity={opp} onViewDetails={handleViewDetails} />)
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                <Check className="mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Completed Opportunities</h3>
                <p className="text-sm text-muted-foreground">Successfully executed opportunities will appear here</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="failed" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {failedOpportunities.length > 0 ? (
              failedOpportunities.map((opp) => <OpportunityCard key={opp.id} opportunity={opp} onViewDetails={handleViewDetails} />)
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                <X className="mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Failed Opportunities</h3>
                <p className="text-sm text-muted-foreground">Failed arbitrage attempts will appear here</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Opportunity Details Modal */}
      <OpportunityDetailsModal opportunity={selectedOpportunity} isOpen={isDetailsModalOpen} onClose={handleCloseDetails} onExecute={onExecuteOpportunity} />
    </div>
  );
}
