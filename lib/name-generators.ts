/**
 * Name and ID generation utilities for realistic dummy data
 */

import { randomInt, randomFromList } from './random-utils';

// Trader name components
const TRADER_PREFIXES = [
  'Whale', 'Smart', 'Quick', 'Savvy', 'Bold', 'Wise', 'Sharp', 'Keen',
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Sigma', 'Omega', 'Prime', 'Elite',
  'Crypto', 'Degen', 'Ape', 'Moon', 'Diamond', 'Paper', 'Rocket', 'Laser',
  'Ninja', 'Samurai', 'Warrior', 'Champion', 'Master', 'Legend', 'Titan',
  'Phoenix', 'Dragon', 'Wolf', 'Bear', 'Bull', 'Lion', 'Eagle', 'Hawk',
];

const TRADER_SUFFIXES = [
  'Trader', 'Investor', 'Player', 'Hunter', 'Captain', 'Chief', 'Baron',
  'King', 'Queen', 'Lord', 'Master', 'Guru', 'Expert', 'Pro', 'Ace',
  'Wizard', 'Sage', 'Oracle', 'Prophet', 'Seer', 'Maverick', 'Rebel',
];

/**
 * Generate a realistic Ethereum address
 */
export function generateEthAddress(seed?: number): string {
  const chars = '0123456789abcdef';
  let address = '0x';

  const random = seed !== undefined
    ? seededRandom(seed)
    : Math.random;

  for (let i = 0; i < 40; i++) {
    address += chars[Math.floor(random() * chars.length)];
  }

  return address;
}

/**
 * Seeded random number generator (for deterministic addresses)
 */
