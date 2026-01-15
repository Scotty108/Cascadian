"use client";

import { AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import Link from "next/link";

export default function WalletNotFound() {
  return (
    <div className="min-h-screen bg-[#F1F1F1] dark:bg-[#0a0a0a] rounded-t-2xl relative z-40">
      <div className="w-full px-6 pt-12 pb-6">
        <Card className="max-w-lg mx-auto p-12 shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
          <div className="flex flex-col items-center justify-center gap-6 text-center">
            <div className="p-4 rounded-full bg-red-500/10">
              <AlertCircle className="h-12 w-12 text-red-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold mb-2">Wallet Not Found</h1>
              <p className="text-muted-foreground">
                We couldn&apos;t find this wallet. Please check the address or
                username and try again.
              </p>
            </div>
            <div className="flex gap-3 mt-4">
              <Button variant="outline" asChild>
                <Link href="/">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Go Home
                </Link>
              </Button>
              <Button asChild>
                <Link href="/leaderboard">View Leaderboard</Link>
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
