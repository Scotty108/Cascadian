"use client"

import type React from "react"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface StrategyTabsProps {
  activeTab: string
  onTabChange: (tab: string) => void
  children: React.ReactNode
}

export function StrategyTabs({ activeTab, onTabChange, children }: StrategyTabsProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
      <TabsList>
        <TabsTrigger value="all">All Strategies</TabsTrigger>
        <TabsTrigger value="featured">Featured</TabsTrigger>
        <TabsTrigger value="favorites">My Favorites</TabsTrigger>
        <TabsTrigger value="purchased">Purchased</TabsTrigger>
      </TabsList>
      {children}
    </Tabs>
  )
}
