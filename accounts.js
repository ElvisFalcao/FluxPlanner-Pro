/**
 * accounts.js — user sessions, Supabase email/password accounts, guest mode,
 * and storage routing.
 *
 * Three kinds of session (window.appSession.type):
 *   'google'  → owner path. Auth + plan storage via Google Drive (export.js/plans.js). Untouched.
 *   'account' → Supabase email/password. Plans stored in the Supabase `plans` table.
 *   'guest'   → no account. Plans kept in this browser (localStorage). Export only, no Drive.
 *
 * The rest of the app calls the *Routed helpers below; they dispatch to the
 * right backend based on the current session type.
 */

window.appSession = null; // { type, email }

function currentSessionType() {
  return (window.appSession && window.appSession.type) || null;
}

function setSession(type, email) {
  window.appSession = { type, email: email || '' };
  updateDashboardChrome();
}

// ─── Screen helpers ─────────────────────────────────────────────────────────
function showLoginScreen() {
  const l = document.getElementById('loginScreen');
  const d = document.getElementById('dashboardScreen');
  const w = document.getElementById('appWrapper');
  if (l) l.style.display = 'flex';
  if (d) d.style.display = 'none';
  if (w) w.style.display = 'none';
}

/**
 * Update the dashboard header + which controls are visible, based on session.
 */
function updateDashboardChrome() {
  const s = window.appSession || {};
  const emailEl    = document.getElementById('dashboardUserEmail');
  const avatarEl   = document.getElementById('dashboardUserAvatar');
  const fallbackEl = document.getElementById('dashboardUserAvatarFallback');

  let label = 'Guest';
  if (s.type === 'google')  label = (window.driveUserInfo && window.driveUserInfo.email) || 'Google account';
  else if (s.type === 'account') label = s.email || 'My account';
  else if (s.type === 'guest')   label = 'Guest · not saved to cloud';
  if (emailEl) emailEl.textContent = label;

  // Google profile picture only applies to the Google path.
  if (s.type === 'google' && avatarEl && window.driveUserInfo && window.driveUserInfo.picture) {
    avatarEl.src = window.driveUserInfo.picture;
    avatarEl.style.display = 'inline-block';
    if (fallbackEl) fallbackEl.style.display = 'none';
  } else {
    if (avatarEl) avatarEl.style.display = 'none';
    if (fallbackEl) fallbackEl.style.display = '';
  }

  // Guest sign-up banner only for guests.
  const banner = document.getElementById('guestBanner');
  if (banner) banner.style.display = (s.type === 'guest') ? 'flex' : 'none';

  // Google Drive controls only make sense on the Google path.
  document.querySelectorAll('.drive-only').forEach(el => {
    el.style.display = (s.type === 'google') ? '' : 'none';
  });
}

// ─── Login-form helpers ─────────────────────────────────────────────────────
function _authVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

function _authMsg(text, kind) {
  const el = document.getElementById('authMsg');
  if (!el) return;
  el.textContent = text || '';
  el.style.display = text ? 'block' : 'none';
  el.style.color = kind === 'error' ? '#FF453A' : (kind === 'success' ? '#34D399' : '#CBD2DE');
}

function _authBusy(busy) {
  ['authSignInBtn', 'authSignUpBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.disabled = busy; b.style.opacity = busy ? '0.6' : '1'; }
  });
}

// ─── Account auth (Supabase) ────────────────────────────────────────────────
async function accountSignUp() {
  if (!window.supabaseClient) { _authMsg('Accounts are unavailable right now.', 'error'); return; }
  const email = _authVal('authEmail'); const pw = _authVal('authPassword');
  if (!email || !pw) { _authMsg('Enter an email and password.', 'error'); return; }
  if (pw.length < 6) { _authMsg('Password must be at least 6 characters.', 'error'); return; }

  _authMsg('', null); _authBusy(true);
  const { data, error } = await window.supabaseClient.auth.signUp({ email, password: pw });
  _authBusy(false);
  if (error) { _authMsg(error.message, 'error'); return; }
  if (!data.session) { _authMsg('Account created — check your inbox to confirm, then sign in.', 'success'); return; }

  setSession('account', email);
  await migrateGuestPlansToAccount();
  showDashboard();
}

async function accountSignIn() {
  if (!window.supabaseClient) { _authMsg('Accounts are unavailable right now.', 'error'); return; }
  const email = _authVal('authEmail'); const pw = _authVal('authPassword');
  if (!email || !pw) { _authMsg('Enter your email and password.', 'error'); return; }

  _authMsg('', null); _authBusy(true);
  const { error } = await window.supabaseClient.auth.signInWithPassword({ email, password: pw });
  _authBusy(false);
  if (error) { _authMsg(error.message, 'error'); return; }

  setSession('account', email);
  showDashboard();
}

// ─── Guest mode ─────────────────────────────────────────────────────────────
function continueAsGuest() {
  setSession('guest', '');
  showDashboard();
}

