import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Invoice } from "../types"
import { InvoiceRow } from "./invoice-row"

interface BillingHistoryTabProps {
  billingHistory: Invoice[]
  onDownloadInvoice: (invoiceId: string) => void
  onViewInvoice: (invoiceId: string) => void
  isDownloading?: string | null
}

export function BillingHistoryTab({
  billingHistory,
  onDownloadInvoice,
  onViewInvoice,
  isDownloading,
}: BillingHistoryTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing History</CardTitle>
        <CardDescription>View and download your past invoices</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billingHistory.map((invoice) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  onDownload={onDownloadInvoice}
                  onView={onViewInvoice}
                  isDownloading={isDownloading === invoice.id}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
