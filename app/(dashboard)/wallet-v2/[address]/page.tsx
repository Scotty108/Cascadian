import { WalletProfileV2 } from "@/components/wallet-v2";

interface WalletV2PageProps {
  params: Promise<{ address: string }>;
}

export default async function WalletV2Page({ params }: WalletV2PageProps) {
  const { address } = await params;

  return <WalletProfileV2 walletAddress={address} />;
}

export async function generateMetadata({ params }: WalletV2PageProps) {
  const { address } = await params;
  const shortenedAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return {
    title: `Wallet ${shortenedAddress} | Fingerprint`,
    description: `View the trading fingerprint and performance metrics for wallet ${shortenedAddress}`,
  };
}
