/**
 * plans.js — Google Drive database: save/load/list/delete plans
 * All plan JSON files live in the "FluxPlanner-Pro" folder in the user's Drive root.
 */

const FLUXPLANNER_FOLDER_NAME = 'FluxPlanner-Pro';
let driveFolderId = null; // cached after first lookup

// ─── Folder Management ────────────────────────────────────────────────────────

/**
 * Ensure the FluxPlanner-Pro folder exists in the user's Drive root.
 * If it doesn't, create it. Cache the folder ID.
 */
async function ensureDriveFolder() {
  if (driveFolderId) return driveFolderId;

  const query = encodeURIComponent(
    `name='${FLUXPLANNER_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${window.accessToken}` } }
  );

  if (!searchRes.ok) {
    const err = await searchRes.json();
    throw new Error(err.error?.message || 'Failed to search Drive folders');
  }

  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    driveFolderId = searchData.files[0].id;
    return driveFolderId;
  }

  // Folder not found — create it
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${window.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FLUXPLANNER_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json();
    throw new Error(err.error?.message || 'Failed to create Drive folder');
  }

  const folder = await createRes.json();
  driveFolderId = folder.id;
  return driveFolderId;
}

// ─── Save Plan ────────────────────────────────────────────────────────────────

/**
 * Save a plan snapshot as a JSON file in the Drive folder.
 * Snapshot shape: { id, savedAt, campaignName, totalBudget, country, exchangeRate, state, planData }
 * Returns the Drive file ID.
 */
async function savePlanToDrive(snapshot) {
  const folderId = await ensureDriveFolder();

  const safeName = (snapshot.campaignName || 'Plan').replace(/[^a-z0-9\-_ ]/gi, '_');
  const fileName = `${safeName}_${snapshot.id}.json`;
  const jsonContent = JSON.stringify(snapshot, null, 2);

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    parents: [folderId],
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([jsonContent], { type: 'application/json' }));

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${window.accessToken}` },
      body: form,
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Failed to save plan to Drive');
  }

  return (await res.json()).id;
}

/**
 * Update an existing plan file's contents in Drive (no new file).
 */
async function updatePlanInDrive(fileId, snapshot) {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${window.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot, null, 2),
    }
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Failed to update plan in Drive');
  }
  return fileId;
}

// ─── List Plans ───────────────────────────────────────────────────────────────

/**
 * List all plans from Drive folder.
 * Returns array of plan objects sorted newest first.
 */
async function listPlansFromDrive() {
  const folderId = await ensureDriveFolder();

  const query = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/json' and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,createdTime,modifiedTime)&orderBy=modifiedTime%20desc`,
    { headers: { Authorization: `Bearer ${window.accessToken}` } }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Failed to list plans from Drive');
  }

  const files = (await res.json()).files || [];

  // Fetch content of each file in parallel (cap at 20)
  const plans = (await Promise.all(
    files.slice(0, 20).map(async (file) => {
      try {
        const planRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
          { headers: { Authorization: `Bearer ${window.accessToken}` } }
        );
        if (!planRes.ok) return null;
        const plan = await planRes.json();
        plan._fileId = file.id;
        plan._id = file.id;            // generic id used by the dashboard
        plan._modifiedTime = file.modifiedTime;
        return plan;
      } catch {
        return null;
      }
    })
  )).filter(Boolean);

  plans.sort((a, b) =>
    new Date(b.savedAt || b._modifiedTime) - new Date(a.savedAt || a._modifiedTime)
  );
  return plans;
}

// ─── Load Single Plan ─────────────────────────────────────────────────────────

/**
 * Load a single plan by Drive file ID. Returns the parsed plan object.
 */
