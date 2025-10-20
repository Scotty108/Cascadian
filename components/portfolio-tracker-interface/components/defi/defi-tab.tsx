"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { DeFiPosition, FilterState } from "../../types";
import { AddPositionModal } from "../modals/add-position-modal";
import { DefiTable } from "./defi-table";

interface DeFiTabProps {
  positions: DeFiPosition[];
  filters: FilterState;
  onFiltersChange: (updates: Partial<FilterState>) => void;
}

export function DeFiTab({ positions, filters, onFiltersChange }: DeFiTabProps) {
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>DeFi Positions</CardTitle>
              <CardDescription>Your decentralized finance positions across various protocols</CardDescription>
            </div>
            <Button onClick={() => setShowAddPosition(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Position
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <DefiTable searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        </CardContent>
      </Card>

      <AddPositionModal open={showAddPosition} onOpenChange={setShowAddPosition} />
    </>
  );
}
