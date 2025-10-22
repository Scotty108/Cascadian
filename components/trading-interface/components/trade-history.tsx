import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TradeHistoryItem } from "../types";

interface TradeHistoryProps {
  history: TradeHistoryItem[];
}

export function TradeHistory({ history }: TradeHistoryProps) {

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trade History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto" style={{ maxHeight: '600px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
              <thead className="sticky top-0 z-40 bg-background border-b border-border">
                <tr>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Time</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Type</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Pair</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Amount</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Price</th>
                  <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr className="border-b border-border hover:bg-muted/30 transition">
                    <td colSpan={6} className="px-2 py-1.5 align-middle text-center">
                      No trades yet.
                    </td>
                  </tr>
                ) : (
                  history.map((trade) => (
                    <tr key={trade.id} className="border-b border-border hover:bg-muted/30 transition">
                      <td className="px-2 py-1.5 align-middle">{trade.timestamp}</td>
                      <td className="px-2 py-1.5 align-middle">
                        <span
                          className={`font-medium ${
                            trade.type === "buy" ? "text-green-500" : "text-red-500"
                          }`}
                        >
                          {trade.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 align-middle">{trade.pair.toUpperCase()}</td>
                      <td className="px-2 py-1.5 align-middle">{trade.amount}</td>
                      <td className="px-2 py-1.5 align-middle">{trade.price}</td>
                      <td className="px-2 py-1.5 align-middle">{trade.total}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