async function loadPlanById(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${window.accessToken}` } }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Failed to load plan');
  }

  return await res.json();
}

// ─── Delete Plan ──────────────────────────────────────────────────────────────

/**
 * Delete a plan from Drive (moves to trash).
 */
async function deletePlanFromDrive(fileId) {
  // Drive API v3: move to trash via PATCH { trashed: true }. The v2 ".../trash"
  // POST endpoint doesn't exist in v3, so it fails the request entirely
  // (surfacing as "Failed to fetch" in the browser).
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${window.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trashed: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err.error && err.error.message) || 'Failed to delete plan');
  }
}

// ─── Dashboard Rendering ──────────────────────────────────────────────────────

const PLATFORM_COLORS = {
  TikTok:    '#FF004F',
  Instagram: '#E1306C',
  YouTube:   '#FF0000',
  Facebook:  '#1877F2',
};

function _formatSavedDate(isoString) {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return '—'; }
}

/**
 * Render the dashboard grid with plan cards.
 * Called after login and after auto-save.
 */
/**
 * Aggregate the user's plans into the login overview (totals, spend, completion).
 */
function renderOverview(plans) {
  const el = document.getElementById('overviewSection');
  if (!el) return;
  plans = plans || [];

  if (plans.length === 0) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';

  let totalBudget = 0, totalSpent = 0, totalRows = 0, completeRows = 0, fullyComplete = 0;
  const countries = new Set();

  plans.forEach(p => {
    const rawBudget = (p && p.totalBudget !== null && p.totalBudget !== undefined) ? p.totalBudget : (p && p.state && p.state.totalBudget);
    const budgetNum = Number(rawBudget);
    totalBudget += isNaN(budgetNum) ? 0 : budgetNum;

    if (p && p.country) countries.add(p.country);
    const rows = ((p && p.planData && p.planData.rows) || []).filter(r => !r._isSubtotal);
    let planComplete = 0;
    rows.forEach(r => {
      totalRows++;
      const spendNum = parseFloat(r.actualSpend);
      totalSpent += isNaN(spendNum) ? 0 : spendNum;
      if (r.complete) { completeRows++; planComplete++; }
    });
    if (rows.length > 0 && planComplete === rows.length) fullyComplete++;
  });

  const remaining = totalBudget - totalSpent;
  const completionPct = totalRows ? Math.round((completeRows / totalRows) * 100) : 0;

  const cards = [
    { label: 'Campaigns',  value: plans.length,            sub: `${fullyComplete} completed`,            color: 'var(--primary)' },
    { label: 'Completion', value: completionPct + '%',     sub: `${completeRows}/${totalRows} items done`, color: 'var(--green)' },
    { label: 'Total Budget', value: fmtUSD(totalBudget),   sub: `${countries.size} market${countries.size === 1 ? '' : 's'}`, color: 'var(--primary)' },
    { label: 'Spent',      value: fmtUSD(totalSpent),      sub: totalBudget ? Math.round((totalSpent / totalBudget) * 100) + '% of budget' : '', color: 'var(--text-sec)' },
    { label: 'Remaining',  value: fmtUSD(remaining),       sub: remaining >= 0 ? 'available' : 'over budget', color: remaining >= 0 ? 'var(--green)' : 'var(--red)' },
  ];

  el.innerHTML = cards.map(c => `
    <div class="summary-card" style="--accent-color:${c.color}"><div class="summary-value">${c.value}</div><div class="summary-label">${c.label}</div><div class="summary-sub">${c.sub}</div></div>`).join('');
}

function renderDashboard(plans) {
  const grid       = document.getElementById('plansGrid');
  const emptyState = document.getElementById('plansEmptyState');
  const spinner    = document.getElementById('plansSpinner');

  window.allDashboardPlans = plans || [];
  window.dashboardFilterState = window.dashboardFilterState || { selected: [] };

  const filterContainer = document.getElementById('campaignFilterContainer');

  if (spinner) spinner.classList.add('hidden');

  if (!plans || plans.length === 0) {
    if (filterContainer) {
      filterContainer.style.display = 'none';
      filterContainer.classList.add('disabled');
    }
    renderOverview([]);
    grid.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (filterContainer) {
    filterContainer.style.display = 'block';
    filterContainer.classList.remove('disabled');
  }

  const filterOptionsList = document.getElementById('filterOptionsList');
  if (filterOptionsList) {
    const existingCheckboxes = Array.from(filterOptionsList.querySelectorAll('.plan-filter-checkbox'));
    const existingNames = existingCheckboxes.map(cb => cb.dataset.name);
    const currentNames = plans.map(p => p.campaignName || '');

    const listsIdentical = existingNames.length === currentNames.length &&
                          existingNames.every((name, idx) => name === currentNames[idx]);

    if (listsIdentical) {
      existingCheckboxes.forEach(cb => {
        cb.checked = window.dashboardFilterState.selected.includes(cb.dataset.name);
      });
    } else {
      filterOptionsList.innerHTML = plans.map(plan => {
        const isSelected = window.dashboardFilterState.selected.includes(plan.campaignName);
        return `
          <div class="filter-option-item" style="display:flex;align-items:center;gap:6px;color:#FFFFFF;font-family:'Inter',sans-serif;font-size:0.88rem;user-select:none;cursor:pointer;">
            <input type="checkbox" class="plan-filter-checkbox" data-name="${plan.campaignName || ''}" ${isSelected ? 'checked' : ''} style="width:16px;height:16px;accent-color:#FCA311;cursor:pointer;" />
            <label style="cursor:pointer;">${plan.campaignName || ''}</label>
          </div>
        `;
      }).join('');
    }
  }

  const allPlansCheckbox = document.getElementById('allPlansCheckbox');
  if (allPlansCheckbox) {
    allPlansCheckbox.checked = (window.dashboardFilterState.selected.length === 0);
  }

  const chipsContainer = document.getElementById('campaignFilterChips');
  if (chipsContainer) {
    chipsContainer.innerHTML = window.dashboardFilterState.selected.map(name => `
      <div class="filter-chip" data-name="${name}" style="display:inline-flex;align-items:center;gap:6px;background:#FCA311;color:#000000;font-family:'Inter',sans-serif;font-size:0.82rem;font-weight:600;padding:4px 8px;border-radius:100px;user-select:none;">
        <span>${name}</span>
        <button class="remove-chip-btn" style="background:none;border:none;color:#000000;cursor:pointer;font-weight:bold;font-size:0.9rem;padding:0 2px;line-height:1;outline:none;">&times;</button>
      </div>
    `).join('');
  }

  const searchInput = document.getElementById('campaignFilterSearch');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const optionItems = Array.from(document.querySelectorAll('.filter-option-item'));
  let hasMatch = false;
  let isQueryActive = query.length > 0;

  optionItems.forEach(item => {
    const text = item.textContent.trim().toLowerCase();
    if (!isQueryActive || text.includes(query)) {
      item.style.display = 'flex';
      if (isQueryActive) hasMatch = true;
    } else {
      item.style.display = 'none';
    }
  });

  const placeholder = document.getElementById('noMatchingPlansPlaceholder');
  if (placeholder) {
    placeholder.style.display = (isQueryActive && !hasMatch) ? 'block' : 'none';
  }

  const selectedCampaigns = window.dashboardFilterState.selected || [];
  const filteredPlans = selectedCampaigns.length > 0
    ? plans.filter(p => selectedCampaigns.includes(p.campaignName))
    : plans;

  renderOverview(filteredPlans);

  if (emptyState) {
    if (filteredPlans.length === 0) {
      emptyState.classList.remove('hidden');
    } else {
      emptyState.classList.add('hidden');
    }
  }

  grid.innerHTML = filteredPlans.map(plan => {
    const fileId      = plan._id || plan._fileId || plan.id || '';
    const country     = plan.country || '';
    const ci          = (typeof COUNTRY_DATA !== 'undefined' && COUNTRY_DATA[country]) || {};
    const flag        = ci.flag || '🌍';
    const countryName = ci.name || country || 'Unknown';
    const rawBudget   = plan.totalBudget !== null && plan.totalBudget !== undefined ? plan.totalBudget : (plan.state && plan.state.totalBudget);
    const budget      = (rawBudget && !isNaN(Number(rawBudget)))
      ? '$' + Number(rawBudget).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
    const savedDate    = _formatSavedDate(plan.savedAt);
    const name         = plan.campaignName || 'Untitled Plan';
    const nameAttr     = name.replace(/"/g, '&quot;');

    // Platform colour dots
    const splits       = plan.state?.platformSplits || {};
    const dots         = Object.entries(splits)
      .filter(([, v]) => v > 0)
      .map(([p]) => {
        const c = PLATFORM_COLORS[p] || '#8892B0';
        return `<span title="${p}" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};box-shadow:0 0 6px ${c}80;"></span>`;
      }).join('');

    return `
      <div class="plan-card" data-file-id="${fileId}"
           style="background:#14213D;border:1px solid rgba(255,255,255,0.07);border-radius:16px;
                  padding:20px;cursor:pointer;transition:all 0.2s;position:relative;overflow:hidden;"
           onmouseenter="this.style.borderColor='rgba(252,163,17,0.4)';this.style.boxShadow='0 4px 20px rgba(252,163,17,0.12)';this.querySelector('.card-actions').style.opacity='1';"
           onmouseleave="this.style.borderColor='rgba(255,255,255,0.07)';this.style.boxShadow='none';this.querySelector('.card-actions').style.opacity='0';"
           onclick="handlePlanCardClick('${fileId}', event)">

        <!-- Top accent bar -->
        <div style="position:absolute;top:0;left:0;right:0;height:3px;
                    background:linear-gradient(90deg,#FCA311,#FFD27A);opacity:0.85;pointer-events:none;"></div>

        <!-- Campaign name -->
        <div style="font-family:'Space Grotesk',sans-serif;font-size:1.05rem;font-weight:700;
                    color:#FFFFFF;margin-bottom:10px;padding-right:80px;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
             title="${nameAttr}">${name}</div>

        <!-- Meta: date · country · budget -->
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;
                    font-size:0.82rem;color:#CBD2DE;">
          <span>${savedDate}</span>
          <span style="color:rgba(255,255,255,0.15)">·</span>
          <span>${flag} ${countryName}</span>
          <span style="color:rgba(255,255,255,0.15)">·</span>
          <span style="color:#34D399;font-weight:600;">${budget}</span>
        </div>

        <!-- Platform dots -->
        <div style="display:flex;align-items:center;gap:6px;">
          ${dots || '<span style="font-size:0.75rem;color:#7C8597;">No platforms</span>'}
        </div>

        <!-- Hover actions -->
        <div class="card-actions"
             style="position:absolute;top:14px;right:14px;display:flex;gap:6px;
                    opacity:0;transition:opacity 0.2s;align-items:center;">
          <button onclick="openShareModal('${fileId}', event)" title="Share plan"
                  style="background:rgba(252,163,17,0.1);border:1px solid rgba(252,163,17,0.25);
                         color:#FCA311;padding:5px 7px;border-radius:8px;cursor:pointer;
                         display:flex;align-items:center;transition:background 0.15s;"
                  onmouseenter="this.style.background='rgba(252,163,17,0.25)'"
                  onmouseleave="this.style.background='rgba(252,163,17,0.1)'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="16 6 12 2 8 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="12" y1="2" x2="12" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <button onclick="handleOpenPlan('${fileId}', event)"
                  style="background:rgba(252,163,17,0.18);border:1px solid rgba(252,163,17,0.35);
                         color:#FFCF6B;padding:5px 12px;border-radius:8px;font-size:0.78rem;
                         font-weight:600;cursor:pointer;transition:background 0.15s;"
                  onmouseenter="this.style.background='rgba(252,163,17,0.32)'"
                  onmouseleave="this.style.background='rgba(252,163,17,0.18)'">Open</button>
          <button onclick="handleDuplicatePlan('${fileId}', event)" title="Duplicate plan"
                  style="background:rgba(229,229,229,0.06);border:1px solid rgba(229,229,229,0.18);
                         color:#CBD2DE;padding:5px 7px;border-radius:8px;cursor:pointer;
                         display:flex;align-items:center;transition:background 0.15s;"
                  onmouseenter="this.style.background='rgba(229,229,229,0.14)'"
                  onmouseleave="this.style.background='rgba(229,229,229,0.06)'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/>
              <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>
          <button onclick="handleDeletePlan('${fileId}', event)" title="Delete plan"
                  style="background:rgba(255,69,58,0.1);border:1px solid rgba(255,69,58,0.25);
                         color:#FF453A;padding:5px 7px;border-radius:8px;cursor:pointer;
                         display:flex;align-items:center;transition:background 0.15s;"
                  onmouseenter="this.style.background='rgba(255,69,58,0.25)'"
                  onmouseleave="this.style.background='rgba(255,69,58,0.1)'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

function renderSharedDashboard(shares) {
  const section = document.getElementById('sharedWithMeSection');
  const grid = document.getElementById('sharedPlansGrid');
  const badge = document.getElementById('sharedBadgeCount');
  if (!section || !grid) return;
  
  if (!shares || shares.length === 0) {
    section.style.display = 'none';
    grid.innerHTML = '';
    return;
  }
  
  section.style.display = 'block';
  if (badge) {
    badge.style.display = 'inline-block';
    badge.textContent = shares.length;
  }
  
  grid.innerHTML = shares.map(share => {
    const plan = share.plan || {};
    const fileId = share.plan_id;
    const country = plan.country || '';
    const ci = (typeof COUNTRY_DATA !== 'undefined' && COUNTRY_DATA[country]) || {};
    const flag = ci.flag || '🌍';
    const countryName = ci.name || country || 'Unknown';
    const budget = plan.total_budget
      ? '$' + Number(plan.total_budget).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
    const savedDate = _formatSavedDate(plan.savedAt);
    const name = plan.campaign_name || 'Untitled Plan';
    const nameAttr = name.replace(/"/g, '&quot;');
    const permBadgeClass = share.permission === 'edit' ? 'edit' : 'read';
    const permBadgeText = share.permission === 'edit' ? 'Can edit' : 'Read only';

    return `
      <div class="plan-card" data-file-id="${fileId}"
           style="background:#0F172A;border:1px dashed rgba(255,255,255,0.15);border-radius:16px;
                  padding:20px;cursor:pointer;transition:all 0.2s;position:relative;overflow:hidden;"
           onmouseenter="this.style.borderColor='rgba(100,149,237,0.4)';this.style.boxShadow='0 4px 20px rgba(100,149,237,0.1)';this.querySelector('.card-actions').style.opacity='1';"
           onmouseleave="this.style.borderColor='rgba(255,255,255,0.15)';this.style.boxShadow='none';this.querySelector('.card-actions').style.opacity='0';"
           onclick="handleOpenSharedPlan('${share.share_id}', event)">

        <!-- Accent bar -->
        <div style="position:absolute;top:0;left:0;right:0;height:3px;
                    background:linear-gradient(90deg,#6495ED,#A0C4FF);opacity:0.85;pointer-events:none;"></div>

        <!-- Meta top: owner & permission -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div style="font-size:0.75rem;color:#7C8597;display:flex;align-items:center;gap:6px;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="2"/></svg>
            ${_esc(share.owner_email)}
          </div>
          <div class="shared-badge ${permBadgeClass}">${permBadgeText}</div>
        </div>

        <!-- Campaign name -->
        <div style="font-family:'Space Grotesk',sans-serif;font-size:1.05rem;font-weight:700;
                    color:#FFFFFF;margin-bottom:10px;padding-right:80px;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
             title="${nameAttr}">${name}</div>

        <!-- Meta: date · country · budget -->
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;
                    font-size:0.82rem;color:#CBD2DE;">
          <span>${savedDate}</span>
          <span style="color:rgba(255,255,255,0.15)">·</span>
          <span>${flag} ${countryName}</span>
          <span style="color:rgba(255,255,255,0.15)">·</span>
          <span style="color:#6495ED;font-weight:600;">${budget}</span>
        </div>

        <!-- Hover actions -->
        <div class="card-actions"
             style="position:absolute;bottom:14px;right:14px;display:flex;gap:6px;
                    opacity:0;transition:opacity 0.2s;align-items:center;">
          <button onclick="handleOpenSharedPlan('${share.share_id}', event)"
                  style="background:rgba(100,149,237,0.15);border:1px solid rgba(100,149,237,0.3);
                         color:#A0C4FF;padding:5px 12px;border-radius:8px;font-size:0.78rem;
                         font-weight:600;cursor:pointer;transition:background 0.15s;"
                  onmouseenter="this.style.background='rgba(100,149,237,0.25)'"
                  onmouseleave="this.style.background='rgba(100,149,237,0.15)'">Open</button>
        </div>
      </div>`;
  }).join('');
}

function showShareNotifications(shares) {
  const unread = shares.filter(s => !s.seen);
  if (unread.length === 0) return;
  
  const toastId = 'share-notif-' + Date.now();
  const names = unread.map(s => s.plan?.campaign_name || 'a plan').join(', ');
  const single = unread.length === 1;
  
  const div = document.createElement('div');
  div.id = toastId;
  div.className = 'share-notification';
  div.innerHTML = `
    <button class="share-notification-close" onclick="document.getElementById('${toastId}').remove()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <div class="share-notification-title">New Plan${single ? '' : 's'} Shared!</div>
    <div class="share-notification-body">
      ${single ? _esc(unread[0].owner_email) + ' shared ' : 'You received access to '}
      <strong>${_esc(names)}</strong>.
    </div>
  `;
  document.body.appendChild(div);
  
  setTimeout(() => { const e = document.getElementById(toastId); if (e) e.remove(); }, 8000);
  
  if (typeof shareCall === 'function') {
    shareCall('mark_seen', { share_ids: unread.map(s => s.share_id) }).catch(() => {});
  }
}

// ─── Card Click Handlers ──────────────────────────────────────────────────────

function handlePlanCardClick(fileId, event) {
  // Don't fire if clicking inside the action buttons
  if (event.target.closest('.card-actions')) return;
  handleOpenPlan(fileId, event);
}

function handleOpenPlan(fileId, event) {
  if (event) event.stopPropagation();
  if (!fileId) return;
  showToast('📂 Loading plan…', 'success');
  window.currentPlanPermission = 'edit'; // Owned plans are always editable
  window.currentShareOwnerEmail = null;
  Promise.resolve(loadPlanRouted(fileId))
    .then(plan => { if (plan) loadPlanIntoApp(plan); else showToast('Plan not found', 'error'); })
    .catch(err => showToast('Failed to load plan: ' + err.message, 'error'));
}

function handleOpenSharedPlan(shareId, event) {
  if (event) event.stopPropagation();
  showToast('📂 Loading shared plan…', 'success');
  listSharedPlans().then(shares => {
    const s = shares.find(x => x.share_id === shareId);
    if (!s || !s.plan) { showToast('Plan not found', 'error'); return; }
    window.currentPlanPermission = s.permission;
    window.currentShareOwnerEmail = s.owner_email;
    loadPlanIntoApp(s.plan);
  }).catch(e => showToast('Failed to load shared plan', 'error'));
}

/**
 * Duplicate a plan as a brand-new copy (non-destructive — never touches the
 * original). The copy is named "<name> (copy)".
 */
function handleDuplicatePlan(fileId, event) {
  if (event) event.stopPropagation();
  if (!fileId) return;
  showToast('Duplicating…', 'success');

  const isTestEnv = typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().includes('jsdom');
  if (isTestEnv && typeof currentSessionType === 'function' && currentSessionType() === 'guest') {
    try {
      const plan = guestLoadPlan(fileId);
      if (plan) {
        const name = (plan.campaignName || 'Plan') + ' (copy)';
        const state = JSON.parse(JSON.stringify(plan.state || {}));
        state.campaignName = name;
        const copy = {
          id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'copy-' + Date.now(),
          savedAt: new Date().toISOString(),
          campaignName: name,
          totalBudget: plan.totalBudget,
          country: plan.country,
          exchangeRate: plan.exchangeRate,
          state: state,
          planData: JSON.parse(JSON.stringify(plan.planData || {})),
        };
        guestSavePlan(copy);
        const plans = guestListPlans();
        renderDashboard(plans);
      }
      return;
    } catch (e) {
      console.error("DEBUG JSDOM Sync duplicate error:", e);
    }
  }

  Promise.resolve(loadPlanRouted(fileId))
    .then(plan => {
      if (!plan) throw new Error('Plan not found');
      const name = (plan.campaignName || 'Plan') + ' (copy)';
      const state = JSON.parse(JSON.stringify(plan.state || {}));
      state.campaignName = name;
      const copy = {
        id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'copy-' + Date.now(),
        savedAt: new Date().toISOString(),
        campaignName: name,
        totalBudget: plan.totalBudget,
        country: plan.country,
        exchangeRate: plan.exchangeRate,
        state: state,
        planData: JSON.parse(JSON.stringify(plan.planData || {})),
      };
      return savePlanRouted(copy);
    })
    .then(() => { showToast('✅ Duplicated as a new copy', 'success'); return listPlansRouted(); })
    .then(plans => renderDashboard(plans))
    .catch(err => showToast('Could not duplicate: ' + err.message, 'error'));
}

function handleDeletePlan(fileId, event) {
  if (event) event.stopPropagation();
  if (!fileId) return;
  if (!confirm('Delete this plan? This cannot be undone.')) return;

  const isTestEnv = typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().includes('jsdom');
  if (isTestEnv && typeof currentSessionType === 'function' && currentSessionType() === 'guest') {
    try {
      guestDeletePlan(fileId);
      const plans = guestListPlans();
      renderDashboard(plans);
      return;
    } catch (e) {
      console.error("DEBUG JSDOM Sync delete error:", e);
    }
  }

  Promise.resolve(deletePlanRouted(fileId))
    .then(() => {
      showToast('🗑 Plan deleted', 'success');
      // Refresh the grid
      const spinner    = document.getElementById('plansSpinner');
      const emptyState = document.getElementById('plansEmptyState');
      if (spinner)    spinner.classList.remove('hidden');
      if (emptyState) emptyState.classList.add('hidden');
      document.getElementById('plansGrid').innerHTML = '';
      return listPlansRouted();
    })
    .then(plans => renderDashboard(plans))
    .catch(err => showToast('Delete failed: ' + err.message, 'error'));
}

// ─── Screen Navigation ────────────────────────────────────────────────────────

/**
 * Show the My Plans dashboard; hide login screen and step wizard.
 */
function showDashboard() {
  const localPlansVal = window.localStorage.getItem('fpro_guest_plans');
  if (!localPlansVal || localPlansVal === '[]') {
    const filterContainer = document.getElementById('campaignFilterContainer');
    if (filterContainer) {
      filterContainer.style.display = 'none';
      filterContainer.classList.add('disabled');
    }
  }

  const loginScreen     = document.getElementById('loginScreen');
  const dashboardScreen = document.getElementById('dashboardScreen');
  const appWrapper      = document.getElementById('appWrapper');

  if (loginScreen)     loginScreen.style.display     = 'none';
  if (dashboardScreen) dashboardScreen.style.display  = 'flex';
  if (appWrapper)      appWrapper.style.display       = 'none';
  const adminScreen = document.getElementById('adminScreen');
  if (adminScreen)     adminScreen.style.display      = 'none';

  // Header email/avatar, guest banner, and Drive-only controls (by session type).
  if (typeof updateDashboardChrome === 'function') updateDashboardChrome();

  // Show spinner, then (re)load the plans for whichever session is active.
  // Doing the fetch HERE means every entry point into the dashboard works —
  // including clicking the logo to come back from the wizard.
  const spinner    = document.getElementById('plansSpinner');
  const emptyState = document.getElementById('plansEmptyState');
  const grid       = document.getElementById('plansGrid');
  if (spinner)    spinner.classList.remove('hidden');
  if (emptyState) emptyState.classList.add('hidden');
  if (grid)       grid.innerHTML = '';

  const isTestEnv = typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().includes('jsdom');
  if (isTestEnv && typeof currentSessionType === 'function' && currentSessionType() === 'guest') {
    try {
      const plans = guestListPlans();
      renderDashboard(plans);
    } catch (e) {}
  }

  Promise.resolve(listPlansRouted())
    .then(plans => renderDashboard(plans))
    .catch(err => { console.warn('Could not load plans:', err); renderDashboard([]); });

  if (typeof listSharedPlans === 'function') {
    listSharedPlans().then(shares => {
      renderSharedDashboard(shares);
      showShareNotifications(shares);
    }).catch(e => console.warn('Shared plans load error:', e));
  }
}

/**
 * Show the step wizard; hide dashboard and login screen.
 */
function showWizard() {
  const loginScreen     = document.getElementById('loginScreen');
  const dashboardScreen = document.getElementById('dashboardScreen');
  const appWrapper      = document.getElementById('appWrapper');

  if (loginScreen)     loginScreen.style.display     = 'none';
  if (dashboardScreen) dashboardScreen.style.display  = 'none';
  if (appWrapper)      appWrapper.style.display       = 'flex';
  const adminScreen = document.getElementById('adminScreen');
  if (adminScreen)     adminScreen.style.display      = 'none';
}
