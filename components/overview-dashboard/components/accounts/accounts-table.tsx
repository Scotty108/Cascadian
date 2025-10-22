"use client"

import Image from "next/image";
import { formatCurrency, getChangeColor } from "../../utils"
import type { Account } from "../../types"

interface AccountsTableProps {
  accounts: Account[]
}

export function AccountsTable({ accounts }: AccountsTableProps) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto" style={{ maxHeight: '600px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
          <thead className="sticky top-0 z-40 bg-background border-b border-border">
            <tr>
              <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">User</th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">UPNL</th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Funds Locked</th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Change (24h)</th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">Total Balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id} className="border-b border-border hover:bg-muted/30 transition">
                <td className="px-2 py-1.5 align-middle">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full overflow-hidden">
                      <Image
                        src={account.avatar || "/placeholder.svg"}
                        alt={account.name}
                        className="h-full w-full object-cover"
                        width={32}
                        height={32}
                      />
                    </div>
                    <div>
                      <p className="font-medium">{account.name}</p>
                      <p className="text-xs text-muted-foreground">{account.type}</p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5 align-middle text-right">
                  <span className={getChangeColor(account.upnl)}>
                    {account.upnl === 0 ? "$0.00" : (account.upnl > 0 ? "+" : "") + formatCurrency(account.upnl)}
                  </span>
                </td>
                <td className="px-2 py-1.5 align-middle text-right">{formatCurrency(account.fundsLocked)}</td>
                <td className="px-2 py-1.5 align-middle text-right">
                  <span className={getChangeColor(account.change)}>
                    {account.change === 0 ? "0.00%" : (account.change > 0 ? "+" : "") + account.change + "%"}
                  </span>
                </td>
                <td className="px-2 py-1.5 align-middle text-right font-medium">{formatCurrency(account.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