// ─── Unified sign-out ───────────────────────────────────────────────────────
async function appSignOut() {
  const t = currentSessionType();
  if (t === 'google' && typeof signOutGoogle === 'function') {
    window.appSession = null;
    signOutGoogle();           // revokes Google token, clears cache, shows login
    return;
  }
  if (t === 'account' && window.supabaseClient) {
    try { await window.supabaseClient.auth.signOut(); } catch (_) {}
  }
  window.appSession = null;
  showLoginScreen();
  if (typeof showToast === 'function') showToast('Signed out', 'success');
}

// ─── Session restore on load ────────────────────────────────────────────────
async function initSession() {
  // 1) An existing Supabase account session?
  try {
    if (window.supabaseClient) {
      const { data } = await window.supabaseClient.auth.getSession();
      if (data && data.session) {
        setSession('account', data.session.user && data.session.user.email);
        showDashboard();
        return;
      }
    }
  } catch (_) {}

  // 2) A cached Google session? (owner path, handled in export.js)
  if (typeof restoreGoogleSessionIfCached === 'function' && restoreGoogleSessionIfCached()) {
    return; // the Google flow will set the session + show the dashboard
  }

  // 3) Otherwise show the login screen.
  showLoginScreen();
}
window.addEventListener('DOMContentLoaded', initSession);

// ─── Supabase DB plan storage ───────────────────────────────────────────────
async function dbSavePlan(snapshot) {
  const { data: u } = await window.supabaseClient.auth.getUser();
  const uid = u && u.user && u.user.id;
  if (!uid) throw new Error('Not signed in');
  const { data, error } = await window.supabaseClient.from('plans').insert({
    user_id: uid,
    campaign_name: snapshot.campaignName || null,
    country: snapshot.country || null,
    total_budget: snapshot.totalBudget || null,
    data: snapshot,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function dbListPlans() {
  const { data, error } = await window.supabaseClient
    .from('plans')
    .select('id, data, created_at, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    ...(r.data || {}),
    _id: r.id,
    savedAt: (r.data && r.data.savedAt) || r.created_at,
  }));
}

async function dbLoadPlan(id) {
  const { data, error } = await window.supabaseClient.from('plans').select('data').eq('id', id).single();
  if (error) throw new Error(error.message);
  return { ...(data.data || {}), _id: id };
}

async function dbDeletePlan(id) {
  const { error } = await window.supabaseClient.from('plans').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ─── Guest plan storage (localStorage) ──────────────────────────────────────
const GUEST_PLANS_KEY = 'fpro_guest_plans';

function _guestReadAll() {
  try { return JSON.parse(localStorage.getItem(GUEST_PLANS_KEY) || '[]'); } catch (_) { return []; }
}
function _guestWriteAll(arr) {
  try { localStorage.setItem(GUEST_PLANS_KEY, JSON.stringify(arr)); } catch (_) {}
}
function guestSavePlan(snapshot) {
  const arr = _guestReadAll();
  const id = snapshot.id || ('local-' + (arr.length + 1) + '-' + (snapshot.savedAt || ''));
  arr.unshift({ ...snapshot, _id: id });
  _guestWriteAll(arr);
  return id;
}
function guestListPlans() { return _guestReadAll(); }
function guestLoadPlan(id) { return _guestReadAll().find(p => p._id === id) || null; }
function guestDeletePlan(id) { _guestWriteAll(_guestReadAll().filter(p => p._id !== id)); }

async function migrateGuestPlansToAccount() {
  try {
    const local = _guestReadAll();
    if (!local.length) return;
    for (const p of local) { try { await dbSavePlan(p); } catch (_) {} }
    _guestWriteAll([]);
    if (typeof showToast === 'function') showToast(`Imported ${local.length} guest plan(s) into your account`, 'success');
  } catch (_) {}
}

// ─── Routed storage (used by the rest of the app) ───────────────────────────
async function savePlanRouted(snapshot) {
  const t = currentSessionType();
  if (t === 'google')  return savePlanToDrive(snapshot);
  if (t === 'account') return dbSavePlan(snapshot);
  if (t === 'guest')   return guestSavePlan(snapshot);
  return null;
}
async function listPlansRouted() {
  const t = currentSessionType();
  if (t === 'google')  return listPlansFromDrive();
  if (t === 'account') return dbListPlans();
  if (t === 'guest')   return guestListPlans();
  return [];
}
async function loadPlanRouted(id) {
  const t = currentSessionType();
  if (t === 'google')  return loadPlanById(id);
  if (t === 'account') return dbLoadPlan(id);
  if (t === 'guest')   return guestLoadPlan(id);
  return null;
}
async function deletePlanRouted(id) {
  const t = currentSessionType();
  if (t === 'google')  return deletePlanFromDrive(id);
  if (t === 'account') return dbDeletePlan(id);
  if (t === 'guest')   return guestDeletePlan(id);
}
