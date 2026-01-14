import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{
    address: string;
  }>;
}

export default async function WalletDetailPage({ params }: PageProps) {
  const { address } = await params;
  redirect(`/wallet-v2/${address}`);
}
