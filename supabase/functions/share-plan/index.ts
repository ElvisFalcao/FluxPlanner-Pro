// Supabase Edge Function: share-plan
// Handles plan sharing between users. Auth: caller's Supabase JWT (account
// users) or Google access token (x-google-token) for Google session users.
// Actions: share, list_shared_with_me, list_shares, update_permission, revoke, mark_seen.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CLIENT_ID = '418302312424-08s29c6t4budhmvm284smqe07fa3rjtd.apps.googleusercontent.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-google-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Resolve the caller's email from either a Google token or Supabase JWT. */
async function callerEmail(req: Request, admin: any): Promise<{ email: string | null; userId: string | null }> {
  const g = req.headers.get('x-google-token');
  if (g) {
    const ti = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(g));
    if (!ti.ok) return { email: null, userId: null };
    const info = await ti.json();
    if (info.aud !== CLIENT_ID || !info.email) return { email: null, userId: null };
    return { email: String(info.email).toLowerCase(), userId: null };
  }
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace('Bearer ', '').trim();
  if (jwt) {
    const { data } = await admin.auth.getUser(jwt);
    if (data?.user?.email) return { email: String(data.user.email).toLowerCase(), userId: data.user.id };
  }
  return { email: null, userId: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const caller = await callerEmail(req, admin);
    if (!caller.email) return json({ error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // ── share: create a plan share ──────────────────────────────────────────
    if (action === 'share') {
      const planId = body.plan_id;
      const targetEmail = String(body.email || '').toLowerCase().trim();
      const permission = body.permission === 'edit' ? 'edit' : 'read';

      if (!planId || !targetEmail) return json({ error: 'plan_id and email are required' }, 400);
      if (targetEmail === caller.email) return json({ error: 'You cannot share a plan with yourself.' }, 400);

      // Verify the caller owns this plan
      const { data: plan } = await admin.from('plans').select('id, owner_email, user_id').eq('id', planId).maybeSingle();
      if (!plan) return json({ error: 'Plan not found' }, 404);
      const isOwner = (plan.owner_email && plan.owner_email.toLowerCase() === caller.email) ||
                      (plan.user_id && plan.user_id === caller.userId);
      if (!isOwner) return json({ error: 'Only the plan owner can share it.' }, 403);

      // Check if the target user exists in profiles
      const { data: profile } = await admin.from('profiles').select('email').eq('email', targetEmail).maybeSingle();
      const userExists = !!profile;

      // Insert the share (upsert: if already shared, update permission)
      const { error } = await admin.from('plan_shares').upsert({
        plan_id: planId,
        owner_email: caller.email,
        shared_with_email: targetEmail,
        permission,
        seen: false,
      }, { onConflict: 'plan_id,shared_with_email' });
      if (error) {
        if (error.code === '23505') return json({ error: 'This plan is already shared with that user.' }, 409);
        return json({ error: error.message }, 500);
      }

      return json({ ok: true, user_exists: userExists });
    }

    // ── list_shared_with_me: plans shared with the caller ───────────────────
    if (action === 'list_shared_with_me') {
      const { data: shares, error } = await admin
        .from('plan_shares')
        .select('id, plan_id, owner_email, permission, seen, created_at')
        .eq('shared_with_email', caller.email)
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);

      // Fetch the plan data for each share
      const planIds = (shares || []).map((s: any) => s.plan_id);
      let plans: any[] = [];
      if (planIds.length > 0) {
        const { data: planData } = await admin
          .from('plans')
          .select('id, data, owner_email, campaign_name, total_budget, country, created_at, updated_at')
          .in('id', planIds);
        plans = planData || [];
      }

      // Merge share info with plan data
      const result = (shares || []).map((s: any) => {
        const plan = plans.find((p: any) => p.id === s.plan_id);
        return {
          share_id: s.id,
          plan_id: s.plan_id,
          owner_email: s.owner_email,
          permission: s.permission,
          seen: s.seen,
          shared_at: s.created_at,
          plan: plan ? {
            ...(plan.data || {}),
            _id: plan.id,
            campaign_name: plan.campaign_name,
            total_budget: plan.total_budget,
            country: plan.country,
            savedAt: (plan.data && plan.data.savedAt) || plan.created_at,
          } : null,
        };
      }).filter((s: any) => s.plan !== null); // exclude shares where plan was deleted

      return json({ shares: result });
    }

    // ── list_shares: who a specific plan is shared with (for the owner) ─────
    if (action === 'list_shares') {
      const planId = body.plan_id;
      if (!planId) return json({ error: 'plan_id is required' }, 400);

      // Verify ownership
      const { data: plan } = await admin.from('plans').select('id, owner_email, user_id').eq('id', planId).maybeSingle();
      if (!plan) return json({ error: 'Plan not found' }, 404);
      const isOwner = (plan.owner_email && plan.owner_email.toLowerCase() === caller.email) ||
                      (plan.user_id && plan.user_id === caller.userId);
      if (!isOwner) return json({ error: 'Only the plan owner can view shares.' }, 403);

      const { data: shares, error } = await admin
        .from('plan_shares')
        .select('id, shared_with_email, permission, seen, created_at')
        .eq('plan_id', planId)
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);

      return json({ shares: shares || [] });
    }

    // ── update_permission: owner changes read/edit ──────────────────────────
    if (action === 'update_permission') {
      const shareId = body.share_id;
      const permission = body.permission === 'edit' ? 'edit' : 'read';
      if (!shareId) return json({ error: 'share_id is required' }, 400);

      // Get the share and verify ownership of the plan
      const { data: share } = await admin.from('plan_shares').select('id, plan_id').eq('id', shareId).maybeSingle();
      if (!share) return json({ error: 'Share not found' }, 404);

      const { data: plan } = await admin.from('plans').select('id, owner_email, user_id').eq('id', share.plan_id).maybeSingle();
      if (!plan) return json({ error: 'Plan not found' }, 404);
      const isOwner = (plan.owner_email && plan.owner_email.toLowerCase() === caller.email) ||
                      (plan.user_id && plan.user_id === caller.userId);
      if (!isOwner) return json({ error: 'Only the plan owner can change permissions.' }, 403);

      const { error } = await admin.from('plan_shares').update({ permission }).eq('id', shareId);
      if (error) return json({ error: error.message }, 500);

      return json({ ok: true });
    }

    // ── revoke: owner removes a share ───────────────────────────────────────
    if (action === 'revoke') {
      const shareId = body.share_id;
      if (!shareId) return json({ error: 'share_id is required' }, 400);

      const { data: share } = await admin.from('plan_shares').select('id, plan_id').eq('id', shareId).maybeSingle();
      if (!share) return json({ error: 'Share not found' }, 404);

      const { data: plan } = await admin.from('plans').select('id, owner_email, user_id').eq('id', share.plan_id).maybeSingle();
      if (!plan) return json({ error: 'Plan not found' }, 404);
      const isOwner = (plan.owner_email && plan.owner_email.toLowerCase() === caller.email) ||
                      (plan.user_id && plan.user_id === caller.userId);
      if (!isOwner) return json({ error: 'Only the plan owner can revoke shares.' }, 403);

      const { error } = await admin.from('plan_shares').delete().eq('id', shareId);
      if (error) return json({ error: error.message }, 500);

      return json({ ok: true });
    }

    // ── mark_seen: recipient marks shares as seen (clears notification) ─────
    if (action === 'mark_seen') {
      const shareIds = body.share_ids;
      if (!Array.isArray(shareIds) || shareIds.length === 0) return json({ error: 'share_ids array required' }, 400);

      const { error } = await admin
        .from('plan_shares')
        .update({ seen: true })
        .in('id', shareIds)
        .eq('shared_with_email', caller.email);
      if (error) return json({ error: error.message }, 500);

      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
