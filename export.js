/**
 * export.js — Excel, CSV, and Google Drive export logic
 */

// ─── Excel Export ─────────────────────────────────────────────────────────────
function exportExcel() {
  if (!window.planData) { showToast('Generate a plan first', 'error'); return; }
  const { rows, grandTotalBudget, grandTotalActual, underspend, budgetOverall, zarGrandTotal } = window.planData;
  const state = window.appState;

  const wb = XLSX.utils.book_new();
  const sheetData = [];

  sheetData.push([state.campaignName || 'Campaign Budget Plan', '', '', '', '', '', '', '', '', '', '', '', '']);
  sheetData.push(['DATE', '', 'ACTIVATION', 'ASSET TYPE', 'PLATFORM', 'Country', 'RAND VALUE', 'DURATION', 'OBJECTIVE', 'COMPLETE', 'ACTUAL SPEND', 'DIFFERENCE', 'BUDGET']);

  for (const row of rows) {
    if (row._isSubtotal) {
      sheetData.push(['', '', '', '', '', '', '', '', '', '', '', '', fmtUSD(row.budget)]);
    } else {
      const actual = parseFloat(row.actualSpend) || 0;
      const diff = row.budget - actual;
      sheetData.push([
        row.date,
        row.day,
        row.activation,
        row.assetType,
        row.platform,
        row.country,
        fmtZAR(row.zarValue),
        row.duration,
        row.objective,
        row.complete ? 'TRUE' : 'FALSE',
        actual ? fmtUSD(actual) : '',
        actual ? fmtUSD(diff) : '',
        fmtUSD(row.budget),
      ]);
    }
  }

  sheetData.push(['', '', '', '', '', '', '', '', '', '', fmtUSD(grandTotalActual), '', '']);
  sheetData.push(['', '', '', '', '', fmtZAR(zarGrandTotal), '', '', 'GRAND TOTAL', '', '', '', fmtUSD(grandTotalBudget)]);
  sheetData.push(['', '', '', '', '', '', '', '', 'Underspend', '', '', '0', fmtUSD(underspend)]);
  sheetData.push(['', '', '', '', '', '', '', '', 'Budget overall', '', '', '', fmtUSD(budgetOverall)]);

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 10 },
    { wch: 14 }, { wch: 14 }, { wch: 14 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Budget Plan');
  const fileName = `${state.campaignName || 'Campaign'}_Budget_Plan.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(`✅ Downloaded ${fileName}`, 'success');
}

// ─── CSV Export ────────────────────────────────────────────────────────────────
function exportCSV() {
  if (!window.planData) { showToast('Generate a plan first', 'error'); return; }
  const { rows, grandTotalBudget, underspend, budgetOverall } = window.planData;
  const state = window.appState;

  const escape = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [];
  lines.push(escape(state.campaignName || 'Campaign Budget Plan'));
  lines.push(['DATE', 'DAY', 'ACTIVATION', 'ASSET TYPE', 'PLATFORM', 'COUNTRY', 'RAND VALUE', 'DURATION', 'OBJECTIVE', 'COMPLETE', 'ACTUAL SPEND', 'DIFFERENCE', 'BUDGET'].map(escape).join(','));

  for (const row of rows) {
    if (row._isSubtotal) {
      lines.push(['', '', '', '', '', '', '', '', '', '', '', '', fmtUSD(row.budget)].map(escape).join(','));
    } else {
      const actual = parseFloat(row.actualSpend) || 0;
      const diff = row.budget - actual;
      lines.push([
        row.date, row.day, row.activation, row.assetType, row.platform,
        row.country, fmtZAR(row.zarValue), row.duration, row.objective,
        row.complete ? 'TRUE' : 'FALSE',
        actual ? fmtUSD(actual) : '',
        actual ? fmtUSD(diff) : '',
        fmtUSD(row.budget),
      ].map(escape).join(','));
    }
  }

  lines.push(['', '', '', '', '', '', '', '', 'GRAND TOTAL', '', '', '', fmtUSD(grandTotalBudget)].map(escape).join(','));
  lines.push(['', '', '', '', '', '', '', '', 'Underspend', '', '', '0', fmtUSD(underspend)].map(escape).join(','));
  lines.push(['', '', '', '', '', '', '', '', 'Budget overall', '', '', '', fmtUSD(budgetOverall)].map(escape).join(','));

  const csvContent = lines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.campaignName || 'Campaign'}_Budget_Plan.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('✅ CSV downloaded', 'success');
}

// ─── Google Drive Modal ────────────────────────────────────────────────────────
function openGDriveModal() {
  document.getElementById('gdriveModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeGDriveModal(e) {
  if (e && e.target !== document.getElementById('gdriveModal')) return;
  document.getElementById('gdriveModal').classList.add('hidden');
  document.body.style.overflow = '';
}

// Quick option: download CSV then open sheets.new
function quickGSheetsExport() {
  exportCSV();
  setTimeout(() => {
    window.open('https://sheets.new', '_blank');
    showToast('📊 Google Sheets opened! Go to File → Import → Upload → select the CSV', 'success');
    closeGDriveModal();
  }, 600);
}

// ─── OAuth (full Google Drive) — loads APIs on demand ────────────────────────
let gapiReady = false;
let tokenClient = null;
let accessToken = null;
// Credentials come from config.js (baked in for everyone). localStorage is only
// a legacy fallback for anyone who previously pasted their own.
let oauthClientId = window.GOOGLE_CLIENT_ID || localStorage.getItem('fpro_client_id') || '';
let oauthApiKey   = window.GOOGLE_API_KEY   || localStorage.getItem('fpro_api_key')   || '';

// Tracks whether the in-flight token request was a silent (background) attempt,
// so the callback knows whether to fall back to an interactive consent prompt.
let signInMode    = 'auto';   // 'auto' = silent on load · 'interactive' = user clicked sign-in
let consentRetried = false;

// Helper: save credentials to localStorage
function saveCredentials(clientId, apiKey) {
  if (clientId) { oauthClientId = clientId; localStorage.setItem('fpro_client_id', clientId); }
  if (apiKey)   { oauthApiKey   = apiKey;   localStorage.setItem('fpro_api_key',   apiKey);   }
}

// Expose accessToken globally so plans.js can reference window.accessToken
Object.defineProperty(window, 'accessToken', {
  get: () => accessToken,
  set: (v) => { accessToken = v; },
  configurable: true,
});

// ─── Token cache ──────────────────────────────────────────────────────────────
// Google access tokens last ~1 hour. We cache the token (with its expiry) so a
// page refresh restores the session instantly — no popup, no re-consent. We do
// NOT open an OAuth popup on load, because popups not triggered by a user click
// are blocked by browsers.
const TOKEN_KEY = 'fpro_token';

function cacheToken(token, expiresInSec) {
  try {
    const expiresAt = Date.now() + (Number(expiresInSec || 3600) * 1000);
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt }));
  } catch (_) {}
}

function loadCachedToken() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw);
    // Require at least 2 minutes of remaining validity.
    if (token && expiresAt && expiresAt - Date.now() > 120000) return token;
    localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
  return null;
}

function clearCachedToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
}

// Restore a cached Google session if one is still valid. Returns true if a
// restore was kicked off, so the session coordinator (initSession in
// accounts.js) knows the Google flow will show the dashboard.
function restoreGoogleSessionIfCached() {
  if (!(oauthClientId && oauthApiKey)) return false;
  const cached = loadCachedToken();
  if (!cached) return false;
  accessToken = cached;
  loadGoogleAPIs(() => {
    initGapiClient(() => {
      initTokenClient();
      try { gapi.client.setToken({ access_token: accessToken }); } catch (_) {}
      finishSignIn();
    });
  });
  return true;
}

function connectGDriveOAuth() {
  // Credentials are baked in — reuse the one-click sign-in flow.
  startGoogleSignIn();
}

function loadGoogleAPIs(callback) {
  let scriptsLoaded = 0;
  const onLoad = () => { scriptsLoaded++; if (scriptsLoaded === 2) callback(); };

  if (!document.getElementById('gapi-script')) {
    const s1 = document.createElement('script');
    s1.id = 'gapi-script';
    s1.src = 'https://apis.google.com/js/api.js';
    s1.onload = onLoad;
    document.head.appendChild(s1);
  } else { onLoad(); }

  if (!document.getElementById('gsi-script')) {
    const s2 = document.createElement('script');
    s2.id = 'gsi-script';
    s2.src = 'https://accounts.google.com/gsi/client';
    s2.onload = onLoad;
    document.head.appendChild(s2);
  } else { onLoad(); }
}

function initGapiClient(callback) {
  gapi.load('client', async () => {
    try {
      await gapi.client.init({
        apiKey: oauthApiKey,
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
      });
      gapiReady = true;
      callback();
    } catch (e) {
      showToast('Failed to init Google API. Check your API Key.', 'error');
      console.error(e);
    }
  });
}

function initTokenClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: oauthClientId,
    scope: 'https://www.googleapis.com/auth/drive.file',
    callback: (tokenResponse) => {
      if (tokenResponse.error) {
        // A silent (auto) attempt that needs user interaction is normal on a
        // fresh browser — just stay on the login screen, no error shown.
        if (signInMode === 'auto') return;
        // Interactive attempt failed silently — retry once WITH a consent prompt.
        if (!consentRetried) {
          consentRetried = true;
          tokenClient.requestAccessToken({ prompt: 'consent' });
          return;
        }
        showToast('Google sign-in failed: ' + tokenResponse.error, 'error');
        return;
      }
      consentRetried = false;
      accessToken = tokenResponse.access_token;
      cacheToken(accessToken, tokenResponse.expires_in);
      try { gapi.client.setToken({ access_token: accessToken }); } catch (_) {}
      finishSignIn();
    },
  });
}

/**
 * Shared post-sign-in routine: update UI, fetch the user's profile, switch to
 * the dashboard, and load their saved plans. Called both after a fresh sign-in
 * and when restoring a cached token on page load.
 */
function finishSignIn() {
  if (typeof setSession === 'function') setSession('google', '');
  updateGDriveUI(true);
  closeGDriveModal();

  // showDashboard() loads the plans itself, so we just need the profile first.
  fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
    .then(r => r.json())
    .then(info => {
      window.driveUserInfo = info;
      if (info && info.email) showToast(`✅ Signed in as ${info.email}`, 'success');
      showDashboard();
    })
    .catch(() => { showDashboard(); });
}

function requestGoogleToken() {
  if (!tokenClient) { initTokenClient(); }
  signInMode = 'interactive';
  consentRetried = false;
  // Try silently first — if already granted and signed in, no popup appears.
  // The token callback automatically falls back to a consent prompt if needed.
  tokenClient.requestAccessToken({ prompt: '' });
}

function updateGDriveUI(loggedIn) {
  const loginBtn = document.getElementById('gdriveLoginBtn');
  const userEl   = document.getElementById('gdriveUser');
  if (loggedIn) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userEl) {
      userEl.classList.remove('hidden');
      userEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="#34D399"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#34D399" stroke-width="2"/></svg> Drive Connected`;
    }
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userEl)   userEl.classList.add('hidden');
  }
}

