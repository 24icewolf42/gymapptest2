// Shared setup for tests that talk to the local Supabase stack (`npx supabase start`).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

let env = null;
export function localEnv() {
  if (env) return env;
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  env = {};
  out.split('\n').forEach((line) => {
    const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  });
  if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) throw new Error('Local Supabase is not running. Start it with `npx supabase start`.');
  return env;
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function adminClient() {
  const e = localEnv();
  return createClient(e.API_URL, e.SERVICE_ROLE_KEY, options);
}

export function anonClient() {
  const e = localEnv();
  return createClient(e.API_URL, e.ANON_KEY, options);
}

/** Creates a confirmed user and returns { id, email, username, client } signed in as them. */
export async function makeUser(username, extra = {}) {
  const admin = adminClient();
  const tag = randomUUID().slice(0, 8);
  const email = `${username || 'u'}-${tag}@example.test`;
  const password = 'test-password-123';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { age_confirmed: 'true', ...(username ? { username } : {}), ...extra } });
  if (error) throw error;
  const client = anonClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  // Right after a database reset the API may still be reloading its schema: retry briefly.
  let profile;
  for (let i = 0; i < 10; i++) {
    profile = await admin.from('profiles').select('username').eq('id', data.user.id).single();
    if (!profile.error) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { id: data.user.id, email, password, username: profile.data && profile.data.username, client };
}

export function uniqueName(prefix) {
  return (prefix + '_' + randomUUID().replace(/-/g, '').slice(0, 8)).slice(0, 20);
}

export async function befriend(a, b) {
  const req = await a.client.from('friend_requests').insert({ requester_id: a.id, target_id: b.id, status: 'pending' }).select('id').single();
  if (req.error) throw req.error;
  const acc = await b.client.from('friend_requests').update({ status: 'accepted' }).eq('id', req.data.id);
  if (acc.error) throw acc.error;
  return req.data.id;
}
