/**
 * gsd-publish.js — "Publish to GSD", from any session.
 *
 * FluxPlanner is deliberately usable without an account, so publishing must
 * be too. Three cases:
 *
 *   account — the plan already lives in the Supabase plans table; publishing
 *             toggles the flag on that row.
 *   google / guest — the plan lives in Drive or this browser. Publishing
 *             silently signs in anonymously (no form, no password), copies the
 *             plan into the database owned by that session, and flags it.
 *             The copy is found again by the plan's own snapshot id, so
 *             republishing updates rather than duplicates.
 *
 * Requires "Allow anonymous sign-ins" in Supabase Auth settings. RLS is
 * untouched: an anonymous user owns only the rows they created, and the GSD
 * side can only read published plans — plus unpublish them, which is how the
 * import list stays curated.
 */

// Mirror of GSD's BRAND_CATALOG keys. If a brand is added there, add it here.
const GSD_BRANDS = ['Germol', 'Flodent', 'Aco', 'Shaltoux', "Shal'Artem", 'Ibucap'];

async function publishPlanToGSD() {
  const btn = document.getElementById('gsdPublishBtn');
  try {
    if (!window.supabaseClient) { showToast('Supabase is not available', 'error'); return; }
    if (btn) btn.disabled = true;

    const isAccount = typeof currentSessionType === 'function' && currentSessionType() === 'account';
    const target = isAccount ? await _accountPlanRow() : await _copiedPlanRow();
    if (!target) return; // a toast has already said why

    const next = !target.published;
    let brand = target.brand || null;
    if (next && !brand) {
      brand = await _askGSDBrand();
      if (!brand) return; // cancelled — publish nothing
    }

    const update = {
      published_to_gsd: next,
      gsd_workspace_id: next ? (window.GSD_WORKSPACE_ID || 'regency-shalina') : null,
      gsd_brand: next ? brand : target.brand, // survives unpublish for next time
      published_at: next ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    // Republishing a Drive/guest plan also refreshes the stored copy, so GSD
    // imports what the author sees now, not what they published last month.
    if (next && target.snapshot) {
      update.data = target.snapshot;
      update.campaign_name = target.snapshot.campaignName || null;
      update.country = target.snapshot.country || null;
      update.total_budget = target.snapshot.totalBudget || null;
    }
    const { error } = await window.supabaseClient.from('plans').update(update).eq('id', target.id);
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

/** Account session: the open plan's own database row. */
async function _accountPlanRow() {
  let id = window.currentPlanId;
  if (!id) {
    id = await dbSavePlan(buildSnapshot());
    window.currentPlanId = id;
  }
  const { data, error } = await window.supabaseClient
    .from('plans').select('id, published_to_gsd, gsd_brand').eq('id', id).single();
  if (error) throw new Error(error.message);
  return { id: data.id, published: data.published_to_gsd, brand: data.gsd_brand, snapshot: buildSnapshot() };
}

/**
 * Drive/guest session: find or create the plan's copy in the database, owned
 * by a silent anonymous session. The snapshot id is the stable key — it is
 * minted once per plan and survives every save, so republishing finds the
 * same row instead of stacking duplicates.
 */
async function _copiedPlanRow() {
  let { data: { session } } = await window.supabaseClient.auth.getSession();
  if (!session) {
    const { data, error } = await window.supabaseClient.auth.signInAnonymously();
    if (error) {
      showToast('Publishing without an account needs "Allow anonymous sign-ins" enabled in Supabase Auth settings — or sign in and try again.', 'error');
      return null;
    }
    session = data.session;
  }

  const snapshot = buildSnapshot();
  const { data: existing, error: findErr } = await window.supabaseClient
    .from('plans').select('id, published_to_gsd, gsd_brand')
    .eq('data->>id', snapshot.id).limit(1).maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (existing) return { id: existing.id, published: existing.published_to_gsd, brand: existing.gsd_brand, snapshot };

  const { data: created, error: insertErr } = await window.supabaseClient.from('plans').insert({
    user_id: session.user.id,
    owner_email: (window.appSession && window.appSession.email) || null,
    campaign_name: snapshot.campaignName || null,
    country: snapshot.country || null,
    total_budget: snapshot.totalBudget || null,
    data: snapshot,
  }).select('id').single();
  if (insertErr) throw new Error(insertErr.message);
  return { id: created.id, published: false, brand: null, snapshot };
}

/** Small one-question dialog: which brand is this plan for? */
function _askGSDBrand() {
  return new Promise((resolve) => {
    let dlg = document.getElementById('gsdBrandDialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'gsdBrandDialog';
      // margin:auto restores the native centering that the app's CSS reset
      // strips from <dialog>; the select gets explicit colors because the
      // browser default is a white control, which drowns light theme text.
      dlg.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(320px,90vw);height:fit-content;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:24px;background:var(--card,#1c2733);color:var(--text,#e5eef7);box-shadow:0 24px 70px rgba(0,0,0,.5);';
      dlg.innerHTML = `
        <h3 style="margin:0 0 6px;font-size:1rem;">Which brand is this plan for?</h3>
        <p style="margin:0 0 14px;font-size:.85rem;opacity:.7;">GSD validates every row against the brand's markets and platforms.</p>
        <select id="gsdBrandSelect" style="width:100%;padding:10px;border-radius:8px;margin-bottom:14px;background:#0f1722;color:#e5eef7;border:1px solid rgba(255,255,255,.18);font-size:.9rem;">
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

/** Show the true published state when a plan is opened, whatever the session. */
async function refreshGSDPublishState() {
  try {
    if (!window.supabaseClient) return _setGSDPublishLabel(false);
    const isAccount = typeof currentSessionType === 'function' && currentSessionType() === 'account';
    if (isAccount && window.currentPlanId) {
      const { data } = await window.supabaseClient.from('plans')
        .select('published_to_gsd').eq('id', window.currentPlanId).single();
      return _setGSDPublishLabel(!!(data && data.published_to_gsd));
    }
    // Drive/guest: only findable if this browser still holds the session that
    // published it. A cold browser shows unpublished, which errs safe — the
    // worst outcome is being asked the brand question again.
    if (window.currentSnapshotId) {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (!session) return _setGSDPublishLabel(false);
      const { data } = await window.supabaseClient.from('plans')
        .select('published_to_gsd').eq('data->>id', window.currentSnapshotId).limit(1).maybeSingle();
      return _setGSDPublishLabel(!!(data && data.published_to_gsd));
    }
    _setGSDPublishLabel(false);
  } catch (_) { _setGSDPublishLabel(false); }
}
