/**
 * app.js — Main application logic, state management, UI rendering
 */

// ─── App State ─────────────────────────────────────────────────────────────────
window.appState = {
  currentStep: 1,
  campaignName: '',
  country: '',
  totalBudget: 0,
  exchangeRate: 18.5,
  objective: 'Video Views',
  activations: [],
  platformSplits: { TikTok: 25, Instagram: 25, YouTube: 25, Facebook: 25 },
};

window.planData = null;
let activationCounter = 0;

// ─── Navigation ────────────────────────────────────────────────────────────────
function goToStep(n) {
  const current = window.appState.currentStep;
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`step${n}`).classList.add('active');

  document.querySelectorAll('.step-btn').forEach(btn => {
    const s = parseInt(btn.dataset.step);
    btn.classList.remove('active', 'completed');
    if (s === n) btn.classList.add('active');
    else if (s < n) btn.classList.add('completed');
  });

  window.appState.currentStep = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (n === 3) renderPlatformSplits();
  if (n === 4) generatePlan();
}

function validateAndGoStep(n) {
  if (n === 2 && !validateStep1()) return;
  if (n === 3 && !validateStep2()) return;
  if (n === 4 && !validateStep3()) return;
  goToStep(n);
}

function validateStep1() {
  const name = document.getElementById('campaignName').value.trim();
  const country = document.getElementById('campaignCountry').value;
  const budget = parseFloat(document.getElementById('totalBudget').value);
  const rate = parseFloat(document.getElementById('exchangeRate').value);

  if (!name) { showToast('Please enter a campaign name', 'error'); return false; }
  if (!country) { showToast('Please select a target country', 'error'); return false; }
  if (!budget || budget <= 0) { showToast('Please enter a valid total budget', 'error'); return false; }
  if (!rate || rate <= 0) { showToast('Please enter a valid exchange rate', 'error'); return false; }

  window.appState.campaignName = name;
  window.appState.country = country;
  window.appState.totalBudget = budget;
  window.appState.exchangeRate = rate;
  window.appState.objective = document.getElementById('campaignObjective').value;
  return true;
}

function validateStep2() {
  if (window.appState.activations.length === 0) {
    showToast('Add at least one activation', 'error');
    return false;
  }
  // Collect activation data from DOM
  collectActivationData();
  return true;
}

function validateStep3() {
  const total = Object.values(window.appState.platformSplits).reduce((s, v) => s + v, 0);
  if (Math.abs(total - 100) > 0.5) {
    document.getElementById('splitWarning').classList.remove('hidden');
    showToast('Platform splits must total 100%', 'error');
    return false;
  }
  document.getElementById('splitWarning').classList.add('hidden');
  return true;
}

// ─── Step 1: Country Change ────────────────────────────────────────────────────
function onCountryChange() {
  const countryCode = document.getElementById('campaignCountry').value;
  const countryData = COUNTRY_DATA[countryCode];
  const warning = document.getElementById('tiktokWarning');
  const warningText = document.getElementById('tiktokWarningText');

  if (countryData && !countryData.tiktokAllowed) {
    warning.classList.remove('hidden');
    warningText.textContent = countryData.tiktokNote || `TikTok Ads are not available in ${countryData.name}. Budget will be redistributed.`;
  } else {
    warning.classList.add('hidden');
  }

  // Pre-load country splits for step 3
  if (countryData) {
    window.appState.platformSplits = { ...countryData.splits };
  }
}

// ─── Step 2: Activations ──────────────────────────────────────────────────────
function addActivation(defaults = {}) {
  activationCounter++;
  const id = `act-${activationCounter}`;

  const act = {
    id,
    name: defaults.name || `Activation ${activationCounter}`,
    date: defaults.date || '',
    assetType: defaults.assetType || 'Video',
    objective: defaults.objective || '',
    durations: defaults.durations || { ...DEFAULT_DURATIONS },
  };

  window.appState.activations.push(act);
  renderActivation(act);
}

