"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Eye, Share2, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { NFTCollection } from "../../types";

interface NFTCollectionCardProps {
  collection: NFTCollection;
}

export function NFTCollectionCard({ collection }: NFTCollectionCardProps) {
  const [showDetails, setShowDetails] = useState(false);

  const handleViewCollection = () => {
    setShowDetails(true);
  };

  const handleExternalLink = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(price);
  };

  const priceChange = Math.random() * 20 - 10; // Mock price change
  const volume24h = collection.value * (Math.random() * 0.5 + 0.1); // Mock 24h volume

  return (
    <>
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{collection.name}</span>
            <Badge variant="secondary">{collection.chain}</Badge>
          </CardTitle>
          <CardDescription>Floor: {collection.floorPrice} ETH</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="aspect-square rounded-md bg-muted/30 flex items-center justify-center mb-4 overflow-hidden">
            <Image
              src="/placeholder.svg?height=200&width=200&text=NFT+Collection"
              alt={collection.name}
              width={200}
              height={200}
              className="h-full w-full object-cover rounded-md hover:scale-105 transition-transform cursor-pointer"
              onClick={handleViewCollection}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Items</div>
              <div className="font-medium">{collection.items}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Floor Price</div>
              <div className="font-medium">{collection.floorPrice} ETH</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Total Value</div>
              <div className="font-medium">{collection.value} ETH</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">USD Value</div>
              <div className="font-medium">${(collection.value * 3890).toLocaleString()}</div>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="outline" className="w-full bg-transparent" onClick={handleViewCollection}>
            <Eye className="mr-2 h-4 w-4" />
            View Collection
          </Button>
        </CardFooter>
      </Card>

      {/* Collection Details Modal */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {collection.name}
              <Badge variant="secondary">{collection.chain}</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Collection Image and Basic Info */}
            <div className="flex flex-col md:flex-row gap-6">
              <div className="flex-shrink-0">
                <Image src="/placeholder.svg?height=200&width=200&text=NFT+Collection" alt={collection.name} width={200} height={200} className="w-48 h-48 object-cover rounded-lg" />
              </div>
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Total Items</div>
                    <div className="text-2xl font-bold">{collection.items}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Owned</div>
                    <div className="text-2xl font-bold">{Math.floor(collection.items * 0.1)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Floor Price</div>
                    <div className="text-xl font-semibold">{collection.floorPrice} ETH</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">24h Change</div>
                    <div className={`text-xl font-semibold flex items-center ${priceChange >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {priceChange >= 0 ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}
                      {priceChange >= 0 ? "+" : ""}
                      {priceChange.toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Portfolio Summary */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Your Portfolio</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground">Total Value</div>
                  <div className="text-xl font-bold">{collection.value} ETH</div>
                  <div className="text-sm text-muted-foreground">${(collection.value * 3890).toLocaleString()}</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground">Avg. Cost</div>
                  <div className="text-xl font-bold">{formatPrice(collection.floorPrice * 0.8)} ETH</div>
                  <div className="text-sm text-muted-foreground">${(collection.floorPrice * 0.8 * 3890).toLocaleString()}</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-sm text-muted-foreground">Unrealized P&L</div>
                  <div className="text-xl font-bold text-green-600">+{formatPrice(collection.value * 0.2)} ETH</div>
                  <div className="text-sm text-green-600">+{((collection.floorPrice / (collection.floorPrice * 0.8) - 1) * 100).toFixed(1)}%</div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Market Stats */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Market Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">24h Volume</div>
                  <div className="font-semibold">{formatPrice(volume24h)} ETH</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Market Cap</div>
                  <div className="font-semibold">{formatPrice(collection.floorPrice * collection.items)} ETH</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Holders</div>
                  <div className="font-semibold">{Math.floor(collection.items * 0.6).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Listed</div>
                  <div className="font-semibold">{Math.floor(collection.items * 0.05)}</div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2 pt-4">
              <Button className="flex-1" onClick={() => handleExternalLink(`https://opensea.io/collection/${collection.name.toLowerCase().replace(/\s+/g, "-")}`)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                View on OpenSea
              </Button>
              <Button variant="outline" className="flex-1 bg-transparent" onClick={() => handleExternalLink(`https://etherscan.io/`)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                View Contract
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(`Check out my ${collection.name} NFT collection!`);
                }}
              >
                <Share2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
