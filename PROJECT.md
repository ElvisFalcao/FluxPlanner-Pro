# Project: FluxPlanner-Pro Dashboard Filter Integration

## Architecture
- Vanilla HTML + JS using Tailwind CSS Play CDN (loaded in index.html).
- Main app logic in `app.js` and `plans.js`.
- Multi-select, searchable filter dropdown will be added on the dashboard page between the "Overview" heading and `#overviewSection`.
- Filter state will be tracked in a global object (e.g. `window.dashboardFilterState`) to persist during the session, surviving wizard navigation.
- E2E Test Suite will be introduced to test the filter and dashboard interactions using Vitest and JSDOM/Happy DOM.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Setup Build Tools | Initialize npm, configure Vite, install Tailwind CSS, PostCSS, Autoprefixer, set up tailwind config. | none | DONE |
| 2 | UI/UX Redesign | Redesign `index.html` and `style.css` using Tailwind utility classes. | M1 | DONE |
| 3 | Verification | Ensure JS functionality works. | M2 | DONE |
| 4 | E2E Test Suite Setup | Set up testing environment, design and write E2E tests (Tiers 1-4) in `tests/` covering filter, search, tags, overview totals, grid updates, and session persistence. | M3 | PLANNED |
| 5 | Filter UI Component Implementation | Add HTML markup for filter dropdown, search, options, tags in `index.html` and write CSS in `style.css`. | M3 | PLANNED |
| 6 | Filter Logic and State Integration | Implement search, toggle selection, tag dismissals, state persistence, and hook up logic to update overview cards and plan grid. | M5 | PLANNED |
| 7 | Final Verification & Hardening | Run all E2E tests (Tiers 1-4) and perform adversarial coverage hardening (Tier 5). | M4, M6 | PLANNED |

## Code Layout
- `index.html` - Dashboard & Wizard HTML markup.
- `app.js` - Global wizard/navigation state and helper hooks.
- `plans.js` - Dashboard logic, `renderOverview()`, and `renderDashboard()`.
- `style.css` - Custom styles and CSS variables.
- `tests/` - Directory containing E2E test files.
- `TEST_READY.md` - E2E Test suite completion and summary report.
