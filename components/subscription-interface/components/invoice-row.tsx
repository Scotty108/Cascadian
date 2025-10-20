"use client"

import { Download, Receipt } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import type { Invoice } from "../types"

interface InvoiceRowProps {
  invoice: Invoice
  onDownload: (invoiceId: string) => void
  onView: (invoiceId: string) => void
  isDownloading?: boolean
}

export function InvoiceRow({ invoice, onDownload, onView, isDownloading }: InvoiceRowProps) {
  return (
    <TableRow>
      <TableCell className="font-medium">{invoice.id}</TableCell>
      <TableCell>{invoice.date}</TableCell>
      <TableCell>{invoice.amount}</TableCell>
      <TableCell>
        <Badge variant="outline" className="bg-green-500/10 text-green-500">
          {invoice.status}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => onDownload(invoice.id)} disabled={isDownloading}>
            <Download className="h-4 w-4" />
            <span className="sr-only">Download</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onView(invoice.id)}>
            <Receipt className="h-4 w-4" />
            <span className="sr-only">View</span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
