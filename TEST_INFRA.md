# Test Infrastructure Documentation

This document describes the test infrastructure, methodology, and test cases implemented for the FluxPlanner-Pro redesign campaign filter feature.

## Architecture Overview

To achieve reliable E2E integration testing without running a live server or database:
1. **Test Runner**: [Vitest](https://vitest.dev/) is used for its fast execution, powerful mocking, and modern ESM-first architecture.
2. **DOM Emulation**: [JSDOM](https://github.com/jsdom/jsdom) is used to load and parse `index.html` and simulate a classic browser environment.
3. **Execution Mode**: Classic sequential scripts (`config.js`, `data.js`, `budget-engine.js`, `export.js`, `plans.js`, `accounts.js`, `app.js`) are read using `fs.readFileSync` and evaluated using JSDOM's `window.eval`. This maintains the browser's global scope and avoids scope isolation issues of ES modules.
4. **Lifecycle Simulation**: Since JSDOM finishes DOM parsing before the script evaluation, `DOMContentLoaded` listeners must be manually fired on `document` via:
   ```js
   const event = new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true });
   document.dispatchEvent(event);
   ```

## Sandbox and Mocking Strategy

The following components are mocked to ensure zero-network, zero-side-effect test execution:

### 1. Supabase Client
A complete mock of the Supabase Client API is attached to `window.supabase`. It supports:
- Authentication mocks (`signInWithPassword`, `signUp`, `signOut`, `getSession`, `getUser`)
- Database operations (`from().select()`, `eq()`, `single()`, `insert()`, `update()`, `delete()`)
- Storage mocks (`storage.from().upload()`, `getPublicUrl()`)

### 2. Google Identity Services & APIs
To prevent attempts to load remote scripts or authenticate with real Google servers:
- `window.google` and `window.google.accounts.oauth2` are mocked.
- `window.gapi` and `window.gapi.client` are mocked.

### 3. SheetJS (XLSX)
For the Excel/CSV export features:
- `window.XLSX` is mocked with functions like `book_new`, `aoa_to_sheet`, and `writeFile`.

### 4. LocalStorage
A memory-based mockup of `window.localStorage` is injected before script evaluation to support plan storage operations and guest login sessions.

### 5. Layout and Scopes
- `window.scrollTo` and `window.alert` are mocked to avoid JSDOM errors.

---

## Test Inventory (Tiers 1-4)

The test suite contains **18 test cases** divided into four tiers:

### Tier 1: Feature Coverage (Core UI & Logic)
1. `T1_SearchFiltering`: Typing in the search input filters option list in real-time.
2. `T1_CheckboxSelection`: Selecting plans via checkboxes updates selection state.
3. `T1_DismissibleTags`: Clicking 'x' on a chip removes it from selection.
4. `T1_AllPlansOption`: "All Plans" clears individual selections and shows all plans.
5. `T1_DynamicDashboardUpdate`: Totals in `#overviewSection` and plan cards in `#plansGrid` update on selection change.

### Tier 2: Boundary & Corner Cases
6. `T2_EmptySearchMatches`: Non-matching search shows "No matching plans".
7. `T2_MultiplePrefixMatches`: Prefix matching multiple plans lists them correctly.
8. `T2_SelectAllManually`: Manually checking all plans' checkboxes acts as showing all plans.
9. `T2_NoSavedPlans`: Behaves gracefully when there are no saved plans (hides/handles gracefully).
10. `T2_SpecialCharacters`: Search with special characters/spaces does not crash.

### Tier 3: Cross-Feature Combinations
11. `T3_WizardNavigationPersistence`: Filter selection survives wizard navigation.
12. `T3_CRUDUpdateFilter`: Creating, deleting, or duplicating plans updates filter options list.
13. `T3_SessionStateMemory`: Persistence in memory (`window.dashboardFilterState`) across renders.

### Tier 4: Real-World Application Scenarios
14. `T4_HappyPath_SinglePlanFilter`: Guest user creates 3 plans, filters for Plan A, overview and grid update to reflect only Plan A.
15. `T4_HappyPath_MultiPlanFilter`: Guest user filters for Plan A + B, overview shows combined totals, grid shows cards A and B.
16. `T4_HappyPath_AddFilterClear`: Guest creates 2 plans, filters Plan A, duplicates it, selects duplicate, clears selection.
17. `T4_UserClosesTagUpdatesTotals`: User selects A + B, closes tag A, overview/grid update immediately to show only B.
18. `T4_InvalidDataGracefulFallback`: Plan with missing values doesn't crash filter calculations, uses 0 as fallback.

---

## Test Execution

To execute the test suite:
```bash
npm test
```