// ─── Login Screen Helpers ─────────────────────────────────────────────────────

/**
 * Called from the Login Screen "Sign in with Google" button.
 * Reads Client ID / API Key from the Drive modal inputs (if already entered),
 * then triggers the full Google OAuth flow.
 */
function startGoogleSignIn() {
  // Credentials are baked into config.js, so there is nothing to paste.
  if (!oauthClientId || !oauthApiKey) {
    showToast('Google sign-in is not configured (missing config.js).', 'error');
    return;
  }

  loadGoogleAPIs(() => {
    initGapiClient(() => {
      initTokenClient();
      requestGoogleToken();
    });
  });
}

/**
 * Sign the user out: revoke the Google token, clear all state,
 * and return to the login screen.
 */
function signOutGoogle() {
  if (typeof google !== 'undefined' && google?.accounts?.oauth2 && accessToken) {
    try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch (_) {}
  }
  accessToken = null;
  clearCachedToken();
  window.appSession = null;
  window.driveUserInfo = null;
  // Reset the Drive folder ID cache in plans.js
  if (typeof driveFolderId !== 'undefined') { driveFolderId = null; }

  const loginScreen     = document.getElementById('loginScreen');
  const dashboardScreen = document.getElementById('dashboardScreen');
  const appWrapper      = document.getElementById('appWrapper');
  if (loginScreen)     loginScreen.style.display     = 'flex';
  if (dashboardScreen) dashboardScreen.style.display  = 'none';
  if (appWrapper)      appWrapper.style.display       = 'none';

  updateGDriveUI(false);
  showToast('Signed out', 'success');
}

