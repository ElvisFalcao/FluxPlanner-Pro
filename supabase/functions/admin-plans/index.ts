// Supabase Edge Function: admin-plans
// Returns ALL account-users' plans — owner-only.
// The admin is the app owner's Google account; this function has custom auth
// (a Google access token), so verify_jwt is OFF and we verify the token here:
// it must belong to OUR OAuth client AND to the admin email. Uses the service
// role to read across all users. Deployed to Supabase; mirrored here for VCS.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ADMIN_EMAIL = 'denyfalcao008@gmail.com';
const CLIENT_ID = '418302312424-08s29c6t4budhmvm284smqe07fa3rjtd.apps.googleusercontent.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-google-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const gtoken = req.headers.get('x-google-token') || '';
    if (!gtoken) return json({ error: 'Missing Google token' }, 401);

    // Verify the Google access token belongs to OUR client and the admin email.
    const ti = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(gtoken));
    if (!ti.ok) return json({ error: 'Invalid Google token' }, 401);
    const info = await ti.json();
    const email = (info.email || '').toLowerCase();
    if (info.aud !== CLIENT_ID) return json({ error: 'Wrong client' }, 403);
    if (email !== ADMIN_EMAIL) return json({ error: 'Not an admin' }, 403);
    if (info.email_verified === 'false' || info.email_verified === false) return json({ error: 'Email not verified' }, 403);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data, error } = await admin
      .from('plans')
      .select('id, owner_email, campaign_name, country, total_budget, data, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ plans: data || [] });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
