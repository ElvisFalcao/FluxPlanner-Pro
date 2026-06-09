# Handoff Report: Setup Build Tools (M1)

## Observation
1. The project is a vanilla web application located in `C:\Users\denyf\Documents\Antigravity\My Campaign Planner`.
2. The `index.html` currently loads styling via a standard `<link rel="stylesheet" href="style.css" />` and scripts sequentially at the bottom:
   - `<script src="data.js"></script>`
   - `<script src="budget-engine.js"></script>`
   - `<script src="export.js"></script>`
   - `<script src="app.js"></script>`
3. `data.js`, `budget-engine.js`, `export.js`, and `app.js` declare variables and functions in the global scope (e.g., `const COUNTRY_DATA` in `data.js` and `function calcActivationBudgets` in `budget-engine.js`).
4. `index.html` relies on inline event handlers (e.g., `onclick="goToStep(1)"`, `onchange="onCountryChange()"`, `onclick="exportExcel()"`).
5. No `package.json`, `vite.config.js`, `tailwind.config.js`, or `postcss.config.js` currently exists in the root directory.

## Logic Chain
1. To satisfy M1 ("Initialize npm, configure Vite, install Tailwind CSS..."), we must introduce a `package.json` and install the required tools (`vite`, `tailwindcss`, `postcss`, `autoprefixer`).
2. Vite expects a modern ES module approach for optimal bundling and Hot Module Replacement (HMR).
3. Moving to Vite means replacing the individual synchronous script tags in `index.html` with a single `<script type="module" src="/app.js"></script>`.
4. However, using `type="module"` encapsulates the code, meaning functions like `goToStep` and variables like `COUNTRY_DATA` will no longer be attached to the global `window` object automatically.
5. Because `index.html` uses inline event handlers (e.g., `onclick="goToStep(1)"`), we must either refactor HTML to use `addEventListener` or simply attach the required functions to the global `window` object within `app.js` (e.g., `window.goToStep = goToStep`). Attaching to `window` satisfies the constraint to "Preserve existing JS logic" with minimal refactoring.
6. The JS files must be updated to use `export` and `import` statements to share logic, allowing Vite to bundle them correctly.
7. Tailwind requires `tailwind.config.js` with paths to all HTML and JS files in the `content` array so it can generate the utility classes. The M2 UI/UX redesign also mentions 'Inter' and 'Space Grotesk' fonts, which should be pre-configured in `tailwind.config.js`.
8. Tailwind directives (`@tailwind base; @tailwind components; @tailwind utilities;`) need to be injected, typically at the top of `style.css`. `style.css` should also be imported into `app.js` (e.g. `import './style.css';`) so Vite processes the CSS.
9. `postcss.config.js` must be created to process Tailwind and Autoprefixer during Vite's build step.

## Caveats
- Refactoring the JS files into ES modules requires adding `export` and `import` across `data.js`, `budget-engine.js`, and `export.js`. This is a small but necessary modification to the JS structure.
- All functions invoked from `index.html` inline events must be explicitly mapped to the `window` object in `app.js` to avoid runtime errors when Vite bundles them into a module.
- The `npm init` and installation steps are recommended but cannot be tested by this explorer agent due to execution constraints.

## Conclusion
The recommended strategy to implement M1 is:
1. Create a `package.json` with `vite`, `tailwindcss`, `postcss`, `autoprefixer` as devDependencies, and `dev`/`build` scripts.
2. Create `vite.config.js` (default config), `postcss.config.js` (enabling tailwindcss/autoprefixer), and `tailwind.config.js` (scanning `./*.html` and `./*.js`, extending fonts 'Inter' and 'Space Grotesk').
3. Update `style.css` to include the `@tailwind` directives.
4. Refactor JS files to ES modules:
   - Add `export` to definitions in `data.js`, `budget-engine.js`, `export.js`.
   - `import` these dependencies at the top of `app.js` and other files as needed.
   - `import './style.css';` at the top of `app.js` so Vite builds it.
   - Attach all inline-invoked functions (e.g., `goToStep`, `exportExcel`, `onCountryChange`, `addActivation`, etc.) to the `window` object in `app.js`.
5. Update `index.html` to load a single script: `<script type="module" src="./app.js"></script>` and remove the `<link rel="stylesheet">` (since it's imported in `app.js`).

## Verification Method
1. Run `npm install` (or verify that dependencies are installed).
2. Run `npm run dev`, verify that the server starts, and the application loads without console errors. Clicking buttons (e.g., changing tabs, adding activations) must function normally.
3. Run `npm run build`, verify that the `dist/` directory is created, containing bundled JS, CSS, and HTML.
