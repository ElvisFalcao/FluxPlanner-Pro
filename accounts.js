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
  let avatarUrl = '';
  if (s.type === 'google') {
    label = (window.driveUserInfo && window.driveUserInfo.email) || 'Google account';
    avatarUrl = (window.driveUserInfo && window.driveUserInfo.picture) || '';
  } else if (s.type === 'account') {
    const md = (window.accountUser && window.accountUser.user_metadata) || {};
    label = md.display_name || s.email || 'My account';
    avatarUrl = md.avatar_url || '';
  } else if (s.type === 'guest') {
    label = 'Guest · not saved to cloud';
  }
  if (emailEl) emailEl.textContent = label;

  if (avatarUrl && avatarEl) {
    avatarEl.src = avatarUrl;
    avatarEl.style.display = 'inline-block';
    if (fallbackEl) fallbackEl.style.display = 'none';
  } else {
    if (avatarEl) avatarEl.style.display = 'none';
    if (fallbackEl) fallbackEl.style.display = '';
  }

  // Guest sign-up banner only for guests.
  const banner = document.getElementById('guestBanner');
  if (banner) banner.style.display = (s.type === 'guest') ? 'flex' : 'none';

  // Settings is for account users (avatar / password / connectors live there).
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) settingsBtn.style.display = (s.type === 'account') ? '' : 'none';

  // Google Drive controls: the Google owner always; account users once connected.
  const driveVisible = (s.type === 'google') || (s.type === 'account' && window.driveConnected);
  document.querySelectorAll('.drive-only').forEach(el => {
    el.style.display = driveVisible ? '' : 'none';
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
  await refreshAccountUser();
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
  await refreshAccountUser();
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
  window.accountUser = null;
  window.driveConnected = false;
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
        window.accountUser = data.session.user;
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

// Update an existing plan in place (no new copy) — used when editing a plan,
// tracking actual spend, or marking items complete.
async function dbUpdatePlan(id, snapshot) {
  const { error } = await window.supabaseClient.from('plans').update({
    campaign_name: snapshot.campaignName || null,
    country: snapshot.country || null,
    total_budget: snapshot.totalBudget || null,
    data: snapshot,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error(error.message);
  return id;
}

function guestUpdatePlan(id, snapshot) {
  const arr = _guestReadAll();
  const i = arr.findIndex(p => p._id === id);
  if (i >= 0) { arr[i] = { ...snapshot, _id: id }; _guestWriteAll(arr); }
  return id;
}

async function updatePlanRouted(id, snapshot) {
  const t = currentSessionType();
  if (t === 'google')  return updatePlanInDrive(id, snapshot);
  if (t === 'account') return dbUpdatePlan(id, snapshot);
  if (t === 'guest')   return guestUpdatePlan(id, snapshot);
}

// ─── Account settings (avatar, display name, password, connectors, delete) ──
window.accountUser = null;

async function refreshAccountUser() {
  try {
    if (!window.supabaseClient) return null;
    const { data } = await window.supabaseClient.auth.getUser();
    window.accountUser = (data && data.user) || null;
    return window.accountUser;
  } catch (_) { return null; }
}

function _settingsMsg(text, kind) {
  const el = document.getElementById('settingsMsg');
  if (!el) return;
  el.textContent = text || '';
  el.style.display = text ? 'block' : 'none';
  el.style.color = kind === 'error' ? '#FF453A' : '#34D399';
}

function openSettings() {
  if (currentSessionType() !== 'account') return;
  const m = document.getElementById('settingsModal');
  if (!m) return;
  loadSettingsValues();
  m.classList.remove('hidden');
}

function closeSettings(event) {
  if (event && event.target !== event.currentTarget) return; // overlay-only close
  const m = document.getElementById('settingsModal');
  if (m) m.classList.add('hidden');
}

function loadSettingsValues() {
  const u = window.accountUser;
  const md = (u && u.user_metadata) || {};
  const email = (window.appSession && window.appSession.email) || (u && u.email) || '';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const emailEl = document.getElementById('settingsEmail'); if (emailEl) emailEl.textContent = email;
  set('displayNameInput', md.display_name || '');
  set('newPassword', ''); set('newPasswordConfirm', '');
  const avi = document.getElementById('settingsAvatar');
  if (avi) avi.src = md.avatar_url || _placeholderAvatar(email);
  const ds = document.getElementById('driveStatus');
  if (ds) { ds.textContent = window.driveConnected ? '✓ Connected' : ''; ds.style.color = '#34D399'; }
  _settingsMsg('', null);
}

function _placeholderAvatar(seed) {
  const letter = ((seed || 'U').trim()[0] || 'U').toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' rx='32' fill='%230B1326'/><text x='32' y='42' font-family='Inter,sans-serif' font-size='28' fill='%23FCA311' text-anchor='middle'>${letter}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + svg;
}

async function saveDisplayName() {
  const el = document.getElementById('displayNameInput');
  const name = el ? el.value.trim() : '';
  const { error } = await window.supabaseClient.auth.updateUser({ data: { display_name: name } });
  if (error) { _settingsMsg(error.message, 'error'); return; }
  await refreshAccountUser();
  updateDashboardChrome();
  _settingsMsg('Profile saved', 'success');
}

async function uploadAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) { _settingsMsg('Image must be under 3 MB.', 'error'); input.value = ''; return; }
  const u = window.accountUser || await refreshAccountUser();
  if (!u) { _settingsMsg('Not signed in.', 'error'); return; }
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${u.id}/avatar_${Date.now()}.${ext}`;
  _settingsMsg('Uploading…', 'success');
  const up = await window.supabaseClient.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (up.error) { _settingsMsg(up.error.message, 'error'); input.value = ''; return; }
  const { data: pub } = window.supabaseClient.storage.from('avatars').getPublicUrl(path);
  const publicUrl = pub.publicUrl;
  await window.supabaseClient.auth.updateUser({ data: { avatar_url: publicUrl } });
  await refreshAccountUser();
  const avi = document.getElementById('settingsAvatar'); if (avi) avi.src = publicUrl;
  updateDashboardChrome();
  _settingsMsg('Photo updated', 'success');
  input.value = '';
}

async function changePassword() {
  const p1 = (document.getElementById('newPassword') || {}).value || '';
  const p2 = (document.getElementById('newPasswordConfirm') || {}).value || '';
  if (p1.length < 6) { _settingsMsg('Password must be at least 6 characters.', 'error'); return; }
  if (p1 !== p2) { _settingsMsg('Passwords do not match.', 'error'); return; }
  const { error } = await window.supabaseClient.auth.updateUser({ password: p1 });
  if (error) { _settingsMsg(error.message, 'error'); return; }
  const a = document.getElementById('newPassword'); if (a) a.value = '';
  const b = document.getElementById('newPasswordConfirm'); if (b) b.value = '';
  _settingsMsg('Password updated', 'success');
}

async function signOutEverywhere() {
  try { await window.supabaseClient.auth.signOut({ scope: 'global' }); } catch (_) {}
  window.appSession = null; window.accountUser = null; window.driveConnected = false;
  closeSettings();
  showLoginScreen();
  if (typeof showToast === 'function') showToast('Signed out on all devices', 'success');
}

function connectDriveFromSettings() {
  if (typeof connectDriveOnly === 'function') connectDriveOnly();
  else _settingsMsg('Drive connect is unavailable.', 'error');
}

async function deleteAccount() {
  if (!confirm('Permanently delete your account and all of your saved plans? This cannot be undone.')) return;
  _settingsMsg('Deleting account…', 'success');
  try {
    const { error } = await window.supabaseClient.functions.invoke('delete-account', { method: 'POST' });
    if (error) { _settingsMsg('Delete failed: ' + error.message, 'error'); return; }
    try { await window.supabaseClient.auth.signOut(); } catch (_) {}
    window.appSession = null; window.accountUser = null; window.driveConnected = false;
    closeSettings();
    showLoginScreen();
    if (typeof showToast === 'function') showToast('Your account has been deleted', 'success');
  } catch (e) {
    _settingsMsg('Delete failed: ' + String(e), 'error');
  }
}
