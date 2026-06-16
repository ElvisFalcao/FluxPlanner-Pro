import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

describe('Campaign Filter E2E Test Suite', () => {
  let dom;
  let window;
  let document;

  // Standard mock plans data to seed into localStorage
  const mockPlans = [
    {
      id: 'plan-1',
      campaignName: 'Plan A',
      totalBudget: 10000,
      country: 'NG',
      exchangeRate: 1600,
      savedAt: '2026-06-14T00:00:00.000Z',
      state: {
        platformSplits: { TikTok: 40, Instagram: 30, YouTube: 20, Facebook: 10 }
      },
      planData: {
        rows: [
          { actualSpend: 2000, complete: true, _isSubtotal: false },
          { actualSpend: 3000, complete: false, _isSubtotal: false },
        ]
      }
    },
    {
      id: 'plan-2',
      campaignName: 'Plan B',
      totalBudget: 20000,
      country: 'ZA',
      exchangeRate: 18.5,
      savedAt: '2026-06-13T00:00:00.000Z',
      state: {
        platformSplits: { TikTok: 35, Instagram: 30, YouTube: 20, Facebook: 15 }
      },
      planData: {
        rows: [
          { actualSpend: 5000, complete: true, _isSubtotal: false },
          { actualSpend: 5000, complete: true, _isSubtotal: false },
        ]
      }
    },
    {
      id: 'plan-3',
      campaignName: 'Plan C',
      totalBudget: 30000,
      country: 'KE',
      exchangeRate: 130,
      savedAt: '2026-06-12T00:00:00.000Z',
      state: {
        platformSplits: { TikTok: 30, Instagram: 25, YouTube: 30, Facebook: 15 }
      },
      planData: {
        rows: [
          { actualSpend: 10000, complete: false, _isSubtotal: false },
        ]
      }
    }
  ];

  beforeEach(() => {
    // 1. Read index.html
    const htmlPath = path.resolve(__dirname, '../index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    // Strip out the inline tailwind.config script to avoid reference error (since tailwind Play CDN is not fetched)
    html = html.replace(/<script>\s*tailwind\.config[\s\S]*?<\/script>/, '');

    // 2. Setup JSDOM
    dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'http://localhost/',
    });
    window = dom.window;
    document = window.document;

    // 3. Mock window APIs
    window.scrollTo = vi.fn();
    window.alert = vi.fn();
    window.confirm = vi.fn(() => true);
    
    // Simple window.crypto.randomUUID mock
    window.crypto = {
      randomUUID: () => 'mock-uuid-' + Math.random().toString(36).substr(2, 9)
    };

    // Mock localStorage
    const store = {
      'fpro_guest_plans': JSON.stringify(mockPlans)
    };
    window.localStorage = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, value) => { store[key] = String(value); }),
      removeItem: vi.fn((key) => { delete store[key]; }),
      clear: vi.fn(() => { for (const key in store) delete store[key]; }),
    };

    // 4. Mock Supabase Client API
    window.supabase = {
      createClient: () => ({
        auth: {
          signUp: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
          signInWithPassword: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
          signOut: vi.fn().mockResolvedValue({ error: null }),
          getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
          getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
          updateUser: vi.fn().mockResolvedValue({ data: { user: {} }, error: null }),
        },
        from: vi.fn().mockImplementation((table) => ({
          insert: vi.fn().mockResolvedValue({ data: [], error: null }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          update: vi.fn().mockResolvedValue({ data: [], error: null }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        })),
        storage: {
          from: () => ({
            upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
            getPublicUrl: () => ({ data: { publicUrl: 'http://mock-avatar-url' } }),
          }),
        },
        functions: {
          invoke: vi.fn().mockResolvedValue({ data: {}, error: null }),
        },
      }),
    };

    // 5. Mock Google APIs (gapi + GIS)
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: () => ({
            requestAccessToken: vi.fn(),
          }),
          revoke: vi.fn(),
        },
      },
    };
    window.gapi = {
      load: (api, cb) => cb(),
      client: {
        init: vi.fn().mockResolvedValue({}),
        setToken: vi.fn(),
      },
    };

    // 6. Mock SheetJS
    window.XLSX = {
      utils: {
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        aoa_to_sheet: () => ({}),
        book_append_sheet: vi.fn(),
      },
      writeFile: vi.fn(),
    };

    // Mock showToast
    window.showToast = vi.fn();

    // 7. Load local application scripts in required sequential order by concatenating them
    const scripts = [
      'config.js',
      'data.js',
      'budget-engine.js',
      'export.js',
      'plans.js',
      'accounts.js',
      'app.js',
    ];

    const combinedCode = scripts
      .map((file) => fs.readFileSync(path.resolve(__dirname, `../${file}`), 'utf8'))
      .join('\n;\n'); // separate with semicolons to prevent parser errors

    window.eval(combinedCode);

    // 8. Manually fire DOMContentLoaded to trigger application initialization
    const event = new window.Event('DOMContentLoaded', {
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    // 9. Navigate to dashboard as a guest user
    window.continueAsGuest();
  });

  // ==========================================
  // TIER 1: Feature Coverage (Core UI & Logic)
  // ==========================================

  it('T1_SearchFiltering: Typing in the search input filters option list in real-time', () => {
    const searchInput = document.getElementById('campaignFilterSearch');
    expect(searchInput, 'Filter search input #campaignFilterSearch should exist').not.toBeNull();
    
    // Simulate typing 'Plan A'
    searchInput.value = 'Plan A';
    searchInput.dispatchEvent(new window.Event('input'));
    
    // Expect matching option items to remain visible while others are hidden
    const optionItems = Array.from(document.querySelectorAll('.filter-option-item'));
    expect(optionItems.length, 'Filter option items should exist').toBeGreaterThan(0);
    
    const visibleOptions = optionItems.filter(opt => opt.style.display !== 'none');
    expect(visibleOptions.every(opt => opt.textContent.includes('Plan A'))).toBe(true);
  });

  it('T1_CheckboxSelection: Selecting plans via checkboxes updates selection state', () => {
    // Retrieve plan checkboxes
    const checkboxes = Array.from(document.querySelectorAll('.plan-filter-checkbox'));
    expect(checkboxes.length, 'Plan checkboxes .plan-filter-checkbox should exist').toBeGreaterThan(0);
    
    // Check the box for Plan A
    const planACheckbox = checkboxes.find(cb => cb.dataset.name === 'Plan A');
    expect(planACheckbox, 'Checkbox for Plan A should exist').toBeDefined();
    
    planACheckbox.checked = true;
    planACheckbox.dispatchEvent(new window.Event('change'));
    
    // Assert dashboard filter state now includes Plan A
    expect(window.dashboardFilterState.selected).toContain('Plan A');
  });

  it('T1_DismissibleTags: Clicking x on a chip removes it from selection', () => {
    // Select Plan A
    const planACheckbox = document.querySelector('.plan-filter-checkbox[data-name="Plan A"]');
    expect(planACheckbox, 'Plan A checkbox should exist').not.toBeNull();
    planACheckbox.checked = true;
    planACheckbox.dispatchEvent(new window.Event('change'));
    
    // Assert chip is created
    const chipsContainer = document.getElementById('campaignFilterChips');
    expect(chipsContainer, '#campaignFilterChips should exist').not.toBeNull();
    
    const chip = chipsContainer.querySelector('.filter-chip[data-name="Plan A"]');
    expect(chip, 'Filter chip for Plan A should exist').not.toBeNull();
    
    // Find and click the dismiss close button
    const closeBtn = chip.querySelector('.remove-chip-btn');
    expect(closeBtn, 'Close button .remove-chip-btn should exist on the chip').not.toBeNull();
    closeBtn.dispatchEvent(new window.Event('click'));
    
    // Assert state is cleared
    expect(window.dashboardFilterState.selected).not.toContain('Plan A');
    expect(planACheckbox.checked).toBe(false);
  });

  it('T1_AllPlansOption: "All Plans" clears individual selections and shows all plans', () => {
    // Select Plan A and Plan B
    const checkboxes = Array.from(document.querySelectorAll('.plan-filter-checkbox'));
    const cbA = checkboxes.find(cb => cb.dataset.name === 'Plan A');
    const cbB = checkboxes.find(cb => cb.dataset.name === 'Plan B');
    
    expect(cbA).toBeDefined();
    expect(cbB).toBeDefined();
    
    cbA.checked = true;
    cbA.dispatchEvent(new window.Event('change'));
    cbB.checked = true;
    cbB.dispatchEvent(new window.Event('change'));
    
    // Select All Plans option
    const allPlansCheckbox = document.getElementById('allPlansCheckbox');
    expect(allPlansCheckbox, '#allPlansCheckbox should exist').not.toBeNull();
    
    allPlansCheckbox.checked = true;
    allPlansCheckbox.dispatchEvent(new window.Event('change'));
    
    // Assert selections are cleared and "All Plans" is the active filter
    expect(window.dashboardFilterState.selected.length).toBe(0);
    expect(cbA.checked).toBe(false);
    expect(cbB.checked).toBe(false);
  });

  it('T1_DynamicDashboardUpdate: Totals in #overviewSection and plan cards in #plansGrid update on selection change', () => {
    const cbA = document.querySelector('.plan-filter-checkbox[data-name="Plan A"]');
    expect(cbA, 'Plan A checkbox should exist').not.toBeNull();
    
    cbA.checked = true;
    cbA.dispatchEvent(new window.Event('change'));
    
    // Assert overviewSection shows 1 Campaign and Total Budget is Plan A ($10,000.00)
    const overviewSection = document.getElementById('overviewSection');
    expect(overviewSection.textContent).toContain('1Campaigns');
    expect(overviewSection.textContent).toContain('$10,000.00');
    
    // Assert plansGrid only displays 1 plan card (Plan A)
    const planCards = document.querySelectorAll('#plansGrid .plan-card');
    expect(planCards.length).toBe(1);
    expect(planCards[0].textContent).toContain('Plan A');
  });

  // ==========================================
  // TIER 2: Boundary & Corner Cases
  // ==========================================

  it('T2_EmptySearchMatches: Non-matching search shows "No matching plans"', () => {
    const searchInput = document.getElementById('campaignFilterSearch');
    expect(searchInput).not.toBeNull();
    
    searchInput.value = 'XYZ123NonExistent';
    searchInput.dispatchEvent(new window.Event('input'));
    
    const noMatchPlaceholder = document.getElementById('noMatchingPlansPlaceholder');
    expect(noMatchPlaceholder, '#noMatchingPlansPlaceholder should be visible').not.toBeNull();
    expect(noMatchPlaceholder.style.display).not.toBe('none');
  });

  it('T2_MultiplePrefixMatches: Prefix matching multiple plans lists them correctly', () => {
    const searchInput = document.getElementById('campaignFilterSearch');
    expect(searchInput).not.toBeNull();
    
    searchInput.value = 'Plan';
    searchInput.dispatchEvent(new window.Event('input'));
    
    const optionItems = Array.from(document.querySelectorAll('.filter-option-item'));
    const visibleOptions = optionItems.filter(opt => opt.style.display !== 'none');
    
    // We expect Plan A, B, and C to match the prefix 'Plan'
    expect(visibleOptions.length).toBe(3);
    const names = visibleOptions.map(opt => opt.textContent.trim());
    expect(names).toContain('Plan A');
    expect(names).toContain('Plan B');
    expect(names).toContain('Plan C');
  });

  it('T2_SelectAllManually: Manually checking all plans checkboxes acts as showing all plans', () => {
    const checkboxes = Array.from(document.querySelectorAll('.plan-filter-checkbox'));
    expect(checkboxes.length).toBe(3);
    
    checkboxes.forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new window.Event('change'));
    });
    
    // Check that having all checked acts as "All Plans" (e.g. no individual chips or clears selections to fallback to All)
    expect(window.dashboardFilterState.selected.length).toBe(0);
    const allPlansCheckbox = document.getElementById('allPlansCheckbox');
    expect(allPlansCheckbox.checked).toBe(true);
  });

  it('T2_NoSavedPlans: Behaves gracefully when there are no saved plans', () => {
    // Clear localStorage and reload dashboard
    window.localStorage.setItem('fpro_guest_plans', '[]');
    window.showDashboard();
    
    const filterContainer = document.getElementById('campaignFilterContainer');
    expect(filterContainer, 'Filter container should handle empty list gracefully').not.toBeNull();
    // E.g., it is hidden or shows a disabled state
    expect(filterContainer.style.display === 'none' || filterContainer.classList.contains('disabled')).toBe(true);
  });

  it('T2_SpecialCharacters: Search with special characters/spaces does not crash', () => {
    const searchInput = document.getElementById('campaignFilterSearch');
    expect(searchInput).not.toBeNull();
    
    // Test with typical regex tokens or special chars to verify no regex syntax crashes
    searchInput.value = 'A & [.*]!';
    expect(() => {
      searchInput.dispatchEvent(new window.Event('input'));
    }).not.toThrow();
  });

  // ==========================================
  // TIER 3: Cross-Feature Combinations
  // ==========================================

  it('T3_WizardNavigationPersistence: Filter selection survives wizard navigation', () => {
    const cbA = document.querySelector('.plan-filter-checkbox[data-name="Plan A"]');
    expect(cbA).not.toBeNull();
    cbA.checked = true;
    cbA.dispatchEvent(new window.Event('change'));
    
    // Navigate away to step wizard
    window.showWizard();
    const appWrapper = document.getElementById('appWrapper');
    expect(appWrapper.style.display).toBe('flex');
    
    // Navigate back to dashboard
    window.showDashboard();
    
    // Assert filter remains active
    expect(window.dashboardFilterState.selected).toContain('Plan A');
    const planCards = document.querySelectorAll('#plansGrid .plan-card');
    expect(planCards.length).toBe(1);
    expect(planCards[0].textContent).toContain('Plan A');
  });

  it('T3_CRUDUpdateFilter: Creating, deleting, or duplicating plans updates filter options list', () => {
    // Duplicate Plan A
    const duplicateBtn = document.querySelector('#plansGrid .plan-card[data-file-id="plan-1"] .card-actions button[title="Duplicate plan"]');
    expect(duplicateBtn, 'Duplicate button should be available').not.toBeNull();
    
    // Trigger duplicate
    duplicateBtn.dispatchEvent(new window.Event('click'));
    
    // Verify the options list now contains the copy
    const optionItemsAfterDup = Array.from(document.querySelectorAll('.filter-option-item'));
    expect(optionItemsAfterDup.some(opt => opt.textContent.includes('Plan A (copy)'))).toBe(true);
    
    // Delete Plan B
    const deleteBtn = document.querySelector('#plansGrid .plan-card[data-file-id="plan-2"] .card-actions button[title="Delete plan"]');
    expect(deleteBtn, 'Delete button should exist').not.toBeNull();
    deleteBtn.dispatchEvent(new window.Event('click'));
    
    // Verify Plan B option is removed from options
    const optionItemsAfterDel = Array.from(document.querySelectorAll('.filter-option-item'));
    expect(optionItemsAfterDel.some(opt => opt.textContent.includes('Plan B'))).toBe(false);
  });

  it('T3_SessionStateMemory: Persistence in memory (window.dashboardFilterState) across renders', () => {
    expect(window.dashboardFilterState, 'window.dashboardFilterState should exist').toBeDefined();
    
    // Select Plan B
    const cbB = document.querySelector('.plan-filter-checkbox[data-name="Plan B"]');
    cbB.checked = true;
    cbB.dispatchEvent(new window.Event('change'));
    
    expect(window.dashboardFilterState.selected).toContain('Plan B');
    
    // Call renderDashboard manually to re-render the view
    window.renderDashboard(mockPlans);
    
    // Assert filter is still applied
    const planCards = document.querySelectorAll('#plansGrid .plan-card');
    expect(planCards.length).toBe(1);
    expect(planCards[0].textContent).toContain('Plan B');
  });

  // ==========================================
  // TIER 4: Real-World Application Scenarios
  // ==========================================

  it('T4_HappyPath_SinglePlanFilter: Guest user creates 3 plans, filters for Plan A, overview and grid update to reflect only Plan A', () => {
    // 3 plans are already seeded in localStorage.
    // Select Plan A.
    const cbA = document.querySelector('.plan-filter-checkbox[data-name="Plan A"]');
    cbA.checked = true;
    cbA.dispatchEvent(new window.Event('change'));
    
    // Verify grid card displays Plan A
    const planCards = document.querySelectorAll('#plansGrid .plan-card');
    expect(planCards.length).toBe(1);
    expect(planCards[0].textContent).toContain('Plan A');
    
    // Verify overview calculations:
    // Campaigns: 1
    // Completion: 50% (since Plan A has 2 rows: 1 complete, 1 incomplete => 1/2 = 50%)
    // Budget: $10,000.00
    // Spent: $2,000.00 (Plan A rows actualSpend is 2000 + 3000 but only completed/total spent: wait, spent accumulates all rows' actualSpend?
    // Let's check plans.js: 'totalSpent += parseFloat(r.actualSpend) || 0;' so spent is 5000)
    // Remaining: 10000 - 5000 = 5000
    const overviewText = document.getElementById('overviewSection').textContent;
    expect(overviewText).toContain('1Campaigns');
    expect(overviewText).toContain('50%Completion');
    expect(overviewText).toContain('$10,000.00Total Budget');
    expect(overviewText).toContain('$5,000.00Spent');
    expect(overviewText).toContain('$5,000.00Remaining');
  });

  it('T4_HappyPath_MultiPlanFilter: Guest user filters for Plan A + B, overview shows combined totals, grid shows cards A and B', () => {
    // Select Plan A and Plan B
    const cbA = document.querySelector('.plan-filter-checkbox[data-name="Plan A"]');
    const cbB = document.querySelector('.plan-filter-checkbox[data-name="Plan B"]');
    cbA.checked = true;
    cbA.dispatchEvent(new window.Event('change'));
    cbB.checked = true;
    cbB.dispatchEvent(new window.Event('change'));
    
    // Verify grid cards
    const planCards = document.querySelectorAll('#plansGrid .plan-card');
    expect(planCards.length).toBe(2);
    
    // Verify combined overview calculations:
    // Campaigns: 2
    // Plan A rows: 2 rows (1 complete). Plan B rows: 2 rows (2 complete). Total completed: 3/4 = 75%
    // Budget: 10000 (A) + 20000 (B) = 30000
    // Spent: 5000 (A) + 10000 (B) = 15000
    // Remaining: 30000 - 15000 = 15000
    const overviewText = document.getElementById('overviewSection').textContent;
    expect(overviewText).toContain('2Campaigns');
    expect(overviewText).toContain('75%Completion');
    expect(overviewText).toContain('$30,000.00Total Budget');
    expect(overviewText).toContain('$15,000.00Spent');
    expect(overviewText).toContain('$15,000.00Remaining');
  });

  it('T4_HappyPath_AddFilterClear: Guest creates 2 plans, filters Plan A, duplicates it, selects duplicate, clears selection', () => {
    // Keep only Plan A and Plan B in localStorage
    window.localStorage.setItem('fpro_guest_plans', JSON.stringify([mockPlans[0], mockPlans[1]]));
    window.showDashboard();
    
    // Filter Plan A
    const cbA = document.querySelector('.plan-filter-checkbox[data-name="Plan A"]');
    cbA.checked = true;
    cbA.dispatchEvent(new window.Event('change'));
    expect(document.querySelectorAll('#plansGrid .plan-card').length).toBe(1);
    
    // Duplicate Plan A
    const dupBtn = document.querySelector('#plansGrid .plan-card[data-file-id="plan-1"] .card-actions button[title="Duplicate plan"]');
    dupBtn.dispatchEvent(new window.Event('click'));
    
    // Select duplicate
    const cbCopy = document.querySelector('.plan-filter-checkbox[data-name="Plan A (copy)"]');
    expect(cbCopy).not.toBeNull();
    cbCopy.checked = true;
    cbCopy.dispatchEvent(new window.Event('change'));
    
    // Grid should show both Plan A and Plan A (copy)
    expect(document.querySelectorAll('#plansGrid .plan-card').length).toBe(2);
    
    // Clear selection
    const allPlansCheckbox = document.getElementById('allPlansCheckbox');
    allPlansCheckbox.checked = true;
    allPlansCheckbox.dispatchEvent(new window.Event('change'));
    
    // Grid should now show all plans: Plan A, Plan A (copy), Plan B
    expect(document.querySelectorAll('#plansGrid .plan-card').length).toBe(3);
  });

  it('T4_UserClosesTagUpdatesTotals: User selects A + B, closes tag A, overview/grid update immediately to show only B', () => {
    // Select A + B
    const cbA = document.querySelector('.plan-filter-checkbox[data-name="Plan A"]');
    const cbB = document.querySelector('.plan-filter-checkbox[data-name="Plan B"]');
    cbA.checked = true;
    cbA.dispatchEvent(new window.Event('change'));
    cbB.checked = true;
    cbB.dispatchEvent(new window.Event('change'));
    
    // Find Plan A chip and click close
    const chipA = document.querySelector('#campaignFilterChips .filter-chip[data-name="Plan A"]');
    const closeBtnA = chipA.querySelector('.remove-chip-btn');
    closeBtnA.dispatchEvent(new window.Event('click'));
    
    // Assert only Plan B remains selected and totals reflect Plan B
    expect(window.dashboardFilterState.selected).not.toContain('Plan A');
    expect(window.dashboardFilterState.selected).toContain('Plan B');
    
    const planCards = document.querySelectorAll('#plansGrid .plan-card');
    expect(planCards.length).toBe(1);
    expect(planCards[0].textContent).toContain('Plan B');
    
    const overviewText = document.getElementById('overviewSection').textContent;
    expect(overviewText).toContain('1Campaigns');
    expect(overviewText).toContain('$20,000.00Total Budget');
  });

  it('T4_InvalidDataGracefulFallback: Plan with missing values doesn\'t crash filter calculations, uses 0 as fallback', () => {
    // Seed a plan with missing/null values
    const invalidPlan = {
      id: 'plan-invalid',
      campaignName: 'Plan Invalid',
      totalBudget: null, // missing budget
      country: 'GH',
      exchangeRate: 1.0,
      savedAt: '2026-06-11T00:00:00.000Z',
      state: {},
      planData: {
        rows: [
          { actualSpend: undefined, complete: true, _isSubtotal: false } // missing actualSpend
        ]
      }
    };
    
    window.localStorage.setItem('fpro_guest_plans', JSON.stringify([invalidPlan]));
    window.showDashboard();
    
    // Filter by Plan Invalid
    const cbInvalid = document.querySelector('.plan-filter-checkbox[data-name="Plan Invalid"]');
    expect(cbInvalid).not.toBeNull();
    
    expect(() => {
      cbInvalid.checked = true;
      cbInvalid.dispatchEvent(new window.Event('change'));
    }).not.toThrow();
    
    // Calculations should fallback to 0 instead of NaN or crashing
    const overviewText = document.getElementById('overviewSection').textContent;
    expect(overviewText).toContain('$0.00Total Budget');
    expect(overviewText).toContain('$0.00Spent');
    expect(overviewText).toContain('$0.00Remaining');
  });
});
