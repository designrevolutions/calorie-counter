# CLAUDE.md

## Git workflow

- After completing a set of tasks, commit the changes and push to `origin` without waiting to be asked.
- Use one commit per logical set of changes, with a clear message summarising what changed and why.
- Commit directly to `main` (solo project, no PR flow).
- Never force-push, rewrite published history, or skip hooks.
- Don't commit test scratch files, browser profiles or screenshots. Those belong outside the repo.

## Project notes

- Static app with no build step: `index.html`, `styles.css`, `app.js`, plus `sw.js` for offline support. Open `index.html` directly, or serve the folder (`npx serve .`) for PWA features.
- All data lives in `localStorage` under the key `tally:v1`. Keep `normalise()` in `app.js` backward-compatible when changing the data shape.
- When shipped files change, bump `VERSION` in `sw.js` and the `?v=` query on `styles.css` and `app.js` in `index.html`, and update the matching entries in `ASSETS` in `sw.js`. Otherwise phones (iOS Chrome especially) keep serving stale files.
- Check layouts at 320–430px wide. There must be no horizontal page scroll, and form fields must stay ≥16px on touch screens (iOS zooms on smaller ones). `?debug` in the URL outlines anything wider than the screen.