// ─── Save to Drive as Spreadsheet (manual export button) ─────────────────────
async function exportToGDrive() {
  if (!window.planData) { showToast('Generate a plan first', 'error'); return; }

  if (!accessToken) {
    openGDriveModal();
    return;
  }

  showToast('📤 Uploading to Google Drive...', 'success');

  const state = window.appState;
  const { rows, grandTotalBudget, underspend, budgetOverall } = window.planData;

  const escape = v => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const csvLines = [];
  csvLines.push(escape(state.campaignName || 'Campaign Budget Plan'));
  csvLines.push('DATE,DAY,ACTIVATION,ASSET TYPE,PLATFORM,COUNTRY,RAND VALUE,DURATION,OBJECTIVE,COMPLETE,ACTUAL SPEND,DIFFERENCE,BUDGET');

  for (const row of rows) {
    if (row._isSubtotal) {
      csvLines.push(`,,,,,,,,,,,,${fmtUSD(row.budget)}`);
    } else {
      const actual = parseFloat(row.actualSpend) || 0;
      const diff = row.budget - actual;
      csvLines.push([
        row.date, row.day, row.activation, row.assetType, row.platform,
        row.country, fmtZAR(row.zarValue), row.duration, row.objective,
        row.complete ? 'TRUE' : 'FALSE',
        actual ? fmtUSD(actual) : '',
        actual ? fmtUSD(diff) : '',
        fmtUSD(row.budget),
      ].map(escape).join(','));
    }
  }
  csvLines.push(`,,,,,,,,GRAND TOTAL,,,,${fmtUSD(grandTotalBudget)}`);
  csvLines.push(`,,,,,,,,Underspend,,,0,${fmtUSD(underspend)}`);
  csvLines.push(`,,,,,,,,Budget overall,,,,${fmtUSD(budgetOverall)}`);

  const csvContent = csvLines.join('\n');
  const fileName = `${state.campaignName || 'Campaign'}_Budget_Plan`;

  try {
    const metadata = {
      name: fileName,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([csvContent], { type: 'text/csv' }));

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Upload failed');
    }

    const file = await res.json();
    showToast('✅ Saved to Google Drive! Opening...', 'success');
    setTimeout(() => window.open(file.webViewLink, '_blank'), 800);
  } catch (err) {
    console.error(err);
    showToast('Drive upload failed: ' + err.message, 'error');
  }
}
