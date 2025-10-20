"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { NFTCollectionCard } from "./nft-collection-card"
import { AddNftModal } from "../modals/add-nft-modal"
import type { NFTCollection, FilterState } from "../../types"

interface NFTsTabProps {
  collections: NFTCollection[]
  
}

export function NFTsTab({ collections }: NFTsTabProps) {
  const [showAddNft, setShowAddNft] = useState(false)

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>NFT Collections</CardTitle>
              <CardDescription>Your non-fungible token collections and individual NFTs</CardDescription>
            </div>
            <Button onClick={() => setShowAddNft(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add NFT
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <NFTCollectionCard key={collection.id} collection={collection} />
            ))}
          </div>
        </CardContent>
      </Card>

      <AddNftModal open={showAddNft} onOpenChange={setShowAddNft} />
    </>
  )
}
