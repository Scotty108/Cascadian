"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { AssetData } from "../types";

interface AssetListProps {
  assets: AssetData[];
}

export function AssetList({ assets }: AssetListProps) {
  return (
    <Card className="lg:col-span-4">
      <CardHeader>
        <CardTitle>Asset List</CardTitle>
      </CardHeader>
      <CardContent className="block overflow-x-auto">
        <div className="space-y-4 min-w-[550px]">
          <div className="grid grid-cols-5 gap-4">
            <div className="col-span-2 font-medium">Asset</div>
            <div className="font-medium">Price</div>
            <div className="font-medium">Holdings</div>
            <div className="font-medium">Value</div>
          </div>

          {assets
            .filter((asset) => asset.symbol)
            .map((asset, index) => (
              <div key={index} className="grid grid-cols-5 gap-4">
                <div className="col-span-2">
                  <div className="font-medium">{asset.name}</div>
                  <div className="text-xs text-muted-foreground">{asset.symbol}</div>
                </div>
                <div>${asset.price?.toLocaleString()}</div>
                <div>{asset.holdings}</div>
                <div>${asset.value.toLocaleString()}</div>
              </div>
            ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" href="/portfolio-tracker">
          View All Assets
        </Button>
      </CardFooter>
    </Card>
  );
}
