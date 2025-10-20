import { AlertCircle, Download, FileText, Zap } from "lucide-react";
import type { Article, FAQ, ResourceLink, SupportTeamMember, VideoTutorial } from "./types";

export const POPULAR_ARTICLES: Article[] = [
  {
    id: 1,
    title: "Getting Started with DefibotX",
    category: "getting-started",
    views: 12543,
    updated: "2 days ago",
  },
  {
    id: 2,
    title: "How to Create Your First Trading Bot",
    category: "bots",
    views: 9876,
    updated: "1 week ago",
  },
  {
    id: 3,
    title: "Understanding Risk Management",
    category: "trading",
    views: 8765,
    updated: "3 days ago",
  },
  {
    id: 4,
    title: "Connecting Your Wallet Securely",
    category: "security",
    views: 7654,
    updated: "5 days ago",
  },
  {
    id: 5,
    title: "Yield Farming Strategies",
    category: "defi",
    views: 6543,
    updated: "1 day ago",
  },
  {
    id: 6,
    title: "Managing Subscription Plans",
    category: "account",
    views: 5432,
    updated: "4 days ago",
  },
];

export const FAQS: FAQ[] = [
  {
    id: "faq-1",
    question: "What is DefibotX?",
    answer:
      "DefibotX is an advanced AI-powered crypto trading and DeFi platform that helps users automate their trading strategies, manage their portfolios, and maximize their returns in the cryptocurrency market. It offers a range of tools including AI trading bots, market analysis, portfolio tracking, and DeFi integrations.",
  },
  {
    id: "faq-2",
    question: "How do I create my first trading bot?",
    answer:
      "To create your first trading bot, navigate to the Bot Templates section, select a template that matches your trading strategy, customize the parameters according to your preferences, connect your exchange API, and deploy the bot. You can monitor and adjust your bot's performance from the Control Panel.",
  },
  {
    id: "faq-3",
    question: "Is my data secure on DefibotX?",
    answer:
      "Yes, security is our top priority. DefibotX uses industry-standard encryption for all data, implements two-factor authentication, and never stores your exchange API secret keys on our servers. We use a secure architecture that keeps your trading data and personal information protected at all times.",
  },
  {
    id: "faq-4",
    question: "What exchanges are supported?",
    answer:
      "DefibotX currently supports major exchanges including Binance, Coinbase Pro, Kraken, KuCoin, and FTX. We're continuously adding support for more exchanges to provide you with the most comprehensive trading experience possible.",
  },
  {
    id: "faq-5",
    question: "How are subscription fees calculated?",
    answer:
      "Subscription fees are based on the plan you choose (Free, Pro, or Enterprise) and whether you opt for monthly or annual billing. Annual billing offers a 20% discount compared to monthly billing. You can view detailed pricing information on the Subscription page.",
  },
  {
    id: "faq-6",
    question: "Can I use DefibotX on mobile devices?",
    answer:
      "Yes, DefibotX is fully responsive and works on desktop, tablet, and mobile devices. You can access all features and monitor your trading activities on the go through any modern web browser. We also offer mobile notifications to keep you updated on important events.",
  },
  {
    id: "faq-7",
    question: "How do I connect my wallet?",
    answer:
      "To connect your wallet, go to the Wallets section, click on 'Connect Wallet', and choose your preferred wallet provider (MetaMask, WalletConnect, Coinbase Wallet, etc.). Follow the authentication prompts to securely connect your wallet to DefibotX.",
  },
  {
    id: "faq-8",
    question: "What are the fees for using trading bots?",
    answer:
      "The use of trading bots is included in your subscription plan. There are no additional fees for creating and running bots beyond your subscription. However, normal exchange trading fees will apply for trades executed by your bots on the respective exchanges.",
  },
];

export const VIDEO_TUTORIALS: VideoTutorial[] = [
  {
    id: 1,
    title: "Complete Platform Walkthrough",
    duration: "12:34",
    thumbnail: "/platform-walkthrough-thumb.jpg",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  },
  {
    id: 2,
    title: "Setting Up Your First AI Bot",
    duration: "8:45",
    thumbnail: "/ai-bot-setup-thumb.jpg",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  },
  {
    id: 3,
    title: "Advanced Trading Strategies",
    duration: "15:21",
    thumbnail: "/trading-strategies-thumb.jpg",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  },
  {
    id: 4,
    title: "DeFi Integration Guide",
    duration: "10:15",
    thumbnail: "/defi-integration-thumb.jpg",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  },
];

export const SUPPORT_TEAM: SupportTeamMember[] = [
  {
    name: "Alex Johnson",
    role: "Technical Support Lead",
    avatar: "/placeholder.svg?height=40&width=40&text=AJ",
    status: "online",
  },
  {
    name: "Sarah Chen",
    role: "Customer Success Manager",
    avatar: "/placeholder.svg?height=40&width=40&text=SC",
    status: "online",
  },
  {
    name: "Miguel Rodriguez",
    role: "DeFi Specialist",
    avatar: "/placeholder.svg?height=40&width=40&text=MR",
    status: "away",
  },
];

export const RESOURCE_LINKS: ResourceLink[] = [
  {
    icon: FileText,
    title: "API Documentation",
    description: "Complete API reference and guides",
  },
  {
    icon: Download,
    title: "Trading Guides",
    description: "Downloadable trading strategy guides",
  },
  {
    icon: Zap,
    title: "Bot Strategy Templates",
    description: "Pre-built bot templates and configurations",
  },
  {
    icon: AlertCircle,
    title: "Security Best Practices",
    description: "Guidelines for secure trading",
  },
];

export const CONTACT_INFO = {
  email: "support@defibotx.com",
  responseTime: "Currently under 2 hours",
  availability: "24/7 for Pro and Enterprise users",
};