function seededRandom(seed: number): () => number {
  return function() {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
}

/**
 * Generate a memorable trader name
 */
export function generateTraderName(seed?: number): string {
  const prefix = randomFromList(TRADER_PREFIXES);
  const suffix = randomFromList(TRADER_SUFFIXES);
  const number = seed !== undefined ? seed % 100 : randomInt(1, 999);

  return `${prefix}${suffix}${number}`;
}

/**
 * Generate a market ID slug
 */
export function generateMarketId(category: string, seed?: number): string {
  const timestamp = seed !== undefined ? seed : Date.now();
  const randomSuffix = Math.floor(timestamp % 10000);

  const categorySlug = category.toLowerCase().replace(/\s+/g, '-');
  return `${categorySlug}-market-${randomSuffix}`;
}

/**
 * Generate a realistic market title based on category
 */
export function generateMarketTitle(category: string): string {
  const templates = MARKET_TEMPLATES[category] || MARKET_TEMPLATES.Politics;
  const template = randomFromList(templates);

  return template
    .replace('{candidate}', randomFromList(CANDIDATES))
    .replace('{year}', randomFromList(['2024', '2025', '2026']))
    .replace('{office}', randomFromList(OFFICES))
    .replace('{party}', randomFromList(PARTIES))
    .replace('{coin}', randomFromList(COINS))
    .replace('{coin2}', randomFromList(COINS))
    .replace('{price}', randomFromList(PRICES))
    .replace('{company}', randomFromList(COMPANIES))
    .replace('{company2}', randomFromList(COMPANIES))
    .replace('{product}', randomFromList(PRODUCTS))
    .replace('{movie}', randomFromList(MOVIES))
    .replace('{artist}', randomFromList(ARTISTS))
    .replace('{date}', randomFromList(DATES))
    .replace('{month}', randomFromList(MONTHS))
    .replace('{quarter}', randomFromList(QUARTERS))
    .replace('{index}', randomFromList(INDICES));
}

/**
 * Generate a realistic market description
 */
export function generateMarketDescription(category: string, title: string): string {
  const templates = DESCRIPTION_TEMPLATES[category] || DESCRIPTION_TEMPLATES.Politics;
  const template = randomFromList(templates);

  return template
    .replace('{title}', title)
    .replace('{year}', randomFromList(['2024', '2025', '2026']))
    .replace('{date}', randomFromList(FULL_DATES));
}

// Market title templates
const MARKET_TEMPLATES: Record<string, string[]> = {
  Politics: [
    'Will {candidate} win the {year} {office}?',
    'Will {party} control Congress after {year} elections?',
    'Will {candidate} resign by {date}?',
    'Will the US pass immigration reform in {year}?',
    'Will {candidate} be the {party} nominee in {year}?',
  ],
  Crypto: [
    'Will {coin} reach ${price} by {date}?',
    'Will {coin} outperform {coin2} in {year}?',
    'Will {coin} hit a new all-time high in {quarter} {year}?',
    'Will a {coin} ETF be approved in {year}?',
    'Will {coin} be in the top 10 by market cap by {date}?',
  ],
  Tech: [
    'Will {company} release {product} in {year}?',
    'Will {company} reach $1T valuation by {date}?',
    'Will {product} sell 10M units in {year}?',
    'Will {company} acquire {company2} in {year}?',
    'Will AI achieve AGI by {year}?',
  ],
  Finance: [
    'Will the Fed cut rates in {month} {year}?',
    'Will the {index} hit 6000 by {date}?',
    'Will the US enter recession in {year}?',
    'Will gold reach $3000/oz in {year}?',
    'Will unemployment drop below 3% by {date}?',
  ],
  'Pop Culture': [
    'Will {movie} gross over $1B worldwide?',
    'Will {artist} win Album of the Year at the Grammys?',
    'Will {movie} win Best Picture at the Oscars?',
    'Will {artist} have a #1 hit in {year}?',
    'Will the Super Bowl break viewership records in {year}?',
  ],
};

// Description templates
const DESCRIPTION_TEMPLATES: Record<string, string[]> = {
  Politics: [
    'This market will resolve to YES if the stated outcome occurs by the specified date. Resolution will be based on official government records and credible news sources.',
    'The market resolves based on official election results certified by the relevant electoral body. Any recounts or legal challenges will be accounted for in the final resolution.',
    'This market tracks political developments and will resolve according to official announcements and verifiable public records.',
  ],
  Crypto: [
    'This market will resolve to YES if {coin} reaches the specified price level at any point during the stated timeframe, based on prices from major exchanges including Coinbase, Binance, and Kraken.',
    'Resolution is based on CoinMarketCap or CoinGecko data. The price must be sustained for at least 1 hour on multiple major exchanges to count.',
    'This market tracks cryptocurrency price movements and will resolve based on widely accepted price aggregator data.',
  ],
  Tech: [
    'This market will resolve based on official company announcements, product launches, and credible technology news sources.',
    'Resolution depends on confirmed product release dates and specifications matching the criteria outlined in the market description.',
    'This market tracks technology developments and will resolve based on verifiable public information from the company or credible industry sources.',
  ],
  Finance: [
    'This market will resolve based on official economic data from the Federal Reserve, Bureau of Labor Statistics, or other government agencies.',
    'Resolution is determined by official market data at market close on the specified date, based on major financial data providers.',
    'This market tracks financial indicators and will resolve according to widely accepted economic data sources.',
  ],
  'Pop Culture': [
    'This market will resolve based on official box office data from sources like Box Office Mojo or The Numbers, or official award ceremony results.',
    'Resolution depends on confirmed and verified data from industry-standard sources and official announcements.',
    'This market tracks entertainment industry metrics and will resolve based on widely accepted reporting from credible sources.',
  ],
};

// Data for replacements
const CANDIDATES = ['Trump', 'Biden', 'Harris', 'DeSantis', 'Newsom', 'Haley'];
const OFFICES = ['Presidential Election', 'Senate', 'House', 'Governorship'];
const PARTIES = ['Democratic', 'Republican', 'Independent'];
const COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'AVAX', 'MATIC'];
const PRICES = ['100k', '10k', '5k', '$1', '$2500', '50k'];
const COMPANIES = ['Apple', 'Tesla', 'OpenAI', 'Meta', 'Google', 'Microsoft', 'Amazon'];
const PRODUCTS = ['Vision Pro 2', 'GPT-5', 'Cybertruck', 'Quest 4', 'iPhone 16'];
const MOVIES = ['Dune 3', 'Avatar 4', 'Barbie 2', 'Oppenheimer', 'Mission Impossible 8'];
const ARTISTS = ['Taylor Swift', 'Beyoncé', 'Drake', 'Bad Bunny', 'The Weeknd'];
const DATES = ['end of 2024', 'end of 2025', 'Q1 2025', 'Q2 2025', 'end of year'];
const FULL_DATES = ['December 31, 2024', 'June 30, 2025', 'March 31, 2025', 'September 30, 2025'];
const MONTHS = ['January', 'March', 'June', 'September', 'December'];
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const INDICES = ['S&P 500', 'NASDAQ', 'Dow Jones'];

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}
