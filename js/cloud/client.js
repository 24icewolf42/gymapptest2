// Supabase client. cloud-config.js holds the project URL and the browser-safe
// publishable key; supabase-js is vendored (vendor/supabase.js), never loaded from a CDN.

const cfg = window.GYM_CLOUD_CONFIG || {};

// Where password-reset emails send people. Inside the Android app the page
// origin is https://localhost, so fall back to the deployed web app.
export const SITE_URL = cfg.siteUrl || 'https://roguelineageaccmanager.github.io/gymapptest2/';

export function cloudConfigured() {
  return !!(window.supabase && cfg.url && cfg.anonKey && !/YOUR_|PASTE_/i.test(cfg.url + cfg.anonKey));
}

export const supabase = cloudConfigured()
  ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

/** True when an error means a table or function from a newer migration is missing. */
export function isMissingSchema(error) {
  return !!error && ['PGRST202', 'PGRST205', '42P01', '42883', '42703'].includes(error.code);
}

/** Short, friendly text for an error from Supabase or the network. */
export function errorText(error, fallback = 'Something went wrong. Try again.') {
  if (!error) return fallback;
  if (error.message && /Failed to fetch|NetworkError|Load failed/i.test(error.message)) return 'No connection. Try again when you are online.';
  if (error.code === '23505') return 'That already exists.';
  if (error.code === '54000') return error.message;
  if (error.code === '22023') return error.message;
  return error.message || fallback;
}