function renderActivation(act) {
  const list = document.getElementById('activationsList');
  const idx = window.appState.activations.findIndex(a => a.id === act.id) + 1;

  const card = document.createElement('div');
  card.className = 'activation-card';
  card.id = `card-${act.id}`;

  card.innerHTML = `
    <div class="activation-card-header">
      <span class="activation-index">Activation #${idx}</span>
      <button class="activation-delete" onclick="removeActivation('${act.id}')" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="activation-grid">
      <div class="form-group">
        <label>Activation Name</label>
        <input type="text" id="name-${act.id}" value="${act.name}" placeholder="e.g. Teaser, Episode 1" />
      </div>
      <div class="form-group">
        <label>Date</label>
        <input type="date" id="date-${act.id}" value="${act.date}" />
      </div>
      <div class="form-group">
        <label>Asset Type</label>
        <div class="asset-type-selector" id="asset-${act.id}">
          <button class="asset-pill video ${act.assetType === 'Video' ? 'selected' : ''}"
            onclick="selectAsset('${act.id}', 'Video', this)">🎬 Video</button>
          <button class="asset-pill animated ${act.assetType === 'Animated Static' ? 'selected' : ''}"
            onclick="selectAsset('${act.id}', 'Animated Static', this)">✨ Animated</button>
          <button class="asset-pill static ${act.assetType === 'Static' ? 'selected' : ''}"
            onclick="selectAsset('${act.id}', 'Static', this)">🖼 Static</button>
        </div>
      </div>
      <div class="form-group">
        <label>Ad Objective (optional override)</label>
        <select id="obj-${act.id}">
          <option value="">Use campaign default</option>
          <option value="Video Views">Video Views</option>
          <option value="Reach">Reach</option>
          <option value="Brand Awareness">Brand Awareness</option>
          <option value="Conversions">Conversions</option>
          <option value="Traffic">Traffic</option>
          <option value="Engagement">Engagement</option>
        </select>
      </div>
    </div>
  `;

  list.appendChild(card);
}

function selectAsset(actId, type, btn) {
  // Update UI
  const container = document.getElementById(`asset-${actId}`);
  container.querySelectorAll('.asset-pill').forEach(p => p.classList.remove('selected'));
  btn.classList.add('selected');
  // Update state
  const act = window.appState.activations.find(a => a.id === actId);
  if (act) act.assetType = type;
}

function removeActivation(id) {
  window.appState.activations = window.appState.activations.filter(a => a.id !== id);
  const card = document.getElementById(`card-${id}`);
  if (card) card.remove();
  // Re-number remaining cards
  window.appState.activations.forEach((a, i) => {
    const idx = document.querySelector(`#card-${a.id} .activation-index`);
    if (idx) idx.textContent = `Activation #${i + 1}`;
  });
}

function collectActivationData() {
  for (const act of window.appState.activations) {
    act.name = document.getElementById(`name-${act.id}`)?.value?.trim() || act.name;
    act.date = document.getElementById(`date-${act.id}`)?.value || act.date;
    act.objective = document.getElementById(`obj-${act.id}`)?.value || '';
  }
}

// ─── Step 3: Platform Splits ──────────────────────────────────────────────────
function renderPlatformSplits() {
  const countryCode = window.appState.country;
  const countryData = COUNTRY_DATA[countryCode] || {};
  const splits = window.appState.platformSplits;
  const totalBudget = window.appState.totalBudget;

  document.getElementById('splitCountryLabel').textContent =
    countryData.name ? `${countryData.flag} ${countryData.name}` : 'your selected country';

  const editor = document.getElementById('platformSplitEditor');
  editor.innerHTML = '';

  for (const platform of PLATFORMS) {
    const pct = splits[platform.id] ?? 0;
    const disabled = !countryData.tiktokAllowed && platform.id === 'TikTok';
    const usdAmt = (pct / 100) * totalBudget;

    const row = document.createElement('div');
    row.className = `platform-split-row${disabled ? ' disabled' : ''}`;
    row.id = `split-row-${platform.id}`;

    row.innerHTML = `
      <div class="platform-badge">
        <div class="platform-dot ${platform.cssClass}"></div>
        ${platform.icon} ${platform.label}
        ${disabled ? '<span style="font-size:0.7rem;color:var(--accent-amber);margin-left:6px;">⚠️ Not available</span>' : ''}
      </div>
      <div class="split-slider-wrapper">
        <input type="range" class="split-slider" id="slider-${platform.id}"
          min="0" max="100" step="1" value="${pct}"
          ${disabled ? 'disabled' : ''}
          oninput="onSplitSlider('${platform.id}', this.value)" />
      </div>
      <input type="number" class="split-pct-input" id="pct-${platform.id}"
        min="0" max="100" step="1" value="${pct}"
        ${disabled ? 'disabled' : ''}
        oninput="onSplitInput('${platform.id}', this.value)" />
      <div class="split-usd-display" id="usd-${platform.id}">${fmtUSD(usdAmt)}</div>
    `;

    editor.appendChild(row);
  }

  updateSplitTotal();
}

