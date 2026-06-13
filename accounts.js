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

// Admin is role-based (profiles.is_admin), resolved at login into window.isAdminUser.
// The owner's Google email is always treated as admin (immediate, before lookup).
const ADMIN_EMAIL = 'denyfalcao008@gmail.com';
window.isAdminUser = false;
function isAdmin() {
  if (window.isAdminUser) return true;
  return currentSessionType() === 'google' &&
    ((window.driveUserInfo && window.driveUserInfo.email) || '').toLowerCase() === ADMIN_EMAIL;
}
function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
  const a = document.getElementById('adminScreen');
  if (l) l.style.display = 'flex';
  if (d) d.style.display = 'none';
  if (w) w.style.display = 'none';
  if (a) a.style.display = 'none';
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

  // Admin view only for the owner's Google account.
  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.style.display = isAdmin() ? '' : 'none';

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
  await logAccountProfile();
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
  await logAccountProfile();
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
  window.isAdminUser = false;
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
        await logAccountProfile();
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
    owner_email: (u.user && u.user.email) || null,
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
    owner_email: (window.appSession && window.appSession.email) || undefined,
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
  window.appSession = null; window.accountUser = null; window.driveConnected = false; window.isAdminUser = false;
  closeSettings();
  showLoginScreen();
  if (typeof showToast === 'function') showToast('Signed out on all devices', 'success');
}

function connectDriveFromSettings() {
  if (typeof connectDriveOnly === 'function') connectDriveOnly();
  else _settingsMsg('Drive connect is unavailable.', 'error');
}

// ─── Login logging into profiles ───────────────────────────────────────────
async function logAccountProfile() {
  try {
    const u = window.accountUser;
    if (!u || !u.email) return;
    await window.supabaseClient.from('profiles').upsert({
      email: u.email,
      display_name: (u.user_metadata && u.user_metadata.display_name) || null,
      provider: 'email', user_id: u.id, last_seen_at: new Date().toISOString(),
    }, { onConflict: 'email' });
    const { data } = await window.supabaseClient.from('profiles').select('is_admin').eq('email', u.email).maybeSingle();
    window.isAdminUser = !!(data && data.is_admin);
  } catch (_) { window.isAdminUser = false; }
}

async function trackGoogleLogin() {
  try {
    const res = await fetch(window.SUPABASE_URL + '/functions/v1/track-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'apikey': window.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY, 'x-google-token': window.accessToken || '',
      },
      body: JSON.stringify({ name: (window.driveUserInfo && window.driveUserInfo.name) || null }),
    });
    const b = await res.json().catch(() => ({}));
    window.isAdminUser = !!(b && b.is_admin);
  } catch (_) {}
  if (typeof updateDashboardChrome === 'function') updateDashboardChrome();
}

