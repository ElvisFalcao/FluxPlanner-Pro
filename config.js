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
