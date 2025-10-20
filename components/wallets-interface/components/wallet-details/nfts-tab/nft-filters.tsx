"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface NFTFiltersProps {
  selectedCollection: string;
  onCollectionChange: (collection: string) => void;
}

export function NFTFilters({ selectedCollection, onCollectionChange }: NFTFiltersProps) {
  return (
    <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
      <div>
        <h3 className="text-lg font-medium">NFT Collection</h3>
        <p className="text-sm text-muted-foreground">View and manage your NFT collection</p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={selectedCollection} onValueChange={onCollectionChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select Collection" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Collections</SelectItem>
            <SelectItem value="bayc">Bored Ape Yacht Club</SelectItem>
            <SelectItem value="punks">CryptoPunks</SelectItem>
            <SelectItem value="azuki">Azuki</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
