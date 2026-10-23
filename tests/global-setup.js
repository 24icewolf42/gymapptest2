// Refuses to run the browser and Android tests unless the local Supabase stack
// is up, so they can never create accounts or data on a real project.
import { execFileSync } from 'node:child_process';

export default function globalSetup() {
  let out = '';
  try {
    out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* handled below */ }
  const url = (/^API_URL="?([^"\n]*)/m.exec(out) || [])[1];
  if (!url || !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error('Local Supabase is not running. Start it with `npx supabase start` before running these tests.');
  }
}
