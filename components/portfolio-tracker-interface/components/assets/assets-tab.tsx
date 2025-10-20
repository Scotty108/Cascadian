"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { Asset, FilterState } from "../../types";
import { AddAssetModal } from "../modals/add-asset-modal";
import { AssetFilters } from "./asset-filters";
import { AssetsTable } from "./assets-table";

interface AssetsTabProps {
  assets: Asset[];
  filters: FilterState;
  onFiltersChange: (filters: Partial<FilterState>) => void;
  onAssetClick?: (asset: Asset) => void;
}

export function AssetsTab({ assets, filters, onFiltersChange, onAssetClick }: AssetsTabProps) {
  const [showAddAsset, setShowAddAsset] = useState(false);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle>Assets</CardTitle>
              <CardDescription>Your cryptocurrency holdings across all connected wallets and exchanges</CardDescription>
            </div>
            <Button onClick={() => setShowAddAsset(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Asset
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <AssetFilters filters={filters} onFiltersChange={onFiltersChange} />
          <AssetsTable assets={assets} onAssetClick={onAssetClick} />
        </CardContent>
      </Card>

      <AddAssetModal open={showAddAsset} onOpenChange={setShowAddAsset} />
    </>
  );
}
