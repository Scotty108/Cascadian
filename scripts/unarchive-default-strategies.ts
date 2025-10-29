/**
 * Unarchive Default Strategies
 *
 * Migration 20251027000004 archived all predefined strategies, but new ones were never added.
 * This script unarchives the predefined strategies so they show up in the library again.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log('🔍 Checking for archived predefined strategies...\n');

  // First, check what we have
  const { data: archived, error: checkError } = await supabase
    .from('strategy_definitions')
    .select('strategy_id, strategy_name, is_predefined, is_archived')
    .eq('is_predefined', true)
    .eq('is_archived', true);

  if (checkError) {
    console.error('❌ Error checking strategies:', checkError);
    process.exit(1);
  }

  if (!archived || archived.length === 0) {
    console.log('✅ No archived predefined strategies found. All good!');
    return;
  }

  console.log(`📦 Found ${archived.length} archived predefined strategies:\n`);
  archived.forEach((s) => {
    console.log(`  - ${s.strategy_name} (${s.strategy_id})`);
  });

  console.log('\n🔄 Unarchiving strategies...\n');

  // Unarchive them
  const { data: updated, error: updateError } = await supabase
    .from('strategy_definitions')
    .update({ is_archived: false })
    .eq('is_predefined', true)
    .eq('is_archived', true)
    .select();

  if (updateError) {
    console.error('❌ Error unarchiving strategies:', updateError);
    process.exit(1);
  }

  console.log(`✅ Successfully unarchived ${updated?.length || 0} strategies!\n`);

  // Verify
  const { data: active, error: verifyError } = await supabase
    .from('strategy_definitions')
    .select('strategy_id, strategy_name, is_predefined, is_archived')
    .eq('is_predefined', true)
    .eq('is_archived', false);

  if (verifyError) {
    console.error('❌ Error verifying:', verifyError);
    process.exit(1);
  }

  console.log(`📊 Total active predefined strategies: ${active?.length || 0}\n`);
  active?.forEach((s) => {
    console.log(`  ✓ ${s.strategy_name}`);
  });

  console.log('\n✨ Done!');
}

main().catch(console.error);