function onSplitSlider(platformId, val) {
  window.appState.platformSplits[platformId] = parseFloat(val);
  document.getElementById(`pct-${platformId}`).value = val;
  document.getElementById(`usd-${platformId}`).textContent = fmtUSD((val / 100) * window.appState.totalBudget);
  updateSplitTotal();
}

function onSplitInput(platformId, val) {
  const v = Math.max(0, Math.min(100, parseFloat(val) || 0));
  window.appState.platformSplits[platformId] = v;
  document.getElementById(`slider-${platformId}`).value = v;
  document.getElementById(`usd-${platformId}`).textContent = fmtUSD((v / 100) * window.appState.totalBudget);
  updateSplitTotal();
}

function updateSplitTotal() {
  const total = Object.values(window.appState.platformSplits).reduce((s, v) => s + v, 0);
  const totalEl = document.getElementById('splitTotal');
  const totalUSDEl = document.getElementById('splitTotalUSD');
  const warning = document.getElementById('splitWarning');

  totalEl.textContent = `${total.toFixed(1)}%`;
  totalEl.style.color = Math.abs(total - 100) < 0.5 ? 'var(--accent-green)' : 'var(--accent-red)';
  totalUSDEl.textContent = `= ${fmtUSD((total / 100) * window.appState.totalBudget)} of ${fmtUSD(window.appState.totalBudget)}`;

  if (Math.abs(total - 100) < 0.5) {
    warning.classList.add('hidden');
  }
}

// ─── Step 4: Generate Plan ─────────────────────────────────────────────────────
function generatePlan() {
  const state = window.appState;
  const plan = buildPlan(state);
  window.planData = plan;

  document.getElementById('planTitle').textContent = state.campaignName || 'Budget Plan';

  renderSummaryCards(plan, state);
  renderBudgetTable(plan, state);

  // Auto-save to Drive if user is signed in
  if (window.accessToken) {
    const snapshot = {
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      campaignName: state.campaignName,
      totalBudget: state.totalBudget,
      country: state.country,
      exchangeRate: state.exchangeRate,
      state: JSON.parse(JSON.stringify(state)),
      planData: JSON.parse(JSON.stringify(plan)),
    };
    savePlanToDrive(snapshot)
      .then(() => showToast('✅ Plan saved to Google Drive', 'success'))
      .catch(err => showToast('Could not save to Drive: ' + err.message, 'error'));
  }
}

function renderSummaryCards(plan, state) {
  const countryData = COUNTRY_DATA[state.country] || {};
  const cards = [
    { label: 'Total Budget', value: fmtUSD(state.totalBudget), sub: fmtZAR(state.totalBudget * state.exchangeRate), color: 'var(--accent-purple)' },
    { label: 'Activations', value: state.activations.length, sub: `${Object.values(state.platformSplits).filter(v => v > 0).length} platforms`, color: 'var(--accent-cyan)' },
    { label: 'Grand Total Budget', value: fmtUSD(plan.grandTotalBudget), sub: fmtZAR(plan.zarGrandTotal), color: 'var(--accent-green)' },
    { label: 'Underspend', value: fmtUSD(plan.underspend), sub: plan.underspend > 0 ? 'Available buffer' : 'Fully allocated', color: plan.underspend >= 0 ? 'var(--accent-amber)' : 'var(--accent-red)' },
    { label: 'Exchange Rate', value: `R${state.exchangeRate}`, sub: '$1 USD', color: 'var(--accent-pink)' },
    { label: 'Country', value: `${countryData.flag || ''} ${countryData.name || state.country}`, sub: countryData.tiktokAllowed === false ? '⚠️ TikTok restricted' : '✅ TikTok available', color: 'var(--accent-cyan)' },
  ];

  const container = document.getElementById('summaryCards');
  container.innerHTML = cards.map(c => `
    <div class="summary-card" style="--accent-color: ${c.color}">
      <div class="summary-label">${c.label}</div>
      <div class="summary-value">${c.value}</div>
      <div class="summary-sub">${c.sub}</div>
    </div>
  `).join('');
}

