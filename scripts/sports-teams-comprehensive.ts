/**
 * COMPREHENSIVE SPORTS TEAMS TAXONOMY
 *
 * This will be merged into polymarket-taxonomy.ts to fix misclassifications
 * Priority: Add BEFORE conflicting keywords (like "rocket" → SpaceX)
 */

import { KeywordMapping } from './polymarket-taxonomy';

export const NBA_TEAMS: KeywordMapping[] = [
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
  { keyword: 'magic', tags: ['Magic', 'NBA', 'Sports', 'Basketball'] },  // FIXES: Magic → AI conflict

  // Southwest Division
  { keyword: 'mavericks', tags: ['Mavericks', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'mavs', tags: ['Mavericks', 'NBA', 'Sports', 'Basketball'] },
  { keyword: 'rockets', tags: ['Rockets', 'NBA', 'Sports', 'Basketball'] },  // FIXES: Rockets → SpaceX conflict
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
];

export const MLB_TEAMS: KeywordMapping[] = [
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
  { keyword: 'rangers', tags: ['Rangers', 'MLB', 'Sports', 'Baseball'] },  // Note: Conflicts with NHL Rangers
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
];

export const NHL_TEAMS: KeywordMapping[] = [
  // Already in taxonomy: Rangers, Maple Leafs, Bruins
  // Add missing teams:

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
  { keyword: 'avalanche', tags: ['Avalanche', 'NHL', 'Sports', 'Hockey'] },  // Note: Conflicts with AVAX crypto
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
];
