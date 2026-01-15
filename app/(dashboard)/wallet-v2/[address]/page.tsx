import { redirect } from "next/navigation";

interface WalletV2PageProps {
  params: Promise<{ address: string }>;
}

// Redirect wallet-v2 to wallet
export default async function WalletV2Page({ params }: WalletV2PageProps) {
  const { address } = await params;
  redirect(`/wallet/${address}`);
}
