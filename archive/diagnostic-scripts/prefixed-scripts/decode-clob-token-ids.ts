import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// From API response
const clobTokenIds = [
  "107207425104228585054846804229811775250469996608034879647959185171584221526925",
  "97802139306483482134529763039667417153637275017425631659766099684274969846522"
];

console.log('Decoding CLOB Token IDs to CTF IDs:\n');

for (const tokenId of clobTokenIds) {
  const tokenIdBigInt = BigInt(tokenId);

  // Extract CTF ID: token_id >> 8
  const ctfId = tokenIdBigInt >> 8n;

  // Extract mask: token_id & 0xFF
  const mask = Number(tokenIdBigInt & 0xFFn);

  // Convert to hex and pad to 64 chars
  const ctfHex64 = ctfId.toString(16).padStart(64, '0').toLowerCase();

  console.log(`Token ID: ${tokenId}`);
  console.log(`CTF ID (hex64): ${ctfHex64}`);
  console.log(`Mask: ${mask}`);
  console.log();
}

// Target CTF from our missing list
const targetCtf = '00d83a0c96a8f37f914ea3e2dbda3149446ee40b3127f7a144cec584ae195d22';
console.log(`\nTarget CTF from our list: ${targetCtf}`);
console.log(`Match found: TBD`);
