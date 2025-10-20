"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { Download, Filter, Search, SlidersHorizontal } from "lucide-react";
import { ASSET_TYPES } from "../../constants";

interface AssetsFiltersProps {
  search: string;
  assetType: string;
  onSearchChange: (value: string) => void;
  onAssetTypeChange: (value: string) => void;
}

export function AssetsFilters({ search, assetType, onSearchChange, onAssetTypeChange }: AssetsFiltersProps) {
  const handleAdvancedFilters = () => {
    toast({
      title: "Advanced Filters",
      description: "Advanced filtering options will be available soon.",
    });
  };

  const handleColumnSettings = () => {
    toast({
      title: "Column Settings",
      description: "Column customization options will be available soon.",
    });
  };

  const handleExport = () => {
    toast({
      title: "Export Data",
      description: "Your assets data is being prepared for download.",
    });
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
      <div className="relative w-full sm:w-auto">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search assets..." className="pl-8 w-full sm:w-[200px]" value={search} onChange={(e) => onSearchChange(e.target.value)} />
      </div>
      <Select value={assetType} onValueChange={onAssetTypeChange}>
        <SelectTrigger className="w-full sm:w-[150px]">
          <SelectValue placeholder="Asset Type" />
        </SelectTrigger>
        <SelectContent>
          {ASSET_TYPES.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon">
              <Filter className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-sm mb-3">Filter Assets</h4>
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Price Range</Label>
                  <div className="mt-2">
                    <Slider defaultValue={[0, 100]} max={100} step={1} className="w-full" />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>$0</span>
                      <span>$100K+</span>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <Label className="text-sm font-medium mb-3 block">Performance</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="gainers" />
                      <Label htmlFor="gainers" className="text-sm">
                        Top Gainers
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="losers" />
                      <Label htmlFor="losers" className="text-sm">
                        Top Losers
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="stable" />
                      <Label htmlFor="stable" className="text-sm">
                        Stable Assets
                      </Label>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <Label className="text-sm font-medium mb-3 block">Holdings</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox id="large-holdings" />
                      <Label htmlFor="large-holdings" className="text-sm">
                        Large Holdings (&gt;$1K)
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="small-holdings" />
                      <Label htmlFor="small-holdings" className="text-sm">
                        Small Holdings (&lt;$100)
                      </Label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" size="sm">
                  Reset
                </Button>
                <Button size="sm" onClick={handleAdvancedFilters}>
                  Apply Filters
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="end">
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-sm mb-3">Column Settings</h4>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox id="col-asset" defaultChecked />
                  <Label htmlFor="col-asset" className="text-sm">
                    Asset
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="col-balance" defaultChecked />
                  <Label htmlFor="col-balance" className="text-sm">
                    Balance
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="col-value" defaultChecked />
                  <Label htmlFor="col-value" className="text-sm">
                    Value
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="col-change" defaultChecked />
                  <Label htmlFor="col-change" className="text-sm">
                    24h Change
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="col-allocation" />
                  <Label htmlFor="col-allocation" className="text-sm">
                    Allocation
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="col-actions" defaultChecked />
                  <Label htmlFor="col-actions" className="text-sm">
                    Actions
                  </Label>
                </div>
              </div>

              <div className="flex justify-between pt-4">
                <Button variant="outline" size="sm">
                  Reset
                </Button>
                <Button size="sm" onClick={handleColumnSettings}>
                  Apply
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon">
              <Download className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56" align="end">
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-sm mb-3">Export Options</h4>
              </div>

              <div className="space-y-2">
                <Button variant="ghost" className="w-full justify-start" size="sm" onClick={handleExport}>
                  Export as CSV
                </Button>
                <Button variant="ghost" className="w-full justify-start" size="sm" onClick={handleExport}>
                  Export as Excel
                </Button>
                <Button variant="ghost" className="w-full justify-start" size="sm" onClick={handleExport}>
                  Export as PDF
                </Button>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox id="include-history" />
                  <Label htmlFor="include-history" className="text-sm">
                    Include History
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox id="include-metadata" />
                  <Label htmlFor="include-metadata" className="text-sm">
                    Include Metadata
                  </Label>
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
