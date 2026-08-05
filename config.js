/**
 * config.js — App-wide Google OAuth configuration.
 *
 * These values are loaded ONCE for everyone, so users never have to paste
 * their own credentials. They are safe to ship in client-side code:
 *   • The OAuth Client ID is public by design (browser apps have no secret).
 *   • The API Key only enables the Drive discovery doc and MUST be locked down
 *     in Google Cloud Console (HTTP-referrer restriction to this app's domain
 *     + API restriction to "Google Drive API").
 *
 * If you ever rotate these, update them here and redeploy.
 */
window.GOOGLE_CLIENT_ID = '418302312424-08s29c6t4budhmvm284smqe07fa3rjtd.apps.googleusercontent.com';
window.GOOGLE_API_KEY   = 'AIzaSyBLQOgZKetCY1tNB4l_UzgLYPk6OZMk6oQ';

/**
 * Supabase — user accounts + saved-plan database.
 * The URL and publishable key are safe to ship in client-side code because
 * Row-Level Security restricts every user to only their own rows.
 * NEVER put the service_role / secret key here.
 */
window.SUPABASE_URL      = 'https://yqiufyruxwfnjlcwmfvy.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_vv7Psg40Ge6BfLoh-v4V2g_Ms8tV9Hl';

// Create the shared client once supabase-js (loaded in index.html) is present.
window.supabaseClient = (window.supabase && typeof window.supabase.createClient === 'function')
  ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null;

/**
 * GSD Project Manager — publishing target. A published plan becomes readable
 * by active members of this GSD workspace (see gsd-publish.js).
 */
window.GSD_WORKSPACE_ID = 'regency-shalina';
