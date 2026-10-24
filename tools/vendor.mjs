// Copies the pinned supabase-js browser build into vendor/ so the app never
// loads code from a CDN. Run after changing the version in package.json.
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json', 'utf8'));
const src = readFileSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'utf8');
writeFileSync('vendor/supabase.js', `/*! @supabase/supabase-js ${pkg.version} | MIT License | vendored by tools/vendor.mjs */\n` + src);
console.log('vendor/supabase.js ->', pkg.version);
