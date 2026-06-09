# Scope: M2 - UI/UX Redesign

## Architecture
- Refactor `index.html` to use Tailwind CSS utility classes and the `@apply` directives inside `style.css` to achieve a minimalistic, premium look.
- Use Inter and Space Grotesk fonts.
- Preserve all existing JavaScript hooks (`id`, `data-*`, and specific state classes like `active`, `completed`, `hidden` that are toggled by `app.js`).

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Redesign | Update `index.html` and `style.css` to use Tailwind. Achieve a highly premium, minimalistic dark theme. Do not convert JS `<script>` tags to `type="module"` to ensure inline handlers continue working. | M1 | DONE |

## Interface Contracts
- Must not change the function signatures or global state object in `app.js`.
- Inline `onclick` and `onchange` handlers in HTML must be preserved.
