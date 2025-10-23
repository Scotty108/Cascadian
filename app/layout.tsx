'use client'

import "@/app/globals.css";
import ThemeProvider from "@/components/theme-provider";
import { SettingsApplier } from "@/components/settings-applier";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Inter } from "next/font/google";
import type React from "react";
import { useState } from "react";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Create QueryClient instance in component state to ensure it persists across renders
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 minutes (matches backend sync interval)
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 2,
      },
    },
  }))

  return (
    <html lang="en">
      <head>
        <title>CASCADIAN</title>
        <meta name="description" content="Agentic Intelligence for Prediction Markets" />
      </head>
      <body className={inter.className}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <SettingsApplier />
            {children}
          </ThemeProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
