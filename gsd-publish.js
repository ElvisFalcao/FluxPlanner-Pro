/**
 * gsd-publish.js — "Publish to GSD".
 *
 * Publishing flags a saved plan as readable by the Regency GSD Project
 * Manager, which shares this Supabase project. The plans table is owner-only
 * under RLS, so a draft is invisible to everyone until its author publishes;
 * the plans_gsd_read policy then grants active GSD workspace members SELECT
 * on published rows and nothing else. Unpublishing hides the plan again.
 *
 * Publishing also records which Shalina brand the plan belongs to. FluxPlanner
 * itself has no brand concept, but GSD validates every row against the brand's
 * eligible markets and platforms, so without this the importer had to guess.
 *
 * Requires the account (Supabase) session: Google-Drive and guest plans live
 * outside the database, so there is nothing for GSD to read until the plan is
 * saved into it, and saving needs a signed-in Supabase user.
 */

// Mirror of GSD's BRAND_CATALOG keys. If a brand is added there, add it here.
const GSD_BRANDS = ['Germol', 'Flodent', 'Aco', 'Shaltoux', "Shal'Artem", 'Ibucap'];

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
      .from('plans').select('published_to_gsd, gsd_brand').eq('id', id).single();
    if (readErr) throw new Error(readErr.message);

    const next = !row.published_to_gsd;
    let brand = row.gsd_brand || null;
    if (next && !brand) {
      brand = await _askGSDBrand();
      if (!brand) return; // cancelled — publish nothing
    }

    const { error } = await window.supabaseClient.from('plans').update({
      published_to_gsd: next,
      gsd_workspace_id: next ? (window.GSD_WORKSPACE_ID || 'regency-shalina') : null,
      gsd_brand: next ? brand : row.gsd_brand, // keep the brand on unpublish for the next publish
      published_at: next ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) throw new Error(error.message);

    _setGSDPublishLabel(next);
    showToast(next
      ? `✅ Published as ${brand} — this plan is now visible in the GSD Project Manager`
      : 'Unpublished — this plan is hidden from GSD again', 'success');
  } catch (err) {
    showToast('Could not publish: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Small one-question dialog: which brand is this plan for? */
function _askGSDBrand() {
  return new Promise((resolve) => {
    let dlg = document.getElementById('gsdBrandDialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'gsdBrandDialog';
      dlg.style.cssText = 'border:0;border-radius:14px;padding:24px;max-width:320px;background:var(--card,#1c2733);color:inherit;';
      dlg.innerHTML = `
        <h3 style="margin:0 0 6px;font-size:1rem;">Which brand is this plan for?</h3>
        <p style="margin:0 0 14px;font-size:.85rem;opacity:.7;">GSD validates every row against the brand's markets and platforms.</p>
        <select id="gsdBrandSelect" style="width:100%;padding:9px;border-radius:8px;margin-bottom:14px;">
          <option value="">Choose a brand…</option>
          ${GSD_BRANDS.map((b) => `<option>${b}</option>`).join('')}
        </select>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button type="button" id="gsdBrandCancel" class="btn">Cancel</button>
          <button type="button" id="gsdBrandOk" class="btn btn-primary">Publish</button>
        </div>`;
      document.body.appendChild(dlg);
    }
    const done = (value) => { dlg.close(); resolve(value); };
    dlg.querySelector('#gsdBrandCancel').onclick = () => done(null);
    dlg.querySelector('#gsdBrandOk').onclick = () => {
      const value = dlg.querySelector('#gsdBrandSelect').value;
      if (!value) { showToast('Choose a brand first', 'error'); return; }
      done(value);
    };
    dlg.showModal();
  });
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
