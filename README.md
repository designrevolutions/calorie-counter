# Tally — calorie counter

A fast, private calorie counter. You keep a list of the recipes you eat regularly and log one with a single tap. Everything stays in your browser (localStorage). There's no account, no server and no build step.

## Run it

Pick one of these:

- **Just open it:** double-click `index.html`. Everything works except offline/install support.
- **Serve it** to get the installable, offline PWA:
  ```sh
  npx serve .            # or: python -m http.server 8080
  ```
  Then open the printed URL. On a phone, use the browser's "Add to Home Screen" option.

## Using it

| Top half: today | Bottom half: my recipes |
|---|---|
| Ring showing calories **left** (or **over**) against your daily goal | Your saved recipes, with search and sort (most used, recent, A–Z, kcal) |
| Eaten / goal / 7-day average | **Add to** chips (Breakfast, Lunch, Dinner, Snacks) pick the meal, defaulting to the time of day |
| 7-day bar strip with a goal line; tap a bar to view that day | **+** logs a recipe instantly, with an animated count, a "+320" pop and an undo toast |
| Food log grouped by meal, with subtotals | Tap a recipe's name to edit or delete it |

**Removing items:** press and hold a logged item, then swipe it left or right. Every removal can be undone. Other ways to remove: hover and click the bin (desktop), tap the item and choose **Remove**, or focus it and press <kbd>Delete</kbd>.

**Tap a logged item** to change its servings (¼ to 10) or move it to another meal.

**New recipes** opens a spreadsheet-style grid with **Item** and **Calories** columns:
- The item cell is multi-line. Its first line becomes the name and any further lines become notes.
- <kbd>Enter</kbd> in the calories cell moves to a new row. <kbd>Backspace</kbd> in an empty row deletes it. <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> saves.
- **Paste** straight from Excel or Google Sheets. Header rows are skipped and multi-line cells are kept. You can also paste plain lines such as `Porridge, 320`, `Gravy: 60 kcal` or `Pizza - 1,200`. A line without a number is attached as a note to the row above it.
- **Combine into one recipe** switches the grid to ingredients. You name the dish, Tally adds up the calories, and the ingredient list becomes its notes.

**Quick add** (⚡) logs a one-off number without creating a recipe. Tick the box to save it as a recipe as well.

**Settings** (⚙) covers the daily goal, theme (system, light or dark), JSON backup and restore, CSV export of the log, sample recipes, and erase all data.

**Keyboard shortcuts:** <kbd>/</kbd> search (then <kbd>Enter</kbd> adds the top match), <kbd>n</kbd> new recipes, <kbd>q</kbd> quick add, <kbd>←</kbd>/<kbd>→</kbd> previous/next day.

## Decisions

**Tech.** Plain HTML, CSS and one JavaScript file, with no framework or bundler. The app is small enough that a framework would add more weight than it saves, and "open the file and it works" is the simplest possible way to run it. State is a single object saved to `localStorage` under `tally:v1`, and small render functions redraw only the section that changed.

**Data model.** Log entries store a *snapshot* of the recipe's name and kcal. If you edit or delete a recipe later, your history doesn't change. Stored data is normalised on load, so a corrupt or hand-edited backup can't break the app.

**localStorage safety nets.** localStorage can be wiped by the browser or the user, so the app does four things:
- JSON backup and restore, and a footer link pointing to it.
- A request for persistent storage (`navigator.storage.persist()`).
- Syncing between tabs via the `storage` event.
- A toast if a save fails.

**Gesture.** The brief asked for hold-then-swipe, and that turns out to be the right call. Requiring a 220 ms hold first means scrolling the list can never delete anything by accident. Rows use `touch-action: pan-y`, so vertical scrolling stays native. Long-press menus and text selection are suppressed on the rows.

**Recipe order is stable while you tap.** "Most used" re-sorts on the next render, not under your finger, so tapping + three times doesn't make rows jump around.

**Design.** The palette is a warm paper neutral with one green accent. Amber is used only for "over goal", and always comes with a text label so it's never colour alone. The dark theme has its own colour values rather than an automatic inversion. Numbers use tabular figures so they don't shift as they count up. Dialogs are bottom sheets on phones and centred dialogs on desktop. Motion is respected: `prefers-reduced-motion` turns animations off. Native `<dialog>` handles focus trapping and <kbd>Esc</kbd>. Forced-colours mode is supported.

**Day handling.** Days are keyed by local date (`YYYY-MM-DD`). If the app is left open past midnight, it rolls over to the new day. You can browse and log on past days, but not future ones.

## Research and what I added

I looked at how MyFitnessPal, Lose It! and Cronometer handle the core loop, and borrowed the patterns that apply to a recipe-first, local-only v1:

| Pattern seen | Where | In Tally |
|---|---|---|
| "Calories remaining" is the hero number on the home screen | MyFitnessPal | Ring shows **left/over**, not just eaten |
| Four meal slots: breakfast, lunch, dinner, snacks | MyFitnessPal | Meal chips that default to the time of day; log grouped by meal |
| Quick add a bare calorie number | MyFitnessPal, Cronometer (a common request) | ⚡ Quick add, optionally saved as a recipe |
| Saved meals reused as one entry | MyFitnessPal, Lose It! | "Combine into one recipe" mode in the grid |
| Daily budget plus weekly reports | Lose It! | Daily goal plus a 7-day strip and average |
| Common complaint: busy, cluttered UI | Lose It! reviews | One screen, one accent colour, details tucked into sheets |

Things I deliberately **left out of v1**:
- A food database or barcode scanning, which would need a backend or API.
- Macros, which would make recipe entry slower.
- Exercise calories and weight tracking, which are good v2 candidates.
- Accounts and sync, which are out of scope with localStorage only.

## Files

```
index.html             markup, dialogs
styles.css             design tokens (light/dark), layout, motion
app.js                 state, rendering, gestures, paste parsing, dialogs
sw.js                  offline cache (network-first)
manifest.webmanifest   PWA install metadata
icons/                 app icons
planning/              notes
```