// ─── Admin API (owner / admins) ─────────────────────────────────────────────
async function adminCall(action, payload) {
  const headers = {
    'Content-Type': 'application/json', 'apikey': window.SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY,
  };
  if (currentSessionType() === 'google') {
    headers['x-google-token'] = window.accessToken || '';
  } else {
    try { const { data: s } = await window.supabaseClient.auth.getSession(); if (s && s.session) headers['Authorization'] = 'Bearer ' + s.session.access_token; } catch (_) {}
  }
  const res = await fetch(window.SUPABASE_URL + '/functions/v1/admin', { method: 'POST', headers, body: JSON.stringify({ action, ...(payload || {}) }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || ('Admin error ' + res.status));
  return body;
}

// ─── Admin page ─────────────────────────────────────────────────────────────
function showAdminScreen() {
  if (!isAdmin()) return;
  ['loginScreen', 'dashboardScreen', 'appWrapper'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
  const s = document.getElementById('adminScreen'); if (s) s.style.display = 'flex';
  adminShowTab('users');
  loadAdminUsers();
  loadAdminPlans();
}

function adminShowTab(which) {
  ['users', 'plans'].forEach(t => {
    const btn = document.getElementById('adminTab-' + t);
    const body = document.getElementById(t === 'users' ? 'adminUsersBody' : 'adminPlansBody');
    const on = (t === which);
    if (btn) {
      btn.style.background = on ? 'rgba(252,163,17,0.15)' : 'transparent';
      btn.style.color = on ? '#FCA311' : '#CBD2DE';
      btn.style.borderColor = on ? '#FCA311' : 'rgba(255,255,255,0.12)';
    }
    if (body) body.style.display = on ? '' : 'none';
  });
}

function loadAdminUsers() {
  const el = document.getElementById('adminUsersBody');
  if (el) el.innerHTML = '<div style="padding:30px;color:var(--text-muted);">Loading users…</div>';
  adminCall('list_users').then(r => renderAdminUsers(r.users || []))
    .catch(e => { if (el) el.innerHTML = `<div style="padding:24px;color:#FF453A;">${_esc(e.message)}</div>`; });
}

function loadAdminPlans() {
  const el = document.getElementById('adminPlansBody');
  if (el) el.innerHTML = '<div style="padding:30px;color:var(--text-muted);">Loading plans…</div>';
  adminCall('list_plans').then(r => renderAdminPlans(r.plans || []))
    .catch(e => { if (el) el.innerHTML = `<div style="padding:24px;color:#FF453A;">${_esc(e.message)}</div>`; });
}

function _adminDate(d) { try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return '—'; } }

function renderAdminUsers(users) {
  const el = document.getElementById('adminUsersBody');
  if (!el) return;
  const rows = (users || []).map(u => {
    const isEmail = u.provider === 'email';
    const e = _esc(u.email);
    return `<tr>
      <td>${e}</td>
      <td>${_esc(u.display_name || '—')}</td>
      <td><span class="platform-tag">${u.provider === 'google' ? '🔵 Google' : '✉️ Email'}</span></td>
      <td style="text-align:center;">${u.plan_count || 0}</td>
      <td style="text-align:center;">${u.is_admin ? '<span style="color:#FCA311;font-weight:700;">Admin</span>' : '<span style="color:var(--text-muted);">User</span>'}</td>
      <td style="color:var(--text-muted);white-space:nowrap;">${_adminDate(u.created_at)}</td>
      <td style="white-space:nowrap;display:flex;gap:6px;">
        <button class="btn btn-outline btn-sm" onclick="adminToggleAdmin('${e}', ${u.is_admin ? 'true' : 'false'})">${u.is_admin ? 'Remove admin' : 'Make admin'}</button>
        ${isEmail ? `<button class="btn btn-outline btn-sm" onclick="adminResetPassword('${e}')">Set password</button>` : ''}
        <button class="btn btn-sm" style="background:rgba(255,69,58,0.12);border:1px solid rgba(255,69,58,0.35);color:#FF453A;" onclick="adminRemoveUser('${e}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
  el.innerHTML = `<div style="overflow-x:auto;"><table class="budget-table" style="min-width:860px;">
    <thead><tr><th>Email</th><th>Name</th><th>Login</th><th>Plans</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No users yet.</td></tr>'}</tbody>
  </table></div>`;
}

function renderAdminPlans(plans) {
  const el = document.getElementById('adminPlansBody');
  if (!el) return;
  plans = plans || [];
  const users = new Set();
  let totalBudget = 0, totalSpent = 0, totalRows = 0, completeRows = 0;
  plans.forEach(p => {
    if (p.owner_email) users.add(p.owner_email);
    totalBudget += Number(p.total_budget || 0);
    const rows = ((p.data && p.data.planData && p.data.planData.rows) || []).filter(r => !r._isSubtotal);
    rows.forEach(r => { totalRows++; totalSpent += parseFloat(r.actualSpend) || 0; if (r.complete) completeRows++; });
  });
  const compPct = totalRows ? Math.round((completeRows / totalRows) * 100) : 0;
  const stats = [['Users', users.size], ['Plans', plans.length], ['Budget', fmtUSD(totalBudget)], ['Spent', fmtUSD(totalSpent)], ['Completion', compPct + '%']];
  const statCards = stats.map(s => `<div class="summary-card" style="--accent-color:var(--primary)"><div class="summary-label">${s[0]}</div><div class="summary-value">${s[1]}</div></div>`).join('');
  const rowsHtml = plans.map(p => {
    const rows = ((p.data && p.data.planData && p.data.planData.rows) || []).filter(r => !r._isSubtotal);
    let spent = 0, comp = 0;
    rows.forEach(r => { spent += parseFloat(r.actualSpend) || 0; if (r.complete) comp++; });
    const cpct = rows.length ? Math.round((comp / rows.length) * 100) : 0;
    const cd = (typeof COUNTRY_DATA !== 'undefined' && COUNTRY_DATA[p.country]) || {};
    return `<tr>
      <td>${_esc(p.owner_email || '—')}</td>
      <td>${_esc(p.campaign_name || 'Untitled')}</td>
      <td style="white-space:nowrap;">${cd.flag || ''} ${_esc(cd.name || p.country || '')}</td>
      <td style="text-align:right;">${fmtUSD(Number(p.total_budget || 0))}</td>
      <td style="text-align:right;">${fmtUSD(spent)}</td>
      <td style="text-align:center;">${cpct}%</td>
      <td style="color:var(--text-muted);white-space:nowrap;">${_formatSavedDate(p.updated_at || p.created_at)}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <div class="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3" style="margin-bottom:20px;">${statCards}</div>
    <div style="overflow-x:auto;"><table class="budget-table" style="min-width:720px;">
      <thead><tr><th>Owner</th><th>Campaign</th><th>Country</th><th>Budget</th><th>Spent</th><th>Done</th><th>Updated</th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">No plans yet.</td></tr>'}</tbody>
    </table></div>`;
}

function adminToggleAdmin(email, currently) {
  adminCall('set_admin', { email: email, isAdmin: !currently })
    .then(() => { showToast('✅ Role updated', 'success'); loadAdminUsers(); })
    .catch(e => showToast(e.message, 'error'));
}

function adminResetPassword(email) {
  const pw = prompt('Set a new password for ' + email + ' (min 6 characters):');
  if (!pw) return;
  if (pw.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
  adminCall('set_password', { email: email, password: pw })
    .then(() => showToast('✅ Password updated', 'success'))
    .catch(e => showToast(e.message, 'error'));
}

function adminRemoveUser(email) {
  if (!confirm('Delete ' + email + ' and all their plans? This cannot be undone.')) return;
  adminCall('delete_user', { email: email })
    .then(() => { showToast('🗑 User deleted', 'success'); loadAdminUsers(); loadAdminPlans(); })
    .catch(e => showToast(e.message, 'error'));
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
