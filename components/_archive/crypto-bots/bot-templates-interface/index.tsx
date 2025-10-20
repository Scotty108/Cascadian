"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useState } from "react";
import { EmptyState } from "./components/empty-state";
import { SearchBar } from "./components/search-bar";
import { TemplateCard } from "./components/template-card";
import { TemplateDetailsModal } from "./components/template-details-modal";
import { TemplateTabs } from "./components/template-tabs";
import { SORT_OPTIONS } from "./constants";
import { useFilters } from "./hooks/use-filters";
import { useTemplates } from "./hooks/use-templates";
import type { BotTemplate } from "./types";

export function BotTemplatesInterface() {
  const { templates, toggleFavorite } = useTemplates();
  const { filters, filteredAndSortedTemplates, showFilters, setShowFilters, updateFilter, resetFilters, hasActiveFilters } = useFilters(templates);

  const [selectedTemplate, setSelectedTemplate] = useState<BotTemplate | null>(null);
  const [showTemplateDetails, setShowTemplateDetails] = useState(false);

  const openTemplateDetails = (template: BotTemplate) => {
    setSelectedTemplate(template);
    setShowTemplateDetails(true);
  };

  const closeTemplateDetails = () => {
    setShowTemplateDetails(false);
    setSelectedTemplate(null);
  };

  return (
    <div className=" space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bot Templates</h1>
        <p className="text-muted-foreground">Browse, customize, and deploy trading bot templates for your crypto trading strategy</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar searchQuery={filters.searchQuery} onSearchChange={(query) => updateFilter("searchQuery", query)} />

        <div className="flex flex-wrap items-center gap-2">
          <Select value={filters.sortBy} onValueChange={(value) => updateFilter("sortBy", value)}>
            <SelectTrigger className="h-9 w-[180px] sm:w-[200px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <TemplateTabs activeTab={filters.activeTab} onTabChange={(tab) => updateFilter("activeTab", tab)} />

      <Tabs value={filters.activeTab}>
        <TabsContent value={filters.activeTab} className="mt-6">
          {filteredAndSortedTemplates.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredAndSortedTemplates.map((template) => (
                <TemplateCard key={template.id} template={template} onToggleFavorite={toggleFavorite} onOpenDetails={openTemplateDetails} />
              ))}
            </div>
          ) : (
            <EmptyState onResetFilters={resetFilters} />
          )}
        </TabsContent>
      </Tabs>

      <TemplateDetailsModal template={selectedTemplate} isOpen={showTemplateDetails} onClose={closeTemplateDetails} onToggleFavorite={toggleFavorite} />
    </div>
  );
}
