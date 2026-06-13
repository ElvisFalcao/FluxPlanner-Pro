// Supabase Edge Function: track-login
// Records a Google sign-in as a row in `profiles` (so the admin can see/manage
// Google users) and returns whether they're an admin. Verifies the Google
// access token belongs to our OAuth client. verify_jwt is off (custom auth).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CLIENT_ID = '418302312424-08s29c6t4budhmvm284smqe07fa3rjtd.apps.googleusercontent.com';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-google-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const g = req.headers.get('x-google-token') || '';
    if (!g) return json({ error: 'Missing Google token' }, 401);
    const ti = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(g));
    if (!ti.ok) return json({ error: 'Invalid token' }, 401);
    const info = await ti.json();
    if (info.aud !== CLIENT_ID) return json({ error: 'Wrong client' }, 403);
    const email = (info.email || '').toLowerCase();
    if (!email) return json({ error: 'No email' }, 403);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // Upsert without touching is_admin (preserved on conflict; defaults false on insert).
    await admin.from('profiles').upsert(
      { email, display_name: body.name || null, provider: 'google', last_seen_at: new Date().toISOString() },
      { onConflict: 'email' }
    );
    const { data: prof } = await admin.from('profiles').select('is_admin').eq('email', email).single();
    return json({ is_admin: !!(prof && prof.is_admin) });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
