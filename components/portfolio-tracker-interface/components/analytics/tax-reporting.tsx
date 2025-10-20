import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { HelpCircle } from "lucide-react"

export function TaxReporting() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax Reporting</CardTitle>
        <CardDescription>Generate tax reports for your crypto transactions</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="text-lg font-medium">2023 Tax Year</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Generate a comprehensive tax report for the 2023 tax year.
              </div>
              <Button variant="outline" className="mt-4 w-full">
                Generate Report
              </Button>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-lg font-medium">2022 Tax Year</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Generate a comprehensive tax report for the 2022 tax year.
              </div>
              <Button variant="outline" className="mt-4 w-full">
                Generate Report
              </Button>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-lg font-medium">Custom Period</div>
              <div className="mt-2 text-sm text-muted-foreground">Generate a tax report for a custom date range.</div>
              <Button variant="outline" className="mt-4 w-full">
                Select Dates
              </Button>
            </div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
              <div className="text-sm text-muted-foreground">
                Tax reports include realized gains/losses, income from staking/lending, and cost basis calculations.
                Please consult with a tax professional for advice.
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
