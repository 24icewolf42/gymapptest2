// Refuses to run the browser and Android tests unless the local Supabase stack
// is up, so they can never create accounts or data on a real project.
import { supabaseStatus } from './supabase-status.js';

export default function globalSetup() {
  const out = supabaseStatus();
  const url = (/^API_URL="?([^"\n]*)/m.exec(out) || [])[1];
  if (!url || !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error('Local Supabase is not running. Start it with `npx supabase start` before running these tests.');
  }
}
