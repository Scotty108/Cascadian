import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { NetworkBadge } from "../../shared/network-badge"
import { mockNFTs } from "../../../data"

export function NFTGrid() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {mockNFTs.map((nft) => (
        <Card key={nft.id} className="overflow-hidden">
          <div className="aspect-square w-full">
            <Image src={nft.image || "/placeholder.svg"} alt={nft.name} width={300} height={300} className="h-full w-full object-cover" />
          </div>
          <CardContent className="p-4">
            <h4 className="font-medium">{nft.name}</h4>
            <p className="text-sm text-muted-foreground">{nft.collection}</p>
            <div className="mt-2 flex items-center justify-between">
              <NetworkBadge networkId={nft.networkId} showName size="sm" />
              <Badge variant="outline">Floor: {nft.floorPrice}</Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
