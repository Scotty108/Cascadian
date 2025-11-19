import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

// From biden-market-raw-response.json
const clobTokenIds = [
  "53135072462907880191400140706440867753044989936304433583131786753949599718775",
  "60869871469376321574904667328762911501870754872924453995477779862968218702336"
];

// Our 5 missing CTFs
const missingCTFs = [
  "001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48",
  "00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af",
  "00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb",
  "00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22",
  "001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e",
];

// Market's condition ID
const marketConditionId = "0xe3b423dfad8c22ff75c9899c4e8176f628cf4ad4caa00481764d320e7415f7a9";

function decodeTokenId(tokenId: string): { ctf: string, outcome: number } {
  const bn = BigInt(tokenId);

  // ERC1155 token encoding: token_id = (ctf_id << 8) | mask
  // Where mask encodes outcome index
  const mask = Number(bn & 0xFFn); // Last byte
  const ctf = bn >> 8n; // Rest is CTF ID

  const ctfHex = ctf.toString(16).padStart(64, '0');

  return {
    ctf: ctfHex,
    outcome: mask
  };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DECODE BIDEN MARKET TOKEN IDS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Market Condition ID:');
  console.log(`   ${marketConditionId}\n`);

  console.log('CLOB Token IDs from market:\n');

  const decodedTokens: Array<{ token: string, ctf: string, outcome: number }> = [];

  clobTokenIds.forEach((token, i) => {
    const decoded = decodeTokenId(token);
    decodedTokens.push({ token, ...decoded });

    console.log(`${i + 1}. Token ID: ${token}`);
    console.log(`   CTF: ${decoded.ctf}`);
    console.log(`   Outcome index: ${decoded.outcome}\n`);
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON WITH MISSING CTFs');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Our 5 missing CTFs:\n');

  const matchResults: Array<{ ctf: string, matches: boolean, matchedToken?: string, outcome?: number }> = [];

  missingCTFs.forEach((ctf, i) => {
    const match = decodedTokens.find(t => t.ctf === ctf);

    console.log(`${i + 1}. ${ctf.substring(0, 20)}...`);

    if (match) {
      console.log(`   ✅ MATCHES token outcome ${match.outcome}`);
      matchResults.push({ ctf, matches: true, matchedToken: match.token, outcome: match.outcome });
    } else {
      console.log(`   ❌ No match`);
      matchResults.push({ ctf, matches: false });
    }
    console.log();
  });

  const matchCount = matchResults.filter(r => r.matches).length;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Matched: ${matchCount} / 5 CTFs\n`);

  if (matchCount === 0) {
    console.log('❌ NO MATCHES - This is NOT the right market\n');
    console.log('The 5 CTFs must decode to a different condition_id\n');
    console.log('Our CTFs are NOT standard ERC1155 token encodings');
    console.log('They appear to be raw condition IDs, not token IDs\n');

    console.log('Next steps:');
    console.log('   1. Check if our 5 CTFs ARE the condition IDs themselves');
    console.log('   2. Try querying Gamma with each as condition ID');
    console.log('   3. They might be from 5 different markets (not multi-outcome)\n');

  } else if (matchCount < 5) {
    console.log(`⚠️  PARTIAL MATCH - Only ${matchCount}/5 found\n`);
    console.log('The market has 2 outcomes but we have 5 CTFs');
    console.log('Some CTFs must be from different outcomes or markets\n');
  } else {
    console.log('✅ ALL MATCH - This is the right market!\n');
    console.log('Next step: Fetch resolution data and insert\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
