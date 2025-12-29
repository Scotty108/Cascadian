/**
 * Polymarket Market Taxonomy
 *
 * Comprehensive keyword → tags mapping for market enrichment
 * Each keyword can trigger multiple tags
 * Each tag belongs to a primary category
 *
 * Special categories:
 * - "Mentions" and "Earnings" are META categories (modifiers, not primary)
 * - If market has "Politics" + "Mentions" → Category = "Politics"
 * - If market has "Tech" + "Earnings" → Category = "Tech"
 */

// ============================================================================
// KEYWORD → TAGS MAPPING
// ============================================================================

export interface KeywordMapping {
  keyword: string;
  tags: string[];
  caseSensitive?: boolean;  // Default: false (case-insensitive)
  wholeWord?: boolean;      // Default: false (partial match allowed)
  domain?: 'sports' | 'politics' | 'tech' | 'crypto' | 'finance' | 'culture' | 'world' | 'economy';  // Domain hint for context-aware matching
}

/**
 * Master keyword → tags mapping
 * Keywords are matched case-insensitively by default
 * One keyword can trigger multiple tags
 */
export const KEYWORD_TO_TAGS: KeywordMapping[] = [

  // ========== POLITICS ==========

  // US Politics - People
  { keyword: 'trump', tags: ['Trump', 'Politics', 'US Politics'] },
  { keyword: 'donald trump', tags: ['Trump', 'Politics', 'US Politics'] },
  { keyword: 'biden', tags: ['Biden', 'Politics', 'US Politics'] },
  { keyword: 'joe biden', tags: ['Biden', 'Politics', 'US Politics'] },
  { keyword: 'kamala harris', tags: ['Kamala Harris', 'Politics', 'US Politics'] },
  { keyword: 'kamala', tags: ['Kamala Harris', 'Politics', 'US Politics'] },
  { keyword: 'harris', tags: ['Kamala Harris', 'Politics', 'US Politics'] },
  { keyword: 'ron desantis', tags: ['Ron DeSantis', 'Politics', 'US Politics'] },
  { keyword: 'desantis', tags: ['Ron DeSantis', 'Politics', 'US Politics'] },
  { keyword: 'nikki haley', tags: ['Nikki Haley', 'Politics', 'US Politics'] },
  { keyword: 'rfk jr', tags: ['RFK Jr.', 'Politics', 'US Politics'] },
  { keyword: 'robert f kennedy', tags: ['RFK Jr.', 'Politics', 'US Politics'] },
  { keyword: 'gavin newsom', tags: ['Gavin Newsom', 'Politics', 'US Politics'] },
  { keyword: 'newsom', tags: ['Gavin Newsom', 'Politics', 'US Politics'] },
  { keyword: 'elizabeth warren', tags: ['Elizabeth Warren', 'Politics', 'US Politics'] },
  { keyword: 'aoc', tags: ['AOC', 'Politics', 'US Politics'] },
  { keyword: 'alexandria ocasio', tags: ['AOC', 'Politics', 'US Politics'] },
  { keyword: 'mitch mcconnell', tags: ['Mitch McConnell', 'Politics', 'US Politics'], domain: 'politics' },
  { keyword: 'mcconnell', tags: ['Mitch McConnell', 'Politics', 'US Politics'], domain: 'politics', wholeWord: true },  // WHOLE WORD: Prevent "T.J. McConnell" false match
  { keyword: 'chuck schumer', tags: ['Chuck Schumer', 'Politics', 'US Politics'] },
  { keyword: 'schumer', tags: ['Chuck Schumer', 'Politics', 'US Politics'] },
  { keyword: 'kevin mccarthy', tags: ['Kevin McCarthy', 'Politics', 'US Politics'] },
  { keyword: 'mccarthy', tags: ['Kevin McCarthy', 'Politics', 'US Politics'] },
  { keyword: 'jd vance', tags: ['JD Vance', 'Politics', 'US Politics'], domain: 'politics' },
  { keyword: 'vance', tags: ['JD Vance', 'Politics', 'US Politics'], domain: 'politics', wholeWord: true },  // WHOLE WORD: Prevent "To Advance" false match
  { keyword: 'vivek ramaswamy', tags: ['Vivek Ramaswamy', 'Politics', 'US Politics'] },
  { keyword: 'vivek', tags: ['Vivek Ramaswamy', 'Politics', 'US Politics'] },

  // US Politics - Institutions & Events
  { keyword: 'election', tags: ['Elections', 'Politics'] },
  { keyword: 'primary', tags: ['Primaries', 'Elections', 'Politics'] },
  { keyword: 'referendum', tags: ['Referendums', 'Politics'] },
  { keyword: 'president', tags: ['President', 'Politics', 'US Politics'] },
  { keyword: 'presidential', tags: ['President', 'Politics', 'US Politics'] },
  { keyword: 'vice president', tags: ['Vice President', 'Politics', 'US Politics'] },
  { keyword: 'house of representatives', tags: ['House', 'Politics', 'US Politics'] },
  { keyword: 'senate', tags: ['Senate', 'Politics', 'US Politics'] },
  { keyword: 'senator', tags: ['Senate', 'Politics', 'US Politics'] },
  { keyword: 'governor', tags: ['Governors', 'Politics', 'US Politics'] },
  { keyword: 'supreme court', tags: ['Supreme Court', 'Politics', 'US Politics'] },
  { keyword: 'scotus', tags: ['Supreme Court', 'Politics', 'US Politics'] },
  { keyword: 'impeachment', tags: ['Impeachment', 'Politics', 'US Politics'] },
  { keyword: 'government shutdown', tags: ['Government Shutdown', 'Politics', 'US Politics'] },
  { keyword: 'debt ceiling', tags: ['Debt Ceiling', 'Economy', 'Politics'] },

  // International Politics
  { keyword: 'uk election', tags: ['UK Election', 'Politics', 'International Politics'] },
  { keyword: 'france election', tags: ['France Election', 'Politics', 'International Politics'] },
  { keyword: 'german election', tags: ['German Election', 'Politics', 'International Politics'] },
  { keyword: 'india election', tags: ['India Election', 'Politics', 'International Politics'] },
  { keyword: 'canada election', tags: ['Canada Election', 'Politics', 'International Politics'] },
  { keyword: 'mexico election', tags: ['Mexico Election', 'Politics', 'International Politics'] },
  { keyword: 'brazil election', tags: ['Brazil Election', 'Politics', 'International Politics'] },

  // ========== CRYPTO ==========

  // Major Cryptocurrencies
  { keyword: 'bitcoin', tags: ['Bitcoin', 'Crypto'] },
  { keyword: 'btc', tags: ['Bitcoin', 'Crypto'], wholeWord: true },
  { keyword: 'ethereum', tags: ['Ethereum', 'Crypto'] },
  { keyword: 'eth', tags: ['Ethereum', 'Crypto'], wholeWord: true },
  { keyword: 'solana', tags: ['Solana', 'Crypto'] },
  { keyword: 'sol', tags: ['Solana', 'Crypto'], wholeWord: true },
  { keyword: 'avalanche', tags: ['Avalanche', 'Crypto'] },
  { keyword: 'avax', tags: ['Avalanche', 'Crypto'] },
  { keyword: 'cardano', tags: ['Cardano', 'Crypto'] },
  { keyword: 'ada', tags: ['Cardano', 'Crypto'], wholeWord: true },
  { keyword: 'xrp', tags: ['XRP', 'Crypto'] },
  { keyword: 'ripple', tags: ['XRP', 'Crypto'] },
  { keyword: 'dogecoin', tags: ['Dogecoin', 'Crypto'] },
  { keyword: 'doge', tags: ['Dogecoin', 'Crypto'] },
  { keyword: 'shiba inu', tags: ['Shiba Inu', 'Crypto'] },
  { keyword: 'shib', tags: ['Shiba Inu', 'Crypto'] },
  { keyword: 'polygon', tags: ['Polygon', 'Crypto'] },
  { keyword: 'matic', tags: ['Polygon', 'Crypto'] },
  { keyword: 'chainlink', tags: ['Chainlink', 'Crypto'] },
  { keyword: 'link', tags: ['Chainlink', 'Crypto'], wholeWord: true },
  { keyword: 'cosmos', tags: ['Cosmos', 'Crypto'] },
  { keyword: 'atom', tags: ['Cosmos', 'Crypto'], wholeWord: true },
  { keyword: 'toncoin', tags: ['Toncoin', 'Crypto'] },
  { keyword: 'ton', tags: ['Toncoin', 'Crypto'], wholeWord: true },
  { keyword: 'aptos', tags: ['Aptos', 'Crypto'] },
  { keyword: 'apt', tags: ['Aptos', 'Crypto'], wholeWord: true },
  { keyword: 'sui', tags: ['Sui', 'Crypto'] },

  // Crypto Timeframes
  { keyword: '15m', tags: ['15m', 'Crypto'] },
  { keyword: 'hourly', tags: ['Hourly', 'Crypto'] },
  { keyword: '4h', tags: ['4h', 'Crypto'] },
  { keyword: 'daily', tags: ['Daily', 'Crypto'] },
  { keyword: 'weekly', tags: ['Weekly', 'Crypto'] },
  { keyword: 'monthly', tags: ['Monthly', 'Crypto'] },

  // Crypto Terms
  { keyword: 'defi', tags: ['DeFi', 'Crypto'] },
  { keyword: 'dex', tags: ['DEXs', 'Crypto'] },
  { keyword: 'l2', tags: ['L2s', 'Crypto'] },
  { keyword: 'layer 2', tags: ['L2s', 'Crypto'] },
  { keyword: 'meme coin', tags: ['Meme Coins', 'Crypto'] },
  { keyword: 'stablecoin', tags: ['Stablecoins', 'Crypto'] },
  { keyword: 'bitcoin etf', tags: ['Bitcoin ETF', 'Crypto', 'Finance'] },
  { keyword: 'ethereum etf', tags: ['Ethereum ETF', 'Crypto', 'Finance'] },
  { keyword: 'spot etf', tags: ['Spot ETF', 'Crypto', 'Finance'] },

  // ========== SPORTS ==========

  // Football
  { keyword: 'nfl', tags: ['NFL', 'Sports', 'Football'] },
  { keyword: 'cfb', tags: ['CFB', 'Sports', 'Football'] },
  { keyword: 'super bowl', tags: ['Super Bowl', 'NFL', 'Sports'] },
  { keyword: 'chiefs', tags: ['Chiefs', 'NFL', 'Sports'] },
  { keyword: 'bills', tags: ['Bills', 'NFL', 'Sports'] },
  { keyword: 'eagles', tags: ['Eagles', 'NFL', 'Sports'] },
  { keyword: 'cowboys', tags: ['Cowboys', 'NFL', 'Sports'] },
  { keyword: 'ravens', tags: ['Ravens', 'NFL', 'Sports'] },
  { keyword: 'packers', tags: ['Packers', 'NFL', 'Sports'] },

  // Basketball - League
  { keyword: 'nba', tags: ['NBA', 'Sports', 'Basketball'] },
  { keyword: 'wnba', tags: ['WNBA', 'Sports', 'Basketball'] },
  { keyword: 'ncaa basketball', tags: ['NCAA CBB', 'Sports', 'Basketball'] },

  // Basketball - NBA Teams (PRIORITY: Added before Tech keywords to prevent conflicts)
  // Atlantic Division
  { keyword: 'celtics', tags: ['Celtics', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'nets', tags: ['Nets', 'NBA', 'Sports', 'Basketball'] },
  { keyword: '76ers', tags: ['76ers', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'sixers', tags: ['76ers', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'knicks', tags: ['Knicks', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'raptors', tags: ['Raptors', 'NBA', 'Sports', 'Basketball'] },
  // Central Division
  { keyword: 'bucks', tags: ['Bucks', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'bulls', tags: ['Bulls', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'cavaliers', tags: ['Cavaliers', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'cavs', tags: ['Cavaliers', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'pistons', tags: ['Pistons', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'pacers', tags: ['Pacers', 'NBA', 'Sports', 'Basketball'] },
  // Southeast Division
  { keyword: 'hawks', tags: ['Hawks', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'hornets', tags: ['Hornets', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'heat', tags: ['Heat', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'wizards', tags: ['Wizards', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'magic', tags: ['Magic', 'NBA', 'Sports', 'Basketball'], domain: 'sports' },  // Domain-tagged: Sports context only
  // Southwest Division
  { keyword: 'mavericks', tags: ['Mavericks', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'mavs', tags: ['Mavericks', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'rockets', tags: ['Rockets', 'NBA', 'Sports', 'Basketball'], domain: 'sports' },  // Domain-tagged: Sports context only
  { keyword: 'grizzlies', tags: ['Grizzlies', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'pelicans', tags: ['Pelicans', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'spurs', tags: ['Spurs', 'NBA', 'Sports', 'Basketball'] },
  // Northwest Division
  { keyword: 'nuggets', tags: ['Nuggets', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'timberwolves', tags: ['Timberwolves', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 't-wolves', tags: ['Timberwolves', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'thunder', tags: ['Thunder', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'trail blazers', tags: ['Trail Blazers', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'blazers', tags: ['Trail Blazers', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'jazz', tags: ['Jazz', 'NBA', 'Sports', 'Basketball'] },
  // Pacific Division
  { keyword: 'warriors', tags: ['Warriors', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'clippers', tags: ['Clippers', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'lakers', tags: ['Lakers', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'suns', tags: ['Suns', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'kings', tags: ['Kings', 'NBA', 'Sports', 'Basketball'] },

  // Baseball - League
  { keyword: 'mlb', tags: ['MLB', 'Sports', 'Baseball'] },
  // Baseball - MLB Teams
  // AL East
  { keyword: 'orioles', tags: ['Orioles', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'red sox', tags: ['Red Sox', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'yankees', tags: ['Yankees', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'rays', tags: ['Rays', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'blue jays', tags: ['Blue Jays', 'MLB', 'Sports', 'Baseball'] },
  // AL Central
  { keyword: 'guardians', tags: ['Guardians', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'twins', tags: ['Twins', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'royals', tags: ['Royals', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'tigers', tags: ['Tigers', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'white sox', tags: ['White Sox', 'MLB', 'Sports', 'Baseball'] },
  // AL West
  { keyword: 'astros', tags: ['Astros', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'mariners', tags: ['Mariners', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'texas rangers', tags: ['Rangers', 'MLB', 'Sports', 'Baseball'] },  // Note: Full name to avoid NHL Rangers conflict
  { keyword: 'angels', tags: ['Angels', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'athletics', tags: ['Athletics', 'MLB', 'Sports', 'Baseball'] },
  // NL East
  { keyword: 'braves', tags: ['Braves', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'phillies', tags: ['Phillies', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'mets', tags: ['Mets', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'marlins', tags: ['Marlins', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'nationals', tags: ['Nationals', 'MLB', 'Sports', 'Baseball'] },
  // NL Central
  { keyword: 'brewers', tags: ['Brewers', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'cubs', tags: ['Cubs', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'cardinals', tags: ['Cardinals', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'pirates', tags: ['Pirates', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'reds', tags: ['Reds', 'MLB', 'Sports', 'Baseball'] },
  // NL West
  { keyword: 'dodgers', tags: ['Dodgers', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'padres', tags: ['Padres', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'diamondbacks', tags: ['Diamondbacks', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'd-backs', tags: ['Diamondbacks', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'giants', tags: ['Giants', 'MLB', 'Sports', 'Baseball'] },
  { keyword: 'rockies', tags: ['Rockies', 'MLB', 'Sports', 'Baseball'] },

  // Hockey - League
  { keyword: 'nhl', tags: ['NHL', 'Sports', 'Hockey'] },
  // Hockey - NHL Teams (Existing + Additional)
  { keyword: 'rangers', tags: ['Rangers', 'NHL', 'Sports'] },
  { keyword: 'maple leafs', tags: ['Maple Leafs', 'NHL', 'Sports'] },
  { keyword: 'bruins', tags: ['Bruins', 'NHL', 'Sports'] },
  // Atlantic
  { keyword: 'panthers', tags: ['Panthers', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'lightning', tags: ['Lightning', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'sabres', tags: ['Sabres', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'senators', tags: ['Senators', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'canadiens', tags: ['Canadiens', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'red wings', tags: ['Red Wings', 'NHL', 'Sports', 'Hockey'] },
  // Metropolitan
  { keyword: 'hurricanes', tags: ['Hurricanes', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'devils', tags: ['Devils', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'islanders', tags: ['Islanders', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'penguins', tags: ['Penguins', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'capitals', tags: ['Capitals', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'flyers', tags: ['Flyers', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'blue jackets', tags: ['Blue Jackets', 'NHL', 'Sports', 'Hockey'] },
  // Central
  { keyword: 'jets', tags: ['Jets', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'stars', tags: ['Stars', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'wild', tags: ['Wild', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'predators', tags: ['Predators', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'blackhawks', tags: ['Blackhawks', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'blues', tags: ['Blues', 'NHL', 'Sports', 'Hockey'] },
  // Pacific
  { keyword: 'oilers', tags: ['Oilers', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'canucks', tags: ['Canucks', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'golden knights', tags: ['Golden Knights', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'kraken', tags: ['Kraken', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'flames', tags: ['Flames', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'sharks', tags: ['Sharks', 'NHL', 'Sports', 'Hockey'] },
  { keyword: 'ducks', tags: ['Ducks', 'NHL', 'Sports', 'Hockey'] },

  // Esports
  { keyword: 'dota 2', tags: ['DOTA 2', 'Sports', 'Esports'] },
  { keyword: 'counter-strike', tags: ['Counter-Strike', 'Sports', 'Esports'] },
  { keyword: 'cs:go', tags: ['Counter-Strike', 'Sports', 'Esports'] },
  { keyword: 'league of legends', tags: ['League of Legends', 'Sports', 'Esports'] },
  { keyword: 'lol', tags: ['League of Legends', 'Sports', 'Esports'], wholeWord: true },
  { keyword: 'valorant', tags: ['Valorant', 'Sports', 'Esports'] },
  { keyword: 'overwatch', tags: ['Overwatch', 'Sports', 'Esports'] },

  // Tennis
  { keyword: 'atp', tags: ['ATP', 'Sports', 'Tennis'] },
  { keyword: 'wta', tags: ['WTA', 'Sports', 'Tennis'] },
  { keyword: 'wimbledon', tags: ['Wimbledon', 'Sports', 'Tennis'] },
  { keyword: 'us open', tags: ['US Open', 'Sports', 'Tennis'] },
  { keyword: 'french open', tags: ['French Open', 'Sports', 'Tennis'] },
  { keyword: 'australian open', tags: ['Australian Open', 'Sports', 'Tennis'] },

  // ========== TECH ==========

  // Big Tech Companies
  { keyword: 'apple', tags: ['Apple', 'Tech'] },
  { keyword: 'google', tags: ['Google', 'Tech'] },
  { keyword: 'microsoft', tags: ['Microsoft', 'Tech'] },
  { keyword: 'meta', tags: ['Meta', 'Tech'] },
  { keyword: 'facebook', tags: ['Meta', 'Tech'] },
  { keyword: 'amazon', tags: ['Amazon', 'Tech'] },
  { keyword: 'nvidia', tags: ['Nvidia', 'Tech'] },
  { keyword: 'tesla', tags: ['Tesla', 'Tech'] },
  { keyword: 'spacex', tags: ['SpaceX', 'Tech'] },
  { keyword: 'openai', tags: ['OpenAI', 'Tech', 'AI'] },
  { keyword: 'anthropic', tags: ['Anthropic', 'Tech', 'AI'] },
  { keyword: 'xai', tags: ['xAI', 'Tech', 'AI'] },
  { keyword: 'grok', tags: ['Grok', 'xAI', 'Tech', 'AI'] },
  { keyword: 'microstrategy', tags: ['MicroStrategy', 'Tech', 'Crypto'] },
  { keyword: 'oracle', tags: ['Oracle', 'Tech'] },
  { keyword: 'ibm', tags: ['IBM', 'Tech'] },

  // Tech People
  { keyword: 'elon musk', tags: ['Elon Musk', 'Tech'] },
  { keyword: 'musk', tags: ['Elon Musk', 'Tech'] },
  { keyword: 'sam altman', tags: ['Sam Altman', 'Tech', 'OpenAI'] },
  { keyword: 'altman', tags: ['Sam Altman', 'Tech', 'OpenAI'] },
  { keyword: 'mark zuckerberg', tags: ['Mark Zuckerberg', 'Tech', 'Meta'] },
  { keyword: 'zuckerberg', tags: ['Mark Zuckerberg', 'Tech', 'Meta'] },
  { keyword: 'sundar pichai', tags: ['Sundar Pichai', 'Tech', 'Google'] },
  { keyword: 'pichai', tags: ['Sundar Pichai', 'Tech', 'Google'] },
  { keyword: 'satya nadella', tags: ['Satya Nadella', 'Tech', 'Microsoft'] },
  { keyword: 'nadella', tags: ['Satya Nadella', 'Tech', 'Microsoft'] },
  { keyword: 'jensen huang', tags: ['Jensen Huang', 'Tech', 'Nvidia'] },
  { keyword: 'huang', tags: ['Jensen Huang', 'Tech', 'Nvidia'] },
  { keyword: 'jeff bezos', tags: ['Jeff Bezos', 'Tech', 'Amazon'] },
  { keyword: 'bezos', tags: ['Jeff Bezos', 'Tech', 'Amazon'] },

  // Tech Themes
  { keyword: 'ai', tags: ['AI', 'Tech'], domain: 'tech' },  // Domain-tagged: Prevent false match in "Magic" (m-agi-c)
  { keyword: 'artificial intelligence', tags: ['AI', 'Tech'], domain: 'tech' },
  { keyword: 'agi', tags: ['AGI', 'AI', 'Tech'], domain: 'tech' },  // Domain-tagged: Prevent false match in "Magic" (m-agi-c)
  { keyword: 'llm', tags: ['LLMs', 'AI', 'Tech'], domain: 'tech' },
  { keyword: 'robotics', tags: ['Robotics', 'Tech'], domain: 'tech' },
  { keyword: 'drone', tags: ['Drones', 'Tech'], domain: 'tech' },
  { keyword: 'self-driving', tags: ['Self-driving cars', 'Tech'], domain: 'tech' },
  { keyword: 'autonomous', tags: ['Self-driving cars', 'Tech'], domain: 'tech' },
  { keyword: 'rocket', tags: ['Rocket launches', 'Tech', 'SpaceX'], domain: 'tech' },  // Domain-tagged: Prevent false match in "Rockets" (Houston NBA team)
  { keyword: 'ipo', tags: ['IPOs', 'Tech', 'Finance'] },

  // ========== ECONOMY ==========

  // Economic Indicators
  { keyword: 'cpi', tags: ['CPI', 'Economy'] },
  { keyword: 'inflation', tags: ['CPI', 'Economy'] },
  { keyword: 'ppi', tags: ['PPI', 'Economy'] },
  { keyword: 'gdp', tags: ['GDP', 'Economy'] },
  { keyword: 'unemployment', tags: ['Unemployment', 'Economy'] },
  { keyword: 'jobs report', tags: ['Jobs report', 'Economy'] },
  { keyword: 'nfp', tags: ['Jobs report', 'Economy'] },
  { keyword: 'retail sales', tags: ['Retail sales', 'Economy'] },
  { keyword: 'pmi', tags: ['Manufacturing PMI', 'Economy'] },
  { keyword: 'consumer sentiment', tags: ['Consumer sentiment', 'Economy'] },

  // Central Banks
  { keyword: 'fed', tags: ['Fed', 'Economy'], wholeWord: true },
  { keyword: 'federal reserve', tags: ['Fed', 'Economy'] },
  { keyword: 'ecb', tags: ['ECB', 'Economy'] },
  { keyword: 'boj', tags: ['BOJ', 'Economy'] },
  { keyword: 'boe', tags: ['BOE', 'Economy'] },
  { keyword: 'interest rate', tags: ['Interest rates', 'Economy'] },
  { keyword: 'rate cut', tags: ['Rate cuts', 'Economy'] },
  { keyword: 'rate hike', tags: ['Rate hikes', 'Economy'] },

  // Markets
  { keyword: 's&p 500', tags: ['S&P 500', 'Finance'] },
  { keyword: 's&p', tags: ['S&P 500', 'Finance'] },
  { keyword: 'nasdaq', tags: ['NASDAQ', 'Finance'] },
  { keyword: 'dow jones', tags: ['Dow Jones', 'Finance'] },
  { keyword: 'dow', tags: ['Dow Jones', 'Finance'], wholeWord: true },
  { keyword: 'russell 2000', tags: ['Russell 2000', 'Finance'] },
  { keyword: 'vix', tags: ['VIX', 'Finance'] },

  // ========== FINANCE ==========

  // Major Stocks
  { keyword: 'aapl', tags: ['Apple', 'Finance', 'Tech'] },
  { keyword: 'amzn', tags: ['Amazon', 'Finance', 'Tech'] },
  { keyword: 'msft', tags: ['Microsoft', 'Finance', 'Tech'] },
  { keyword: 'meta', tags: ['Meta', 'Finance', 'Tech'] },
  { keyword: 'googl', tags: ['Google', 'Finance', 'Tech'] },
  { keyword: 'nvda', tags: ['Nvidia', 'Finance', 'Tech'] },
  { keyword: 'tsla', tags: ['Tesla', 'Finance', 'Tech'] },
  { keyword: 'amd', tags: ['AMD', 'Finance', 'Tech'] },
  { keyword: 'intel', tags: ['Intel', 'Finance', 'Tech'] },
  { keyword: 'tsm', tags: ['TSM', 'Finance', 'Tech'] },
  { keyword: 'qualcomm', tags: ['Qualcomm', 'Finance', 'Tech'] },

  // Commodities
  { keyword: 'oil', tags: ['Oil', 'Finance', 'Commodities'] },
  { keyword: 'wti', tags: ['WTI', 'Oil', 'Finance'] },
  { keyword: 'brent', tags: ['Brent', 'Oil', 'Finance'] },
  { keyword: 'natural gas', tags: ['Natural Gas', 'Finance', 'Commodities'] },
  { keyword: 'gold', tags: ['Gold', 'Finance', 'Commodities'] },
  { keyword: 'silver', tags: ['Silver', 'Finance', 'Commodities'] },
  { keyword: 'copper', tags: ['Copper', 'Finance', 'Commodities'] },

  // ========== WORLD ==========

  // Countries & Conflicts
  { keyword: 'ukraine', tags: ['Ukraine', 'World', 'Ukraine War'] },
  { keyword: 'russia', tags: ['Russia', 'World', 'Ukraine War'] },
  { keyword: 'israel', tags: ['Israel', 'World'] },
  { keyword: 'gaza', tags: ['Gaza', 'World', 'Gaza War'] },
  { keyword: 'palestine', tags: ['Palestine', 'World', 'Gaza War'] },
  { keyword: 'hamas', tags: ['Israel-Hamas', 'World', 'Gaza War'] },
  { keyword: 'china', tags: ['China', 'World'] },
  { keyword: 'taiwan', tags: ['Taiwan', 'World'] },
  { keyword: 'iran', tags: ['Iran', 'World'] },
  { keyword: 'north korea', tags: ['North Korea', 'World'] },

  // ========== CULTURE ==========

  // Entertainment
  { keyword: 'oscars', tags: ['Oscars', 'Culture', 'Entertainment'] },
  { keyword: 'grammys', tags: ['Grammys', 'Culture', 'Entertainment'] },
  { keyword: 'emmys', tags: ['Emmys', 'Culture', 'Entertainment'] },
  { keyword: 'box office', tags: ['Box office', 'Culture', 'Entertainment'] },
  { keyword: 'movie', tags: ['Movies', 'Culture', 'Entertainment'] },

  // Internet Personalities
  { keyword: 'mrbeast', tags: ['MrBeast', 'Culture'] },
  { keyword: 'logan paul', tags: ['Logan Paul', 'Culture'] },
  { keyword: 'jake paul', tags: ['Jake Paul', 'Culture'] },
  { keyword: 'kai cenat', tags: ['Kai Cenat', 'Culture'] },
  { keyword: 'speed', tags: ['Speed', 'Culture'] },

  // ========== SPECIAL CATEGORIES ==========

  // Earnings (META category)
  { keyword: 'earnings', tags: ['Earnings'] },
  { keyword: 'revenue beat', tags: ['Earnings', 'Revenue Beat'] },
  { keyword: 'eps beat', tags: ['Earnings', 'EPS Beat'] },
  { keyword: 'q1 earnings', tags: ['Earnings', 'Q1'] },
  { keyword: 'q2 earnings', tags: ['Earnings', 'Q2'] },
  { keyword: 'q3 earnings', tags: ['Earnings', 'Q3'] },
  { keyword: 'q4 earnings', tags: ['Earnings', 'Q4'] },

  // Mentions (META category)
  { keyword: 'mention', tags: ['Mentions'] },
  { keyword: 'say', tags: ['Mentions'] },
  { keyword: 'tweet', tags: ['Mentions', 'Tweet Markets'] },
  { keyword: 'sotu', tags: ['Mentions', 'SOTU'] },
  { keyword: 'state of the union', tags: ['Mentions', 'SOTU'] },
  { keyword: 'debate', tags: ['Mentions', 'Debate'] },
];

// ============================================================================
// TAG → CATEGORY MAPPING
// ============================================================================

export const TAG_TO_CATEGORY: Record<string, string> = {
  // Politics
  'Trump': 'Politics',
  'Biden': 'Politics',
  'Kamala Harris': 'Politics',
  'Ron DeSantis': 'Politics',
  'Nikki Haley': 'Politics',
  'RFK Jr.': 'Politics',
  'Gavin Newsom': 'Politics',
  'Elizabeth Warren': 'Politics',
  'AOC': 'Politics',
  'Mitch McConnell': 'Politics',
  'Chuck Schumer': 'Politics',
  'Kevin McCarthy': 'Politics',
  'JD Vance': 'Politics',
  'Vivek Ramaswamy': 'Politics',
  'Elections': 'Politics',
  'Primaries': 'Politics',
  'Referendums': 'Politics',
  'President': 'Politics',
  'Vice President': 'Politics',
  'House': 'Politics',
  'Senate': 'Politics',
  'Governors': 'Politics',
  'Supreme Court': 'Politics',
  'Impeachment': 'Politics',
  'Government Shutdown': 'Politics',
  'Politics': 'Politics',
  'US Politics': 'Politics',
  'International Politics': 'Politics',
  'UK Election': 'Politics',
  'France Election': 'Politics',
  'German Election': 'Politics',
  'India Election': 'Politics',
  'Canada Election': 'Politics',
  'Mexico Election': 'Politics',
  'Brazil Election': 'Politics',

  // Crypto
  'Bitcoin': 'Crypto',
  'Ethereum': 'Crypto',
  'Solana': 'Crypto',
  'Avalanche': 'Crypto',
  'Cardano': 'Crypto',
  'XRP': 'Crypto',
  'Dogecoin': 'Crypto',
  'Shiba Inu': 'Crypto',
  'Polygon': 'Crypto',
  'Chainlink': 'Crypto',
  'Cosmos': 'Crypto',
  'Toncoin': 'Crypto',
  'Aptos': 'Crypto',
  'Sui': 'Crypto',
  'DeFi': 'Crypto',
  'DEXs': 'Crypto',
  'L2s': 'Crypto',
  'Meme Coins': 'Crypto',
  'Stablecoins': 'Crypto',
  'Bitcoin ETF': 'Crypto',
  'Ethereum ETF': 'Crypto',
  'Spot ETF': 'Crypto',
  'Crypto': 'Crypto',
  '15m': 'Crypto',
  'Hourly': 'Crypto',
  '4h': 'Crypto',
  'Daily': 'Crypto',
  'Weekly': 'Crypto',
  'Monthly': 'Crypto',

  // Sports
  'NFL': 'Sports',
  'CFB': 'Sports',
  'Super Bowl': 'Sports',
  'Chiefs': 'Sports',
  'Bills': 'Sports',
  'Eagles': 'Sports',
  'Cowboys': 'Sports',
  'Ravens': 'Sports',
  'Packers': 'Sports',
  'NBA': 'Sports',
  'WNBA': 'Sports',
  'NCAA CBB': 'Sports',
  'NHL': 'Sports',
  'Rangers': 'Sports',
  'Maple Leafs': 'Sports',
  'Bruins': 'Sports',
  'DOTA 2': 'Sports',
  'Counter-Strike': 'Sports',
  'League of Legends': 'Sports',
  'Valorant': 'Sports',
  'Overwatch': 'Sports',
  'ATP': 'Sports',
  'WTA': 'Sports',
  'Wimbledon': 'Sports',
  'US Open': 'Sports',
  'French Open': 'Sports',
  'Australian Open': 'Sports',
  'Sports': 'Sports',
  'Football': 'Sports',
  'Basketball': 'Sports',
  'Hockey': 'Sports',
  'Esports': 'Sports',
  'Tennis': 'Sports',

  // Tech
  'Apple': 'Tech',
  'Google': 'Tech',
  'Microsoft': 'Tech',
  'Meta': 'Tech',
  'Amazon': 'Tech',
  'Nvidia': 'Tech',
  'Tesla': 'Tech',
  'SpaceX': 'Tech',
  'OpenAI': 'Tech',
  'Anthropic': 'Tech',
  'xAI': 'Tech',
  'Grok': 'Tech',
  'MicroStrategy': 'Tech',
  'Oracle': 'Tech',
  'IBM': 'Tech',
  'Elon Musk': 'Tech',
  'Sam Altman': 'Tech',
  'Mark Zuckerberg': 'Tech',
  'Sundar Pichai': 'Tech',
  'Satya Nadella': 'Tech',
  'Jensen Huang': 'Tech',
  'Jeff Bezos': 'Tech',
  'AI': 'Tech',
  'AGI': 'Tech',
  'LLMs': 'Tech',
  'Robotics': 'Tech',
  'Drones': 'Tech',
  'Self-driving cars': 'Tech',
  'Rocket launches': 'Tech',
  'IPOs': 'Tech',
  'Tech': 'Tech',

  // Economy
  'CPI': 'Economy',
  'PPI': 'Economy',
  'GDP': 'Economy',
  'Unemployment': 'Economy',
  'Jobs report': 'Economy',
  'Retail sales': 'Economy',
  'Manufacturing PMI': 'Economy',
  'Consumer sentiment': 'Economy',
  'Fed': 'Economy',
  'ECB': 'Economy',
  'BOJ': 'Economy',
  'BOE': 'Economy',
  'Interest rates': 'Economy',
  'Rate cuts': 'Economy',
  'Rate hikes': 'Economy',
  'Economy': 'Economy',
  'Debt Ceiling': 'Economy',

  // Finance
  'S&P 500': 'Finance',
  'NASDAQ': 'Finance',
  'Dow Jones': 'Finance',
  'Russell 2000': 'Finance',
  'VIX': 'Finance',
  'AMD': 'Finance',
  'Intel': 'Finance',
  'TSM': 'Finance',
  'Qualcomm': 'Finance',
  'Oil': 'Finance',
  'WTI': 'Finance',
  'Brent': 'Finance',
  'Natural Gas': 'Finance',
  'Gold': 'Finance',
  'Silver': 'Finance',
  'Copper': 'Finance',
  'Finance': 'Finance',
  'Commodities': 'Finance',

  // World
  'Ukraine': 'World',
  'Russia': 'World',
  'Ukraine War': 'World',
  'Israel': 'World',
  'Gaza': 'World',
  'Palestine': 'World',
  'Gaza War': 'World',
  'Israel-Hamas': 'World',
  'China': 'World',
  'Taiwan': 'World',
  'Iran': 'World',
  'North Korea': 'World',
  'World': 'World',

  // Culture
  'Oscars': 'Culture',
  'Grammys': 'Culture',
  'Emmys': 'Culture',
  'Box office': 'Culture',
  'Movies': 'Culture',
  'MrBeast': 'Culture',
  'Logan Paul': 'Culture',
  'Jake Paul': 'Culture',
  'Kai Cenat': 'Culture',
  'Speed': 'Culture',
  'Culture': 'Culture',
  'Entertainment': 'Culture',

  // META CATEGORIES (These are modifiers, not primary categories)
  'Earnings': 'Earnings',
  'Revenue Beat': 'Earnings',
  'EPS Beat': 'Earnings',
  'Q1': 'Earnings',
  'Q2': 'Earnings',
  'Q3': 'Earnings',
  'Q4': 'Earnings',
  'Mentions': 'Mentions',
  'Tweet Markets': 'Mentions',
  'SOTU': 'Mentions',
  'Debate': 'Mentions',
};

/**
 * Categories that are modifiers, not primary categories
 * If a market has "Politics" + "Mentions", category = "Politics" (not "Mentions")
 */
export const META_CATEGORIES = new Set(['Mentions', 'Earnings']);

/**
 * Category priority when multiple categories are present (DEFAULT)
 * Higher index = higher priority
 * Used when NO sports context is detected
 */
export const CATEGORY_PRIORITY_DEFAULT = [
  'Other',      // 0 - default
  'Culture',    // 1
  'World',      // 2
  'Economy',    // 3
  'Tech',       // 4
  'Finance',    // 5
  'Crypto',     // 6
  'Sports',     // 7
  'Politics',   // 8 - highest priority in default context
];

/**
 * Category priority when SPORTS CONTEXT is detected
 * Higher index = higher priority
 * Used when slug contains nba-, mlb-, nfl-, nhl- OR market has NBA/MLB/NFL/NHL tags
 */
export const CATEGORY_PRIORITY_IF_SPORTS_CONTEXT = [
  'Other',      // 0 - default
  'Culture',    // 1
  'World',      // 2
  'Economy',    // 3
  'Tech',       // 4
  'Finance',    // 5
  'Crypto',     // 6
  'Politics',   // 7 - DEMOTED when in sports context
  'Sports',     // 8 - highest priority in sports context
];

/**
 * Legacy export for backward compatibility
 * @deprecated Use CATEGORY_PRIORITY_DEFAULT or CATEGORY_PRIORITY_IF_SPORTS_CONTEXT
 */
export const CATEGORY_PRIORITY = CATEGORY_PRIORITY_DEFAULT;
