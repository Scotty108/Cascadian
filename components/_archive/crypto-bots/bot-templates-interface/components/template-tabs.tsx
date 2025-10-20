"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Award, Heart, LayoutDashboard, Sparkles } from "lucide-react";

interface TemplateTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function TemplateTabs({ activeTab, onTabChange }: TemplateTabsProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <div className="overflow-x-auto">
        <div className="min-w-[450px]">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="all" className="flex items-center gap-1">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">All Templates</span>
              <span className="sm:hidden">All</span>
            </TabsTrigger>
            <TabsTrigger value="featured" className="flex items-center gap-1">
              <Award className="h-4 w-4" />
              <span className="hidden sm:inline">Featured</span>
              <span className="sm:hidden">Featured</span>
            </TabsTrigger>
            <TabsTrigger value="new" className="flex items-center gap-1">
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">New Arrivals</span>
              <span className="sm:hidden">New</span>
            </TabsTrigger>
            <TabsTrigger value="favorites" className="flex items-center gap-1">
              <Heart className="h-4 w-4" />
              <span className="hidden sm:inline">My Favorites</span>
              <span className="sm:hidden">Favorites</span>
            </TabsTrigger>
          </TabsList>
        </div>
      </div>
    </Tabs>
  );
}
