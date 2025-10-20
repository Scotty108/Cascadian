"use client"

import { useState } from "react"
import { NFTFilters } from "./nft-filters"
import { NFTGrid } from "./nft-grid"

export function NFTsTab() {
  const [selectedCollection, setSelectedCollection] = useState("all")

  return (
    <div className="space-y-4">
      <NFTFilters selectedCollection={selectedCollection} onCollectionChange={setSelectedCollection} />
      <NFTGrid />
    </div>
  )
}
