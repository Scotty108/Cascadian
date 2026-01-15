import { WalletProfileV2 } from "@/components/wallet-v2";
import { Metadata } from "next";
import { redirect, notFound } from "next/navigation";

interface WalletPageProps {
  params: Promise<{ identifier: string }>;
}

// Resolve username to address using Polymarket API
async function resolveIdentifier(identifier: string): Promise<string | null> {
  // If it's already an address, return it
  if (identifier.match(/^0x[a-fA-F0-9]{40}$/i)) {
    return identifier.toLowerCase();
  }

  // If it starts with @, strip it
  const username = identifier.startsWith("@") ? identifier.slice(1) : identifier;

  // Try to look up the address by username using Polymarket's gamma API
  try {
    const response = await fetch(
      `https://gamma-api.polymarket.com/users?username=${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Cascadian/1.0)",
        },
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (response.ok) {
      const users = await response.json();
      if (users && users.length > 0 && users[0].proxyWallet) {
        return users[0].proxyWallet.toLowerCase();
      }
    }
  } catch (e) {
    console.error("Failed to resolve username:", e);
  }

  return null;
}

export default async function WalletPage({ params }: WalletPageProps) {
  const { identifier } = await params;

  // Resolve the identifier to a wallet address
  const walletAddress = await resolveIdentifier(identifier);

  if (!walletAddress) {
    notFound();
  }

  // If the URL was a username, redirect to the address URL for consistency
  const isAddress = identifier.match(/^0x[a-fA-F0-9]{40}$/i);
  if (!isAddress && walletAddress) {
    redirect(`/wallet/${walletAddress}`);
  }

  return <WalletProfileV2 walletAddress={walletAddress} />;
}

export async function generateMetadata({
  params,
}: WalletPageProps): Promise<Metadata> {
  const { identifier } = await params;

  // Resolve the identifier to get the wallet address
  const walletAddress = await resolveIdentifier(identifier);

  if (!walletAddress) {
    return {
      title: "Wallet Not Found | Cascadian",
      description: "The requested wallet could not be found.",
    };
  }

  const shortenedAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

  // Try to fetch profile for username
  let displayName = shortenedAddress;
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL || "https://cascadian.vercel.app";

    const profileRes = await fetch(
      `${baseUrl}/api/polymarket/wallet/${walletAddress}/profile`,
      { next: { revalidate: 3600 } }
    );
    if (profileRes.ok) {
      const profileJson = await profileRes.json();
      if (profileJson.success && profileJson.data?.username) {
        displayName = `@${profileJson.data.username}`;
      }
    }
  } catch (e) {
    // Use shortened address as fallback
  }

  return {
    title: `${displayName} | Cascadian`,
    description: `View the trading fingerprint and performance metrics for ${displayName}`,
    openGraph: {
      title: `${displayName} | Cascadian`,
      description: `View the trading fingerprint and performance metrics for ${displayName}`,
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title: `${displayName} | Cascadian`,
      description: `View the trading fingerprint and performance metrics for ${displayName}`,
    },
  };
}
