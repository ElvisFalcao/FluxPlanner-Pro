// Supabase Edge Function: admin
// Owner/admin user-management. Custom auth: the caller is the owner via a Google
// access token (x-google-token) OR an account-admin via their Supabase JWT
// (Authorization: Bearer). We resolve the caller's email and require their
// profile to have is_admin = true. The seed owner can't be demoted/deleted.
// Actions: list_users, list_plans, set_admin, set_password, delete_user.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CLIENT_ID = '418302312424-08s29c6t4budhmvm284smqe07fa3rjtd.apps.googleusercontent.com';
const OWNER_EMAIL = 'denyfalcao008@gmail.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-google-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

async function callerEmail(req: Request, admin: any): Promise<string | null> {
  const g = req.headers.get('x-google-token');
  if (g) {
    const ti = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(g));
    if (!ti.ok) return null;
    const info = await ti.json();
    if (info.aud !== CLIENT_ID || !info.email) return null;
    return String(info.email).toLowerCase();
  }
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace('Bearer ', '').trim();
  if (jwt) {
    const { data } = await admin.auth.getUser(jwt);
    if (data && data.user && data.user.email) return String(data.user.email).toLowerCase();
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const email = await callerEmail(req, admin);
    if (!email) return json({ error: 'Unauthorized' }, 401);
    const { data: me } = await admin.from('profiles').select('is_admin').eq('email', email).maybeSingle();
    if (!me || !me.is_admin) return json({ error: 'Not an admin' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === 'list_users') {
      const { data: profiles } = await admin.from('profiles').select('email, display_name, provider, user_id, is_admin, created_at, last_seen_at').order('created_at', { ascending: true });
      const { data: plans } = await admin.from('plans').select('owner_email');
      const counts: Record<string, number> = {};
      (plans || []).forEach((p: any) => { if (p.owner_email) counts[p.owner_email] = (counts[p.owner_email] || 0) + 1; });
      return json({ users: (profiles || []).map((u: any) => ({ ...u, plan_count: counts[u.email] || 0 })) });
    }

    if (action === 'list_plans') {
      const { data } = await admin.from('plans').select('id, owner_email, campaign_name, country, total_budget, data, created_at, updated_at').order('updated_at', { ascending: false });
      return json({ plans: data || [] });
    }

    if (action === 'set_admin') {
      const target = String(body.email || '').toLowerCase();
      if (!target) return json({ error: 'Missing email' }, 400);
      if (target === OWNER_EMAIL && body.isAdmin === false) return json({ error: 'The owner cannot be demoted.' }, 400);
      const { error } = await admin.from('profiles').update({ is_admin: !!body.isAdmin }).eq('email', target);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'set_password') {
      const target = String(body.email || '').toLowerCase();
      const pw = String(body.password || '');
      if (!target || pw.length < 6) return json({ error: 'Email and a 6+ char password required' }, 400);
      const { data: prof } = await admin.from('profiles').select('user_id').eq('email', target).maybeSingle();
      if (!prof || !prof.user_id) return json({ error: 'This user signs in with Google — no password to set.' }, 400);
      const { error } = await admin.auth.admin.updateUserById(prof.user_id, { password: pw });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'delete_user') {
      const target = String(body.email || '').toLowerCase();
      if (!target) return json({ error: 'Missing email' }, 400);
      if (target === OWNER_EMAIL) return json({ error: 'The owner cannot be deleted.' }, 400);
      const { data: prof } = await admin.from('profiles').select('user_id').eq('email', target).maybeSingle();
      await admin.from('plans').delete().eq('owner_email', target);
      if (prof && prof.user_id) {
        await admin.from('plans').delete().eq('user_id', prof.user_id);
        try { await admin.auth.admin.deleteUser(prof.user_id); } catch (_) { /* ignore */ }
      }
      await admin.from('profiles').delete().eq('email', target);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