function renderBudgetTable(plan, state) {
  const tbody = document.getElementById('budgetTableBody');
  tbody.innerHTML = '';

  const activePlatforms = PLATFORMS.filter(p => (state.platformSplits[p.id] ?? 0) > 0);
  let rowIndex = 0;

  for (const row of plan.rows) {
    const tr = document.createElement('tr');

    if (row._isSubtotal) {
      tr.className = 'subtotal-row';
      tr.innerHTML = `
        <td colspan="12" style="text-align:right;color:var(--text-muted);font-size:0.78rem;">Subtotal</td>
        <td style="text-align:right;font-weight:700;">${fmtUSD(row.budget)}</td>
      `;
    } else {
      const ri = rowIndex++;
      const actual = parseFloat(row.actualSpend) || 0;
      const diff = row.budget - actual;
      const diffClass = diff > 0.005 ? 'diff-positive' : diff < -0.005 ? 'diff-negative' : 'diff-zero';
      const diffStr = actual > 0 ? fmtUSD(diff) : '—';

      tr.innerHTML = `
        <td>${row.date || '<span style="color:var(--text-muted)">TBD</span>'}</td>
        <td style="color:var(--text-muted);font-size:0.78rem;">${row.day || ''}</td>
        <td><strong>${row.activation}</strong></td>
        <td><span class="asset-tag ${row.assetType === 'Video' ? 'video' : row.assetType === 'Animated Static' ? 'animated' : 'static'}">${row.assetType}</span></td>
        <td><span class="platform-tag ${row.platformClass}">${row.platform}</span></td>
        <td style="color:var(--text-muted);font-size:0.82rem;">${row.country}</td>
        <td style="font-family:'Space Grotesk',sans-serif;color:var(--text-secondary);">${fmtZAR(row.zarValue)}</td>
        <td style="text-align:center;">${row.duration}</td>
        <td style="font-size:0.78rem;color:var(--text-muted);">${row.objective}</td>
        <td style="text-align:center;"><input type="checkbox" class="complete-check" onchange="onCompleteChange(this, ${ri})" /></td>
        <td><input type="number" class="actual-spend-input" placeholder="$0.00" step="0.01" min="0"
          oninput="onActualSpendChange(this, ${ri})" data-row-idx="${ri}" /></td>
        <td class="diff-cell-${ri}"><span class="${diffClass}">—</span></td>
        <td style="font-weight:600;font-family:'Space Grotesk',sans-serif;">${fmtUSD(row.budget)}</td>
      `;
    }

    tbody.appendChild(tr);
  }

  // Grand total rows
  const zarTotalRow = document.createElement('tr');
  zarTotalRow.className = 'grand-total-row';
  zarTotalRow.innerHTML = `
    <td colspan="6" style="text-align:right;font-size:0.78rem;color:var(--text-muted);">ZAR Grand Total</td>
    <td style="font-weight:800;">${fmtZAR(plan.zarGrandTotal)}</td>
    <td colspan="3" style="text-align:right;font-size:0.78rem;color:var(--text-muted);">GRAND TOTAL</td>
    <td></td>
    <td></td>
    <td style="font-weight:800;">${fmtUSD(plan.grandTotalBudget)}</td>
  `;
  tbody.appendChild(zarTotalRow);

  const underspendRow = document.createElement('tr');
  underspendRow.className = 'grand-total-row';
  underspendRow.innerHTML = `
    <td colspan="9" style="text-align:right;font-size:0.78rem;color:var(--text-muted);">Underspend / Buffer</td>
    <td colspan="2"></td>
    <td style="color:var(--accent-amber);font-weight:700;">0</td>
    <td style="color:var(--accent-amber);font-weight:700;">${fmtUSD(plan.underspend)}</td>
  `;
  tbody.appendChild(underspendRow);

  const budgetOverallRow = document.createElement('tr');
  budgetOverallRow.className = 'grand-total-row';
  budgetOverallRow.innerHTML = `
    <td colspan="9" style="text-align:right;font-size:0.78rem;color:var(--text-muted);">Budget Overall</td>
    <td colspan="3"></td>
    <td style="font-weight:800;">${fmtUSD(plan.budgetOverall)}</td>
  `;
  tbody.appendChild(budgetOverallRow);
}

// ─── Interactive: actual spend & complete ─────────────────────────────────────
const rowActualData = {};

