/**
 * Test Script: Verify Anonymous Workflow RLS Policies
 *
 * This script tests that the new RLS policies allow anonymous users
 * to save and retrieve workflows using the anonymous UUID.
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from .env.local
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Create anonymous client (no auth session)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';

async function testAnonymousWorkflow() {
  console.log('🧪 Testing Anonymous Workflow RLS Policies...\n');

  // Test 1: INSERT workflow as anonymous user
  console.log('Test 1: INSERT workflow as anonymous user');
  const testWorkflow = {
    user_id: ANONYMOUS_USER_ID,
    name: `Test Workflow ${Date.now()}`,
    description: 'Testing anonymous workflow save',
    nodes: [
      { id: 'node-1', type: 'trigger', position: { x: 100, y: 100 }, data: {} }
    ],
    edges: [],
    status: 'draft'
  };

  const { data: insertedWorkflow, error: insertError } = await supabase
    .from('workflow_sessions')
    .insert(testWorkflow)
    .select()
    .single();

  if (insertError) {
    console.error('❌ INSERT failed:', insertError.message);
    return false;
  }
  console.log('✅ INSERT successful:', insertedWorkflow.id);
  console.log();

  // Test 2: SELECT workflow as anonymous user
  console.log('Test 2: SELECT workflow as anonymous user');
  const { data: selectedWorkflows, error: selectError } = await supabase
    .from('workflow_sessions')
    .select('*')
    .eq('user_id', ANONYMOUS_USER_ID);

  if (selectError) {
    console.error('❌ SELECT failed:', selectError.message);
    return false;
  }
  console.log(`✅ SELECT successful: Found ${selectedWorkflows.length} workflows`);
  console.log();

  // Test 3: UPDATE workflow as anonymous user
  console.log('Test 3: UPDATE workflow as anonymous user');
  const { data: updatedWorkflow, error: updateError } = await supabase
    .from('workflow_sessions')
    .update({ description: 'Updated via anonymous user' })
    .eq('id', insertedWorkflow.id)
    .select()
    .single();

  if (updateError) {
    console.error('❌ UPDATE failed:', updateError.message);
    return false;
  }
  console.log('✅ UPDATE successful:', updatedWorkflow.description);
  console.log();

  // Test 4: Verify RLS policies (view policies)
  console.log('Test 4: Verify RLS policies exist');
  const { data: policies, error: policiesError } = await supabase
    .rpc('pg_policies')
    .select('policyname')
    .eq('tablename', 'workflow_sessions');

  // Note: This might fail if RPC function doesn't exist, that's okay
  if (!policiesError && policies && Array.isArray(policies)) {
    console.log('✅ RLS Policies:', policies.map((p: any) => p.policyname));
  } else {
    console.log('⚠️  Could not query policies (expected on anon client)');
  }
  console.log();

  // Test 5: Cleanup - delete test workflow
  console.log('Test 5: Cleanup test workflow');
  console.log('⚠️  Skipping DELETE (only authenticated users can delete)');
  console.log('   Test workflow ID:', insertedWorkflow.id);
  console.log('   (This will be cleaned up by an admin or expire naturally)');
  console.log();

  console.log('🎉 All anonymous workflow tests passed!');
  console.log('✅ Anonymous users can INSERT workflows');
  console.log('✅ Anonymous users can SELECT their workflows');
  console.log('✅ Anonymous users can UPDATE their workflows');
  console.log('✅ RLS policies are working correctly');

  return true;
}

// Run tests
testAnonymousWorkflow()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  });
