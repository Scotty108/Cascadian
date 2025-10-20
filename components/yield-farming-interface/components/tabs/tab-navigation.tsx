"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Filter, Search } from "lucide-react";

interface TabNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
}

export function TabNavigation({ activeTab, onTabChange, searchQuery, onSearchChange, showFilters, onToggleFilters }: TabNavigationProps) {
  return (
    <div className="sm:flex flex-col flex-wrap gap-4 sm:flex-row sm:items-center sm:justify-between ">
      <div className=" overflow-x-auto">
        <div className="min-w-[450px]">
          <TabsList>
            <TabsTrigger value="all" onClick={() => onTabChange("all")}>
              All Farms
            </TabsTrigger>
            <TabsTrigger value="my-farms" onClick={() => onTabChange("my-farms")}>
              My Farms
            </TabsTrigger>
            <TabsTrigger value="favorites" onClick={() => onTabChange("favorites")}>
              Favorites
            </TabsTrigger>
            <TabsTrigger value="analytics" onClick={() => onTabChange("analytics")}>
              Analytics
            </TabsTrigger>
          </TabsList>
        </div>
      </div>

      <div className="flex items-center flex-wrap gap-2 max-sm:mt-2">
        <div className="relative  sm:w-64">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search protocols or assets..." className="pl-8" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} />
        </div>
        <Button variant="outline" size="icon" onClick={onToggleFilters} className={showFilters ? "bg-muted" : ""}>
          <Filter className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