function onActualSpendChange(input, rowIdx) {
  const val = parseFloat(input.value) || 0;
  rowActualData[rowIdx] = val;

  const dataRow = window.planData.rows.filter(r => !r._isSubtotal)[rowIdx];
  if (!dataRow) return;
  dataRow.actualSpend = val;

  const diff = dataRow.budget - val;
  const diffClass = diff > 0.005 ? 'diff-positive' : diff < -0.005 ? 'diff-negative' : 'diff-zero';
  const diffCell = document.querySelector(`.diff-cell-${rowIdx}`);
  if (diffCell) diffCell.innerHTML = `<span class="${diffClass}">${fmtUSD(diff)}</span>`;

  updateGrandTotalActual();
}

function onCompleteChange(checkbox, rowIdx) {
  const dataRow = window.planData.rows.filter(r => !r._isSubtotal)[rowIdx];
  if (dataRow) dataRow.complete = checkbox.checked;
}

function updateGrandTotalActual() {
  const actualRows = window.planData.rows.filter(r => !r._isSubtotal);
  const total = actualRows.reduce((s, r) => s + (parseFloat(r.actualSpend) || 0), 0);
  window.planData.grandTotalActual = total;
}

// ─── Toast notifications ──────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ─── Dashboard Navigation ─────────────────────────────────────────────────────

/**
 * Called from the dashboard "New Campaign" button.
 * Resets all app state and shows step 1 of the wizard.
 */
function startNewPlan() {
  // Reset state to defaults
  window.appState = {
    currentStep: 1,
    campaignName: '',
    country: '',
    totalBudget: 0,
    exchangeRate: 18.5,
    objective: 'Video Views',
    activations: [],
    platformSplits: { TikTok: 25, Instagram: 25, YouTube: 25, Facebook: 25 },
  };
  window.planData = null;
  activationCounter = 0;

  // Clear the activations list in the DOM
  const list = document.getElementById('activationsList');
  if (list) list.innerHTML = '';

  // Reset the step 1 form fields
  const nameEl = document.getElementById('campaignName');
  const countryEl = document.getElementById('campaignCountry');
  const budgetEl = document.getElementById('totalBudget');
  const rateEl = document.getElementById('exchangeRate');
  if (nameEl) nameEl.value = '';
  if (countryEl) countryEl.value = '';
  if (budgetEl) budgetEl.value = '';
  if (rateEl) rateEl.value = '18.5';

  // Hide TikTok warning
  const warning = document.getElementById('tiktokWarning');
  if (warning) warning.classList.add('hidden');

  // Show wizard at step 1
  showWizard();

  // Reset step nav to step 1 active state
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  const step1 = document.getElementById('step1');
  if (step1) step1.classList.add('active');
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.classList.remove('active', 'completed');
    if (btn.dataset.step === '1') btn.classList.add('active');
  });
  window.appState.currentStep = 1;

  // Add a default activation to get them started
  addActivation({ name: 'Teaser', assetType: 'Video' });
}

/**
 * Called when user clicks a plan card on the dashboard.
 * Restores app state and renders the plan at step 4.
 */
function loadPlanIntoApp(plan) {
  if (!plan) return;

  window.appState = plan.state;
  window.planData = plan.planData;

  showWizard();

  // Navigate to step 4 results view without re-generating the plan
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  const step4 = document.getElementById('step4');
  if (step4) step4.classList.add('active');

  document.querySelectorAll('.step-btn').forEach(btn => {
    const s = parseInt(btn.dataset.step);
    btn.classList.remove('active', 'completed');
    if (s === 4) btn.classList.add('active');
    else btn.classList.add('completed');
  });

  window.appState.currentStep = 4;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Re-render results using saved data (don't call generatePlan — it would re-save)
  if (window.planData && window.appState) {
    document.getElementById('planTitle').textContent = window.appState.campaignName || 'Budget Plan';
    renderSummaryCards(window.planData, window.appState);
    renderBudgetTable(window.planData, window.appState);
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Add a default first activation to get people started
  addActivation({ name: 'Teaser', assetType: 'Video' });

  // Init Google API if available
  window.onGoogleLibraryLoad = () => {
    gapi.load('client', async () => {
      try {
        await gapi.client.init({
          apiKey: GOOGLE_API_KEY,
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
        });
        gapiReady = true;
        initTokenClient();
      } catch(e) {
        // API not configured — silently fail, CSV fallback works
      }
    });
  };
});
