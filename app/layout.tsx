import "@/app/globals.css";
import { Providers } from "@/components/providers";
import { Inter } from "next/font/google";
import type React from "react";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <title>CASCADIAN</title>
        <meta name="description" content="Agentic Intelligence for Prediction Markets" />
      </head>
      <body className={inter.className}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
