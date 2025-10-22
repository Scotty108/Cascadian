"use client"

import Image from "next/image";
import { formatCurrency, getChangeColor } from "../../utils"
import type { Asset } from "../../types"

interface AssetsTableProps {
  assets: Asset[]
}

export function AssetsTable({ assets }: AssetsTableProps) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto" style={{ maxHeight: '600px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
          <thead className="sticky top-0 z-40 bg-background border-b border-border">
            <tr>
              <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Asset</th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Amount</th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Price</th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Change (24h)</th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id} className="border-b border-border hover:bg-muted/30 transition">
                <td className="px-2 py-1.5 align-middle">
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
                </td>
                <td className="px-2 py-1.5 align-middle text-right font-medium">{asset.amount}</td>
                <td className="px-2 py-1.5 align-middle text-right">{formatCurrency(asset.price)}</td>
                <td className="px-2 py-1.5 align-middle text-right">
                  <span className={getChangeColor(asset.change)}>
                    {asset.change >= 0 ? "+" : ""}
                    {asset.change}%
                  </span>
                </td>
                <td className="px-2 py-1.5 align-middle text-right">
                  <p className="font-medium">{formatCurrency(asset.total)}</p>
                  <p className="text-xs text-muted-foreground">{asset.btcValue.toFixed(4)} BTC</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
