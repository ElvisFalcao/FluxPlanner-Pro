/**
 * budget-engine.js — All budget calculation logic
 */

/**
 * Given activations with asset types, distribute total budget
 * proportionally using ASSET_WEIGHTS.
 * Returns array of { activation, budgetUSD }
 */
function calcActivationBudgets(activations, totalBudgetUSD) {
  if (!activations.length) return [];

  const weights = activations.map(a => ASSET_WEIGHTS[a.assetType] ?? 1.0);
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  return activations.map((a, i) => ({
    ...a,
    budgetUSD: totalWeight > 0 ? (weights[i] / totalWeight) * totalBudgetUSD : 0,
  }));
}

/**
 * Distribute the total budget across activations honoring per-post overrides:
 *   • Locked posts keep their pinned `budget` amount.
 *   • Unlocked ("auto") posts share whatever is left, proportional to their
 *     asset-type weight — so when nothing is locked this matches the plain
 *     asset-weighted split (calcActivationBudgets) exactly.
 * Returns each activation with a computed `budgetUSD`.
 */
function computeActivationBudgets(activations, totalBudgetUSD) {
  if (!activations.length) return [];

  const isLocked = a => !!a.budgetLocked;
  let lockedSum = activations.filter(isLocked)
    .reduce((s, a) => s + (Number(a.budget) || 0), 0);
  lockedSum = Math.min(lockedSum, totalBudgetUSD);
  const remaining = Math.max(0, totalBudgetUSD - lockedSum);

  const autoActs = activations.filter(a => !isLocked(a));
  const autoWeightSum = autoActs.reduce((s, a) => s + (ASSET_WEIGHTS[a.assetType] ?? 1.0), 0);

  return activations.map(a => {
    if (isLocked(a)) {
      return { ...a, budgetUSD: Math.min(Number(a.budget) || 0, totalBudgetUSD) };
    }
    const w = ASSET_WEIGHTS[a.assetType] ?? 1.0;
    return { ...a, budgetUSD: autoWeightSum > 0 ? (w / autoWeightSum) * remaining : 0 };
  });
}

/**
 * Given per-activation budget and platform splits (%),
 * compute per-platform USD amounts for a single activation.
 * Skips disabled platforms (0%).
 */
function calcPlatformAmounts(activationBudgetUSD, platformSplits) {
  const result = {};
  const total = Object.values(platformSplits).reduce((s, v) => s + v, 0);
  for (const [platform, pct] of Object.entries(platformSplits)) {
    result[platform] = total > 0 ? (pct / total) * activationBudgetUSD : 0;
  }
  return result;
}

/**
 * Convert USD amount to ZAR using exchange rate.
 */
function usdToZar(usd, rate) {
  return usd * rate;
}

/**
 * Format a number as USD string.
 */
function fmtUSD(n) {
  if (n === null || n === undefined || n === '') return '';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

/**
 * Format a number as ZAR string.
 */
function fmtZAR(n) {
  if (n === null || n === undefined || n === '') return '';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-R${formatted}` : `R${formatted}`;
}

/**
 * Get day-of-week string from a date string (YYYY-MM-DD or DD/MM/YYYY).
 */
function getDayOfWeek(dateStr) {
  if (!dateStr) return '';
  let d;
  if (dateStr.includes('-')) {
    d = new Date(dateStr);
  } else {
    const [day, month, year] = dateStr.split('/');
    d = new Date(`${year}-${month}-${day}`);
  }
  return isNaN(d) ? '' : DAYS_OF_WEEK[d.getDay()];
}

/**
 * Format a date string to DD/MM/YYYY.
 */
function formatDateDMY(dateStr) {
  if (!dateStr) return '';
  if (dateStr.includes('/')) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Main engine: build the full plan rows from state.
 * Returns { rows, subtotals, grandTotal, underspend }
 */
function buildPlan(state) {
  const {
    campaignName,
    country,
    totalBudget,
    exchangeRate,
    objective,
    activations,
    platformSplits, // { TikTok: 40, Instagram: 30, YouTube: 20, Facebook: 10 }
  } = state;

  const countryData = COUNTRY_DATA[country] || {};
  const countryName = countryData.name || country;

  // Only include platforms with > 0% split
  const activeSplits = {};
  for (const [p, pct] of Object.entries(platformSplits)) {
    if (pct > 0) activeSplits[p] = pct;
  }

  // Budget per post: locked posts keep their amount, the rest share the
  // remainder by asset weight (see computeActivationBudgets).
  const weightedActivations = computeActivationBudgets(activations, totalBudget);

  const rows = [];
  const subtotals = []; // per activation
  let grandTotalBudget = 0;
  let grandTotalActual = 0;

  for (const act of weightedActivations) {
    // A post fans out only to the platforms its asset type supports, intersected
    // with the platforms active in this country. The slider % are re-normalized
    // across just those eligible platforms (activation-first model).
    const eligible = (typeof ASSET_PLATFORM_ELIGIBILITY !== 'undefined' &&
                      ASSET_PLATFORM_ELIGIBILITY[act.assetType]) ||
                     PLATFORMS.map(p => p.id);
    const actSplits = {};
    for (const pid of eligible) {
      if (activeSplits[pid] !== undefined) actSplits[pid] = activeSplits[pid];
    }

    const platformAmounts = calcPlatformAmounts(act.budgetUSD, actSplits);
    const activationRows = [];
    let subtotalBudget = 0;

    const platformList = PLATFORMS.filter(p => actSplits[p.id] !== undefined);

    for (const platform of platformList) {
      const budgetUSD = platformAmounts[platform.id] ?? 0;
      const zarValue = usdToZar(budgetUSD, exchangeRate);
      const duration = act.durations?.[platform.id] ?? DEFAULT_DURATIONS[platform.id] ?? 7;
      const platformObjective = (typeof PLATFORM_OBJECTIVES !== 'undefined' &&
                                 PLATFORM_OBJECTIVES[platform.id]) || act.objective || objective;

      const row = {
        date: formatDateDMY(act.date),
        day: getDayOfWeek(act.date),
        activation: act.name,
        assetType: act.assetType,
        platform: platform.id,
        platformClass: platform.cssClass,
        country: countryName,
        zarValue,
        duration,
        objective: platformObjective,
        complete: false,
        actualSpend: '',
        difference: budgetUSD, // initially = budget (no actual spend yet)
        budget: budgetUSD,
        _activationId: act.id,
      };

      activationRows.push(row);
      subtotalBudget += budgetUSD;
    }

    rows.push(...activationRows);
    grandTotalBudget += subtotalBudget;
    subtotals.push({ activationId: act.id, name: act.name, budget: subtotalBudget });

    // Spacer/subtotal marker
    rows.push({ _isSubtotal: true, activationId: act.id, budget: subtotalBudget });
  }

  const underspend = totalBudget - grandTotalBudget;

  return {
    rows,
    subtotals,
    grandTotalBudget,
    grandTotalActual,
    underspend,
    budgetOverall: totalBudget,
    zarGrandTotal: usdToZar(grandTotalBudget, exchangeRate),
  };
}

/**
 * Recalculate difference for a single data row after actual spend update.
 */
function recalcDifference(row) {
  const actual = parseFloat(row.actualSpend) || 0;
  return row.budget - actual;
}
