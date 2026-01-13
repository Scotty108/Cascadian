import "@/app/globals.css";
import { Providers } from "@/components/providers";
import { Inter } from "next/font/google";
import type { Metadata } from "next";
import type React from "react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CASCADIAN",
  description: "Agentic Intelligence for Prediction Markets",
  icons: {
    icon: [
      {
        url: '/brand/icon-light.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/brand/icon-dark.png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
