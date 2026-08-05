/**
 * gsd-publish.js — "Publish to GSD".
 *
 * Publishing flags a saved plan as readable by the Regency GSD Project
 * Manager, which shares this Supabase project. The plans table is owner-only
 * under RLS, so a draft is invisible to everyone until its author publishes;
 * the plans_gsd_read policy then grants active GSD workspace members SELECT
 * on published rows and nothing else. Unpublishing hides the plan again.
 *
 * Requires the account (Supabase) session: Google-Drive and guest plans live
 * outside the database, so there is nothing for GSD to read until the plan is
 * saved into it, and saving needs a signed-in Supabase user.
 */

async function publishPlanToGSD() {
  const btn = document.getElementById('gsdPublishBtn');
  try {
    if (typeof currentSessionType !== 'function' || currentSessionType() !== 'account') {
      showToast('Sign in with your FluxPlanner account (not Google Drive or guest mode) to publish to GSD', 'error');
      return;
    }
    if (!window.supabaseClient) { showToast('Supabase is not available', 'error'); return; }
    if (btn) btn.disabled = true;

    // A brand-new plan has no database row yet; save it first so there is
    // something to publish. An open account plan already has its id.
    let id = window.currentPlanId;
    if (!id) {
      id = await dbSavePlan(buildSnapshot());
      window.currentPlanId = id;
    }

    // Toggle from the database's answer, not a cached flag — the same plan
    // may have been published from another window.
    const { data: row, error: readErr } = await window.supabaseClient
      .from('plans').select('published_to_gsd').eq('id', id).single();
    if (readErr) throw new Error(readErr.message);

    const next = !row.published_to_gsd;
    const { error } = await window.supabaseClient.from('plans').update({
      published_to_gsd: next,
      gsd_workspace_id: next ? (window.GSD_WORKSPACE_ID || 'regency-shalina') : null,
      published_at: next ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new Error(error.message);

    _setGSDPublishLabel(next);
    showToast(next
      ? '✅ Published — this plan is now visible in the GSD Project Manager'
      : 'Unpublished — this plan is hidden from GSD again', 'success');
  } catch (err) {
    showToast('Could not publish: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _setGSDPublishLabel(published) {
  const btn = document.getElementById('gsdPublishBtn');
  if (!btn) return;
  const label = btn.querySelector('span');
  if (label) label.textContent = published ? 'Published to GSD ✓' : 'Publish to GSD';
  btn.classList.toggle('gsd-published', !!published);
}

/** Show the true published state when an account plan is opened. */
async function refreshGSDPublishState() {
  try {
    if (typeof currentSessionType !== 'function' || currentSessionType() !== 'account'
        || !window.currentPlanId || !window.supabaseClient) {
      return _setGSDPublishLabel(false);
    }
    const { data } = await window.supabaseClient.from('plans')
      .select('published_to_gsd').eq('id', window.currentPlanId).single();
    _setGSDPublishLabel(!!(data && data.published_to_gsd));
  } catch (_) { _setGSDPublishLabel(false); }
}
