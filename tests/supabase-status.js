// The local Supabase stack's settings (`npx supabase status -o env`). In a
// container without the Supabase CLI (e.g. the WebKit tests), the same text can
// be passed in SUPABASE_STATUS_ENV. Callers still accept only local addresses.
import { execFileSync } from 'node:child_process';

export function supabaseStatus() {
  if (process.env.SUPABASE_STATUS_ENV) return process.env.SUPABASE_STATUS_ENV;
  try {
    return execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
}
