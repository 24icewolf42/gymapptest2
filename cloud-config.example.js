// Copy to cloud-config.js and replace both values from Supabase Project Settings > API.
// The anon/publishable key is intended for browsers; never put a service_role key here.
window.GYM_CLOUD_CONFIG = {
  url: 'https://YOUR-PROJECT.supabase.co',
  anonKey: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY'
};
