"use client"

import Image from "next/image";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency, getChangeColor } from "../../utils"
import type { Asset } from "../../types"

interface AssetsTableProps {
  assets: Asset[]
}

export function AssetsTable({ assets }: AssetsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Change (24h)</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((asset) => (
            <TableRow key={asset.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full overflow-hidden">
                    <Image
                      src={asset.logo || "/placeholder.svg"}
                      alt={asset.name}
                      className="h-full w-full object-cover"
                      width={32}
                      height={32}
                    />
                  </div>
                  <div>
                    <p className="font-medium">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">{asset.symbol}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right font-medium">{asset.amount}</TableCell>
              <TableCell className="text-right">{formatCurrency(asset.price)}</TableCell>
              <TableCell className="text-right">
                <span className={getChangeColor(asset.change)}>
                  {asset.change >= 0 ? "+" : ""}
                  {asset.change}%
                </span>
              </TableCell>
              <TableCell className="text-right">
                <p className="font-medium">{formatCurrency(asset.total)}</p>
                <p className="text-xs text-muted-foreground">{asset.btcValue.toFixed(4)} BTC</p>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
