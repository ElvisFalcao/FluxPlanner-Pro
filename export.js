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
// Load saved credentials from localStorage (persists across page refreshes)
let oauthClientId = localStorage.getItem('fpro_client_id') || '';
let oauthApiKey   = localStorage.getItem('fpro_api_key')   || '';

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

// Auto-sign-in if credentials already saved
window.addEventListener('DOMContentLoaded', () => {
  if (oauthClientId && oauthApiKey) {
    // Pre-fill modal inputs so connectGDriveOAuth also works
    const mid = document.getElementById('oauthClientId');
    const mak = document.getElementById('oauthApiKey');
    if (mid) mid.value = oauthClientId;
    if (mak) mak.value = oauthApiKey;
    // Trigger sign-in automatically — skips the credential prompt
    loadGoogleAPIs(() => {
      initGapiClient(() => {
        initTokenClient();
        // Use silent token request (no consent prompt if already granted)
        tokenClient.requestAccessToken({ prompt: '' });
      });
    });
  }
});

function connectGDriveOAuth() {
  const clientIdInput = document.getElementById('oauthClientId').value.trim();
  const apiKeyInput   = document.getElementById('oauthApiKey').value.trim();

  if (!clientIdInput) { showToast('Paste your Google OAuth Client ID first', 'error'); return; }
  if (!apiKeyInput)   { showToast('Paste your Google API Key first', 'error'); return; }

  saveCredentials(clientIdInput, apiKeyInput); // persist to localStorage

  loadGoogleAPIs(() => {
    initGapiClient(() => {
      initTokenClient();
      requestGoogleToken();
    });
  });
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
        showToast('Google sign-in failed: ' + tokenResponse.error, 'error');
        return;
      }
      accessToken = tokenResponse.access_token;
      gapi.client.setToken({ access_token: accessToken });
      updateGDriveUI(true);
      closeGDriveModal();

      // Fetch user profile then transition to the My Plans dashboard
      fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
        .then(r => r.json())
        .then(info => {
          window.driveUserInfo = info;
          showToast(`✅ Signed in as ${info.email || 'Google User'}`, 'success');
          showDashboard();
          listPlansFromDrive()
            .then(plans => renderDashboard(plans))
            .catch(err => { console.warn('Could not load plans:', err); renderDashboard([]); });
        })
        .catch(() => {
          showToast('✅ Connected to Google Drive!', 'success');
          showDashboard();
          listPlansFromDrive()
            .then(plans => renderDashboard(plans))
            .catch(() => renderDashboard([]));
        });
    },
  });
}

function requestGoogleToken() {
  if (!tokenClient) { initTokenClient(); }
  tokenClient.requestAccessToken({ prompt: 'consent' });
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
  // Read from login screen inputs first (loginClientId / loginApiKey)
  const loginClientEl = document.getElementById('loginClientId');
  const loginApiEl    = document.getElementById('loginApiKey');
  const modalClientEl = document.getElementById('oauthClientId');
  const modalApiEl    = document.getElementById('oauthApiKey');

  // Pick whichever input has a value
  const clientId = (loginClientEl && loginClientEl.value.trim()) ||
                   (modalClientEl && modalClientEl.value.trim()) || '';
  const apiKey   = (loginApiEl   && loginApiEl.value.trim())    ||
                   (modalApiEl   && modalApiEl.value.trim())    || '';

  saveCredentials(clientId, apiKey); // persist to localStorage

  // Sync back to modal inputs so connectGDriveOAuth also works
  if (modalClientEl && clientId) modalClientEl.value = clientId;
  if (modalApiEl   && apiKey)   modalApiEl.value   = apiKey;

  if (!oauthClientId) {
    // No credentials yet — expand the credentials section
    const credFields = document.getElementById('credFields');
    if (credFields) credFields.style.display = 'block';
    showToast('Please enter your OAuth Client ID above first', 'error');
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
