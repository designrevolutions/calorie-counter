/* =========================================================
   Tally — a local-first calorie counter.
   No build step, no framework: state lives in one object that
   is persisted to localStorage, and small render functions
   redraw the parts of the page that changed.
   ========================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'tally:v1';
  const MEALS = [
    { id: 'breakfast', label: 'Breakfast' },
    { id: 'lunch', label: 'Lunch' },
    { id: 'dinner', label: 'Dinner' },
    { id: 'snack', label: 'Snacks' },
  ];
  const MAX_KCAL = 20000;
  const RING_R = 86;
  const RING_C = 2 * Math.PI * RING_R;

  const SAMPLE_RECIPES = [
    ['Porridge with banana\n50g oats, semi-skimmed milk, 1 banana', 340],
    ['Scrambled eggs on toast\n2 eggs, 1 slice wholemeal, a little butter', 380],
    ['Greek yoghurt & berries\n150g 0% yoghurt, blueberries, drizzle of honey', 210],
    ['Chicken Caesar salad', 520],
    ['Tuna & sweetcorn sandwich\nWholemeal bread, light mayo', 450],
    ['Spaghetti bolognese\n100g dry pasta, lean beef mince', 680],
    ['Chicken stir-fry with rice', 610],
    ['Flat white\nSemi-skimmed milk', 120],
    ['Apple', 80],
    ['Almonds\n30g handful', 175],
    ['Dark chocolate\n2 squares, 70%', 110],
  ];
  const SAMPLE_EXERCISES = [
    ['Brisk walk\n30 minutes', 150],
    ['Run\n5 km, easy pace', 350],
    ['Cycling\n45 minutes, moderate', 400],
    ['Gym session\n1 hour, weights', 300],
    ['Swim\n30 minutes', 250],
    ['Yoga\n45 minutes', 150],
    ['Football\n1 hour', 500],
  ];
  const EXERCISE = 'exercise';
  const KIND = {
    food: { plural: 'recipes', one: 'recipe', title: 'My recipes', search: 'Search recipes', col: 'Calories', placeholder: 'e.g. Porridge with banana' },
    exercise: { plural: 'exercises', one: 'exercise', title: 'My exercises', search: 'Search exercises', col: 'Burned', placeholder: 'e.g. Morning run' },
  };

  /* ---------------- helpers ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const fmt = (n) => Math.round(n).toLocaleString();
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function dateKey(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function parseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(key, n) {
    const d = parseKey(key);
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }
  function dayLabel(key) {
    const today = dateKey();
    if (key === today) return 'Today';
    if (key === addDays(today, -1)) return 'Yesterday';
    return parseKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function longDate(key) {
    return parseKey(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function defaultMeal(d = new Date()) {
    const h = d.getHours() + d.getMinutes() / 60;
    if (h < 10.5) return 'breakfast';
    if (h < 14.5) return 'lunch';
    if (h < 17) return 'snack';
    if (h < 21.5) return 'dinner';
    return 'snack';
  }
  const mealLabel = (id) => (id === EXERCISE ? 'Exercise' : (MEALS.find((m) => m.id === id) || MEALS[3]).label);

  /** A recipe's text: first line is its name, the rest are notes. */
  function splitText(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const title = lines.shift().trim();
    const notes = lines.map((l) => l.trim()).filter(Boolean).join('\n');
    return { title, notes };
  }

  /** Parse a calorie value typed or pasted by a human: "1,200", "320 kcal", "85.5". */
  function parseKcal(v) {
    if (v == null) return null;
    const s = String(v).trim().replace(/k?cals?|kcal|calories/gi, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.').trim();
    if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Math.round(parseFloat(s));
    return n >= 0 && n <= MAX_KCAL ? n : null;
  }

  /* ---------------- persistence ---------------- */
  function freshState() {
    return { version: 1, settings: { goal: 2000, theme: 'system', sort: 'frequent' }, recipes: [], log: {} };
  }
  function normalise(data) {
    const base = freshState();
    if (!data || typeof data !== 'object') return base;
    const settings = Object.assign(base.settings, data.settings || {});
    settings.goal = clamp(parseInt(settings.goal, 10) || 2000, 500, 10000);
    const recipes = (Array.isArray(data.recipes) ? data.recipes : [])
      .filter((r) => r && typeof r.text === 'string' && Number.isFinite(+r.kcal))
      .map((r) => ({ id: r.id || uid(), kind: r.kind === EXERCISE ? EXERCISE : 'food', text: r.text, kcal: Math.round(+r.kcal), uses: +r.uses || 0, lastUsed: +r.lastUsed || 0, createdAt: +r.createdAt || Date.now() }));
    const log = {};
    if (data.log && typeof data.log === 'object') {
      for (const [k, list] of Object.entries(data.log)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(list)) continue;
        const clean = list
          .filter((e) => e && Number.isFinite(+e.kcal))
          .map((e) => {
            const burn = e.kind === EXERCISE || e.meal === EXERCISE;
            return { id: e.id || uid(), kind: burn ? EXERCISE : 'food', recipeId: e.recipeId || null, name: String(e.name || 'Item'), kcal: Math.round(+e.kcal), servings: +e.servings > 0 ? +e.servings : 1, meal: burn ? EXERCISE : MEALS.some((m) => m.id === e.meal) ? e.meal : 'snack', at: +e.at || 0 };
          });
        if (clean.length) log[k] = clean;
      }
    }
    return { version: 1, settings, recipes, log };
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalise(JSON.parse(raw));
    } catch (e) { /* corrupted or blocked — start fresh */ }
    return freshState();
  }
  let persistRequested = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (!persistRequested && navigator.storage && navigator.storage.persist) {
        persistRequested = true;
        navigator.storage.persist().catch(() => {});
      }
      return true;
    } catch (e) {
      toast('Couldn’t save. Browser storage is full or blocked.');
      return false;
    }
  }

  let state = loadState();
  const ui = {
    date: dateKey(),
    today: dateKey(),
    meal: defaultMeal(),
    mealPicked: false,
    search: '',
    tab: 'food',
    newKind: 'food',
    report: { period: 'week', anchor: dateKey() },
    justAdded: null,
    newRecipeIds: new Set(),
    shown: { eaten: 0, burned: 0, remaining: state.settings.goal },
  };

  /* ---------------- derived data ---------------- */
  const entriesFor = (key) => state.log[key] || [];
  const entryKcal = (e) => Math.round(e.kcal * e.servings);
  const isBurn = (e) => e.kind === EXERCISE;
  const dayFood = (key) => entriesFor(key).reduce((s, e) => s + (isBurn(e) ? 0 : entryKcal(e)), 0);
  const dayBurn = (key) => entriesFor(key).reduce((s, e) => s + (isBurn(e) ? entryKcal(e) : 0), 0);
  /** Net calories: food eaten minus exercise burned. This is what counts against the goal. */
  const dayNet = (key) => dayFood(key) - dayBurn(key);
  const recipeById = (id) => state.recipes.find((r) => r.id === id);
  const kindOf = (r) => (r.kind === EXERCISE ? EXERCISE : 'food');

  /* =========================================================
     Rendering
     ========================================================= */
  const els = {
    dayLabel: $('#day-label'), prev: $('#prev-day'), next: $('#next-day'), goToday: $('#go-today'),
    ring: $('#ring'), ringFill: $('#ring-fill'), ringOver: $('#ring-over'), ringPop: $('#ring-pop'),
    remaining: $('#remaining-value'), remainingCap: $('#remaining-caption'),
    eaten: $('#eaten-value'), goal: $('#goal-value'), burned: $('#burned-value'),
    week: $('#week-plot'), log: $('#log'),
    mealPicker: $('#meal-picker'), search: $('#recipe-search'), sort: $('#recipe-sort'),
    recipeList: $('#recipe-list'), recipeCount: $('#recipe-count'),
    recipesTitle: $('#recipes-title'), newLabel: $('#new-label'), tabs: $('#kind-tabs'),
    toast: $('#toast'), toastMsg: $('#toast-msg'), toastAction: $('#toast-action'),
  };

  els.ringFill.style.strokeDasharray = RING_C;
  els.ringOver.style.strokeDasharray = RING_C;
  els.ringFill.style.strokeDashoffset = RING_C;
  els.ringOver.style.strokeDashoffset = RING_C;

  function tween(el, from, to, key) {
    if (from === to || reducedMotion()) { el.textContent = fmt(to); ui.shown[key] = to; return; }
    const start = performance.now();
    const dur = 650;
    const id = (el._tween = (el._tween || 0) + 1);
    function step(now) {
      if (el._tween !== id) return;
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    ui.shown[key] = to;
  }

  function renderHeader() {
    const isToday = ui.date === ui.today;
    els.dayLabel.textContent = dayLabel(ui.date);
    els.dayLabel.title = longDate(ui.date);
    els.next.disabled = isToday;
    els.goToday.hidden = isToday;
  }

  function renderSummary() {
    const goal = state.settings.goal;
    const eaten = dayFood(ui.date);
    const burned = dayBurn(ui.date);
    const net = eaten - burned;
    const remaining = goal - net;
    const pct = goal > 0 ? Math.max(0, net) / goal : 0;

    els.ringFill.style.strokeDashoffset = RING_C * (1 - Math.min(pct, 1));
    els.ringOver.style.strokeDashoffset = RING_C * (1 - clamp(pct - 1, 0, 1));
    els.ring.classList.toggle('is-over', remaining < 0);
    els.remainingCap.textContent = remaining < 0 ? 'over' : 'left';
    els.ring.setAttribute('aria-label',
      `${fmt(eaten)} calories eaten${burned ? ', ' + fmt(burned) + ' burned' : ''}, goal ${fmt(goal)}. ${remaining < 0 ? fmt(-remaining) + ' over goal' : fmt(remaining) + ' left'}.`);

    tween(els.remaining, Math.abs(ui.shown.remaining), Math.abs(remaining), 'remaining');
    ui.shown.remaining = remaining;
    tween(els.eaten, ui.shown.eaten, eaten, 'eaten');
    tween(els.burned, ui.shown.burned, burned, 'burned');
    els.goal.textContent = fmt(goal);
  }

  function weekWindow() {
    // Show the 7 days ending today, unless the selected day is older than that.
    const end = ui.date > addDays(ui.today, -7) ? ui.today : addDays(ui.date, 3) > ui.today ? ui.today : addDays(ui.date, 3);
    return Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  }

  /**
   * Draw one bar per day (net calories) with a dashed goal line. Shared by the
   * 7-day strip and the reports. Bars are buttons that open that day.
   */
  function renderBars(plot, days, { dense = false, selected = ui.date } = {}) {
    const goal = state.settings.goal;
    const nets = days.map((k) => Math.max(0, dayNet(k)));
    const max = Math.max(goal * 1.15, ...nets) || 1;
    const n = days.length;
    plot.classList.toggle('week__plot--dense', dense);
    plot.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;

    plot.innerHTML = days.map((key, i) => {
      const d = parseKey(key);
      const food = dayFood(key), burn = dayBurn(key), net = food - burn;
      const logged = entriesFor(key).length > 0;
      const future = key > ui.today;
      const diff = goal - net;
      const status = future ? 'Upcoming' : !logged ? 'Nothing logged' : diff < 0 ? `${fmt(-diff)} over` : `${fmt(diff)} under`;
      const cls = ['day', key === selected && 'is-selected', key === ui.today && 'is-today', !logged && 'is-empty',
        logged && net > goal && 'is-over', future && 'is-future', i < n * 0.3 ? 'tip-l' : i >= n * 0.7 ? 'tip-r' : ''].filter(Boolean).join(' ');
      const dow = d.toLocaleDateString(undefined, { weekday: 'narrow' });
      const num = d.getDate();
      // In month view, label sparsely so the numbers stay legible.
      const showNum = !dense || num === 1 || num % 7 === 1 || i === n - 1;
      const detail = logged ? `${fmt(net)} kcal net${burn ? ` (${fmt(food)} food − ${fmt(burn)} exercise)` : ''}, ${status}` : status;
      return `<button class="${cls}" data-day="${key}" aria-label="${esc(longDate(key))}: ${esc(detail)}" ${key === selected ? 'aria-current="date"' : ''} ${future ? 'tabindex="-1" disabled' : ''}>
        <span class="day__track"><span class="day__bar" style="height:${logged && net > 0 ? Math.max(4, (net / max) * 100) : 0}%"></span></span>
        <span class="day__label" aria-hidden="true">${dense ? '' : `<span class="day__dow">${esc(dow)}</span>`}<span class="day__num">${showNum ? num : ''}</span></span>
        <span class="day__tip" aria-hidden="true">${esc(dayLabel(key))} <em>· ${logged ? fmt(net) + ' kcal, ' + status : status}</em></span>
      </button>`;
    }).join('') + `<div class="week__goal" aria-hidden="true"></div><span class="week__legend" aria-hidden="true"><i></i>Goal ${fmt(goal)}</span>`;

    // Position the goal line in the bars' coordinate space.
    const track = $('.day__track', plot);
    const line = $('.week__goal', plot);
    if (track && line) {
      const plotBox = plot.getBoundingClientRect();
      const trackBox = track.getBoundingClientRect();
      line.style.bottom = `${plotBox.bottom - trackBox.bottom + trackBox.height * (goal / max)}px`;
    }
  }

  function renderWeek() {
    const days = weekWindow();
    const fmtShort = (k) => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    $('#week-title').textContent = days[6] === ui.today ? 'Last 7 days' : `${fmtShort(days[0])} – ${fmtShort(days[6])}`;
    renderBars(els.week, days);
  }

  const ICON_TRASH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  const ICON_PLUS = '<svg class="i-plus" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const ICON_CHECK = '<svg class="i-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function renderLog() {
    const entries = entriesFor(ui.date);
    $('#quick-row-end').hidden = !entries.length;
    if (!entries.length) {
      const isToday = ui.date === ui.today;
      els.log.innerHTML = `<div class="empty">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11h18M5 11a7 7 0 0 0 14 0M9 4c0 1.5 1 1.5 1 3M13 3c0 1.5 1 1.5 1 3"/></svg>
        <strong>${isToday ? 'Nothing logged yet today' : 'Nothing logged on this day'}</strong>
        <p>${state.recipes.length ? 'Tap <b>+</b> next to a recipe below to log it.' : 'Add a few recipes you eat often, then log them with one tap.'}</p>
      </div>`;
      return;
    }
    const groups = [...MEALS, { id: EXERCISE, label: 'Exercise' }]
      .map((m) => ({ ...m, items: entries.filter((e) => e.meal === m.id) })).filter((g) => g.items.length);
    els.log.innerHTML = groups.map((g) => {
      const burn = g.id === EXERCISE;
      const sum = g.items.reduce((s, e) => s + entryKcal(e), 0);
      return `
      <div class="meal-group">
        <div class="meal-group__head"><span>${g.label}</span><span>${burn ? '−' : ''}${fmt(sum)} kcal</span></div>
        <ul class="entries" aria-label="${g.label}">
          ${g.items.map((e) => {
            const time = e.at ? new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const meta = [e.servings !== 1 ? `${e.servings} × ${fmt(e.kcal)}` : null, !e.recipeId ? 'Quick add' : null, time].filter(Boolean).join(' · ');
            return `<li class="entry${burn ? ' entry--burn' : ''}${e.id === ui.justAdded ? ' is-new' : ''}" data-id="${e.id}">
              <div class="entry__bg" aria-hidden="true"><span>${ICON_TRASH} Remove</span><span>Remove ${ICON_TRASH}</span></div>
              <div class="entry__fg">
                <button class="entry__open" data-open="${e.id}" aria-label="${esc(e.name)}, ${fmt(entryKcal(e))} calories ${burn ? 'burned' : ''}${e.servings !== 1 ? ', ' + e.servings + ' × ' + fmt(e.kcal) : ''}. Edit">
                  <span class="entry__main"><span class="entry__name">${esc(e.name)}</span><span class="entry__meta">${esc(meta)}</span></span>
                  <span class="entry__kcal">${burn ? '−' : ''}${fmt(entryKcal(e))}<small>kcal</small></span>
                </button>
                <button class="icon-btn entry__del" data-del="${e.id}" aria-label="Remove ${esc(e.name)}">${ICON_TRASH}</button>
              </div>
            </li>`;
          }).join('')}
        </ul>
      </div>`;
    }).join('');
    ui.justAdded = null;
  }

  function renderMealPicker(container, selected, withLead, withExercise) {
    const opts = withExercise ? [...MEALS, { id: EXERCISE, label: 'Exercise' }] : MEALS;
    container.innerHTML = (withLead ? '<span class="meal-picker__lead" aria-hidden="true">Add to</span>' : '') +
      opts.map((m) => `<button type="button" class="meal-opt" role="radio" data-meal="${m.id}" aria-checked="${m.id === selected}" tabindex="${m.id === selected ? 0 : -1}">${m.label}</button>`).join('');
  }

  function highlight(text, q) {
    if (!q) return esc(text);
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    return text.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
  }

  function sortedRecipes() {
    const q = ui.search.trim().toLowerCase();
    let list = state.recipes.filter((r) => kindOf(r) === ui.tab && (!q || r.text.toLowerCase().includes(q)));
    const by = {
      frequent: (a, b) => b.uses - a.uses || b.lastUsed - a.lastUsed || a.text.localeCompare(b.text),
      recent: (a, b) => b.lastUsed - a.lastUsed || b.createdAt - a.createdAt,
      az: (a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }),
      low: (a, b) => a.kcal - b.kcal,
      high: (a, b) => b.kcal - a.kcal,
    }[state.settings.sort] || (() => 0);
    return list.slice().sort(by);
  }

  function renderTabs() {
    const k = KIND[ui.tab];
    $$('[role="tab"]', els.tabs).forEach((t) => {
      const on = t.dataset.kind === ui.tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    els.recipesTitle.textContent = k.title;
    els.newLabel.textContent = `New ${k.plural}`;
    els.search.placeholder = k.search;
    $('.search .sr-only').textContent = k.search;
    els.mealPicker.hidden = ui.tab === EXERCISE;
  }

  function renderRecipes() {
    const k = KIND[ui.tab];
    const n = state.recipes.filter((r) => kindOf(r) === ui.tab).length;
    els.recipeCount.textContent = n ? `${n} saved ${n === 1 ? k.one : k.plural}` : 'None saved yet';
    els.sort.value = state.settings.sort;
    if (!n) {
      const food = ui.tab === 'food';
      els.recipeList.innerHTML = `<li class="empty">
        ${food ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5"/></svg>'
               : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/></svg>'}
        <strong>${food ? 'Build your recipe list' : 'Add your usual workouts'}</strong>
        <p>${food ? 'Add the meals and snacks you eat regularly. Paste a whole list from a spreadsheet if you have one.'
                  : 'Save the exercise you do often with the calories it burns. Logging one gives those calories back to your day.'}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
          <button class="btn btn--primary btn--sm" data-action="new">New ${k.plural}</button>
          <button class="btn btn--ghost btn--sm" data-action="samples">Try sample ${k.plural}</button>
        </div>
      </li>`;
      return;
    }
    const list = sortedRecipes();
    const q = ui.search.trim();
    if (!list.length) {
      els.recipeList.innerHTML = `<li class="no-results">No ${k.plural} match “${esc(q)}”.<br><button class="btn btn--ghost btn--sm" style="margin-top:10px" data-action="new-from-search">Create “${esc(q)}”</button></li>`;
      return;
    }
    const mealName = ui.tab === EXERCISE ? 'today' : mealLabel(ui.meal);
    els.recipeList.innerHTML = list.map((r) => {
      const { title, notes } = splitText(r.text);
      return `<li class="recipe${ui.newRecipeIds.has(r.id) ? ' is-new' : ''}">
        <button class="recipe__main" data-edit="${r.id}">
          <span class="recipe__name">${highlight(title, q)}</span>
          ${notes ? `<span class="recipe__notes">${highlight(notes, q)}</span>` : ''}
          <span class="sr-only">, ${fmt(r.kcal)} calories. Edit recipe</span>
        </button>
        <span class="recipe__kcal" aria-hidden="true">${fmt(r.kcal)}<small>kcal</small></span>
        <button class="add-btn" data-add="${r.id}" aria-label="Add ${esc(title)} to ${mealName}">${ICON_PLUS}${ICON_CHECK}</button>
      </li>`;
    }).join('');
    ui.newRecipeIds.clear();
  }

  function renderAll() {
    renderHeader();
    renderSummary();
    renderWeek();
    renderLog();
    renderMealPicker(els.mealPicker, ui.meal, true);
    renderTabs();
    renderRecipes();
    if ($('#dlg-reports').open) renderReport();
  }

  /* =========================================================
     Toast (with undo)
     ========================================================= */
  let toastTimer = null;
  let toastHandler = null;
  function toast(msg, opts = {}) {
    clearTimeout(toastTimer);
    els.toastMsg.textContent = msg;
    toastHandler = opts.onAction || null;
    els.toastAction.hidden = !toastHandler;
    els.toastAction.textContent = opts.action || 'Undo';
    els.toast.hidden = false;
    // restart the entrance animation
    els.toast.style.animation = 'none';
    void els.toast.offsetWidth;
    els.toast.style.animation = '';
    toastTimer = setTimeout(hideToast, opts.duration || (toastHandler ? 6000 : 3200));
  }
  function hideToast() { els.toast.hidden = true; toastHandler = null; }
  els.toastAction.addEventListener('click', () => { const h = toastHandler; hideToast(); if (h) h(); });

  /* =========================================================
     Actions
     ========================================================= */
  function addRecipeToLog(recipe, btn) {
    const { title } = splitText(recipe.text);
    const burn = kindOf(recipe) === EXERCISE;
    const entry = { id: uid(), kind: kindOf(recipe), recipeId: recipe.id, name: title, kcal: recipe.kcal, servings: 1, meal: burn ? EXERCISE : ui.meal, at: Date.now() };
    (state.log[ui.date] = state.log[ui.date] || []).push(entry);
    recipe.uses += 1;
    recipe.lastUsed = Date.now();
    if (!save()) return;

    ui.justAdded = entry.id;
    renderSummary();
    renderWeek();
    renderLog();
    pop(burn ? `−${fmt(recipe.kcal)}` : `+${fmt(recipe.kcal)}`, burn);

    if (btn) {
      btn.classList.remove('is-done');
      void btn.offsetWidth;
      btn.classList.add('is-done');
      clearTimeout(btn._t);
      btn._t = setTimeout(() => btn.classList.remove('is-done'), 1100);
    }
    if (navigator.vibrate) navigator.vibrate(8);

    const left = state.settings.goal - dayNet(ui.date);
    const where = ui.date === ui.today ? mealLabel(entry.meal) : `${mealLabel(entry.meal)}, ${dayLabel(ui.date)}`;
    const date = ui.date;
    toast(`${burn ? 'Logged' : 'Added'} ${title}${burn ? (ui.date === ui.today ? '' : ` on ${dayLabel(ui.date)}`) : ` to ${where}`} · ${left >= 0 ? fmt(left) + ' left' : fmt(-left) + ' over'}`, {
      onAction: () => {
        recipe.uses = Math.max(0, recipe.uses - 1);
        removeEntry(entry.id, { silent: true, date });
      },
    });
  }

  function pop(text, negative) {
    const el = els.ringPop;
    el.textContent = text;
    el.classList.toggle('is-neg', !!negative);
    el.classList.remove('is-anim');
    void el.offsetWidth;
    el.classList.add('is-anim');
  }

  function removeEntry(id, opts = {}) {
    const date = opts.date || ui.date;
    const list = entriesFor(date);
    const idx = list.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const [entry] = list.splice(idx, 1);
    if (!list.length) delete state.log[date];
    save();
    renderSummary();
    renderWeek();
    renderLog();
    if (!opts.silent) pop(isBurn(entry) ? `+${fmt(entryKcal(entry))}` : `−${fmt(entryKcal(entry))}`, !isBurn(entry));
    if (opts.silent) { hideToast(); return; }
    toast(`Removed ${entry.name}`, {
      onAction: () => {
        const l = (state.log[date] = state.log[date] || []);
        l.splice(Math.min(idx, l.length), 0, entry);
        save();
        if (ui.date !== date) ui.date = date;
        ui.justAdded = entry.id;
        renderAll();
      },
    });
  }

  /** Animate a log row's height to zero, then run cb. */
  function collapse(li, cb) {
    if (reducedMotion()) return cb();
    li.style.height = li.offsetHeight + 'px';
    void li.offsetHeight;
    li.classList.add('is-collapsing');
    li.style.height = '0px';
    li.style.opacity = '0';
    setTimeout(cb, 240);
  }

  function setDate(key) {
    ui.date = key > ui.today ? ui.today : key;
    renderHeader();
    renderSummary();
    renderWeek();
    renderLog();
  }

  function setTab(kind) {
    if (ui.tab === kind) return;
    ui.tab = kind;
    ui.search = '';
    els.search.value = '';
    renderTabs();
    renderRecipes();
  }

  function setMeal(id) {
    ui.meal = id;
    ui.mealPicked = true;
    renderMealPicker(els.mealPicker, ui.meal, true);
    $$('.add-btn', els.recipeList).forEach((b) => {
      const r = recipeById(b.dataset.add);
      if (r) b.setAttribute('aria-label', `Add ${splitText(r.text).title} to ${mealLabel(id)}`);
    });
  }

  /* =========================================================
     Gestures: swipe an entry sideways to remove it
     Touch uses touch events so a horizontal drag can be claimed with
     preventDefault: iOS cancels pointer streams once it decides to scroll.
     Mouse and pen use pointer events.
     ========================================================= */
  const SWIPE_LOCK = 10; // px of travel before deciding between swipe and scroll
  let swipe = null;
  let suppressClick = false;

  function swipeStart(target, x, y) {
    const fg = target.closest('.entry__fg');
    if (!fg || target.closest('.entry__del')) return null;
    const li = fg.parentElement;
    swipe = { li, fg, id: li.dataset.id, x, y, dx: 0, axis: null, t: performance.now(), lastX: x, v: 0 };
    return swipe;
  }
  /** Track the drag; returns true while it is a horizontal swipe (so scrolling should be blocked). */
  function swipeMove(x, y) {
    if (!swipe) return false;
    const dx = x - swipe.x;
    const dy = y - swipe.y;
    if (!swipe.axis) {
      if (Math.abs(dx) < SWIPE_LOCK && Math.abs(dy) < SWIPE_LOCK) return false;
      swipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (swipe.axis === 'y') { swipe = null; return false; } // a scroll, not a swipe
      swipe.li.classList.add('is-dragging');
    }
    const now = performance.now();
    swipe.v = (x - swipe.lastX) / Math.max(1, now - swipe.t);
    swipe.t = now;
    swipe.lastX = x;
    swipe.dx = dx;
    swipe.fg.style.transform = `translateX(${dx}px)`;
    return true;
  }
  function swipeEnd(cancelled) {
    const s = swipe;
    swipe = null;
    if (!s || s.axis !== 'x') return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 80);
    const width = s.fg.offsetWidth;
    const flung = Math.abs(s.dx) > width * 0.35 || (Math.abs(s.dx) > 40 && Math.abs(s.v) > 0.5 && Math.sign(s.v) === Math.sign(s.dx));
    if (!cancelled && flung) {
      const dir = Math.sign(s.dx) || 1;
      s.fg.style.transition = 'transform .18s ease-out';
      s.fg.style.transform = `translateX(${dir * width * 1.1}px)`;
      setTimeout(() => collapse(s.li, () => removeEntry(s.id)), 160);
    } else {
      s.li.classList.remove('is-dragging');
      s.fg.style.transform = '';
    }
  }

  els.log.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { swipeEnd(true); return; }
    swipeStart(e.target, e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  els.log.addEventListener('touchmove', (e) => {
    if (!swipe || e.touches.length !== 1) return;
    if (swipeMove(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault();
  }, { passive: false });
  els.log.addEventListener('touchend', () => swipeEnd(false));
  els.log.addEventListener('touchcancel', () => swipeEnd(true));

  els.log.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const s = swipeStart(e.target, e.clientX, e.clientY);
    if (s) s.pointerId = e.pointerId;
  });
  els.log.addEventListener('pointermove', (e) => {
    if (!swipe || swipe.pointerId !== e.pointerId) return;
    const locked = swipe.axis === 'x';
    if (swipeMove(e.clientX, e.clientY) && !locked) {
      try { swipe.fg.setPointerCapture(e.pointerId); } catch (_) {}
    }
  });
  els.log.addEventListener('pointerup', (e) => { if (swipe && swipe.pointerId === e.pointerId) swipeEnd(false); });
  els.log.addEventListener('pointercancel', (e) => { if (swipe && swipe.pointerId === e.pointerId) swipeEnd(true); });

  els.log.addEventListener('click', (e) => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      const li = del.closest('.entry');
      collapse(li, () => removeEntry(del.dataset.del));
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) openEntryDialog(open.dataset.open);
  }, true);

  els.log.addEventListener('keydown', (e) => {
    const open = e.target.closest('[data-open]');
    if (open && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      removeEntry(open.dataset.open);
      const first = $('[data-open]', els.log);
      (first || els.log).focus?.();
    }
  });

  /* =========================================================
     Dialog helpers
     ========================================================= */
  function openDialog(dlg) {
    if (dlg.open) return;
    dlg.classList.remove('is-closing');
    dlg.showModal();
  }
  function closeDialog(dlg) {
    if (!dlg.open) return;
    if (reducedMotion()) return dlg.close();
    dlg.classList.add('is-closing');
    setTimeout(() => { dlg.classList.remove('is-closing'); dlg.close(); }, 180);
  }
  $$('dialog.sheet').forEach((dlg) => {
    // click on the backdrop closes
    dlg.addEventListener('mousedown', (e) => { dlg._downOnBackdrop = e.target === dlg; });
    dlg.addEventListener('click', (e) => { if (e.target === dlg && dlg._downOnBackdrop) closeDialog(dlg); });
    // Close/cancel buttons are type="button" so Enter in a field submits the primary action
    dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDialog(dlg); });
  });

  function wireMealPicker(container, onPick) {
    container.addEventListener('click', (e) => {
      const b = e.target.closest('[data-meal]');
      if (b) onPick(b.dataset.meal);
    });
    container.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const opts = $$('[data-meal]', container);
      const i = opts.indexOf(document.activeElement);
      const next = opts[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
      onPick(next.dataset.meal);
      $(`[data-meal="${next.dataset.meal}"]`, container).focus();
    });
  }

  /* =========================================================
     New recipes dialog (spreadsheet-style grid)
     ========================================================= */
  const dlgNew = $('#dlg-new');
  const gridBody = $('#grid-body');
  const newForm = $('#new-form');
  const combineField = $('#combine-name-field');
  const combineName = $('#combine-name');
  const saveNewBtn = $('#save-new');

  function gridRow(item = '', kcal = '') {
    const row = document.createElement('div');
    row.className = 'grid-row';
    row.setAttribute('role', 'row');
    row.innerHTML = `
      <span role="cell"><textarea rows="1" aria-labelledby="col-item" placeholder="${KIND[ui.newKind].placeholder}"></textarea></span>
      <span role="cell"><input type="text" inputmode="numeric" aria-labelledby="col-kcal" placeholder="0" autocomplete="off"></span>
      <span role="cell" class="grid-row__rm"><button type="button" class="icon-btn" aria-label="Remove row"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span>`;
    $('textarea', row).value = item;
    $('input', row).value = kcal === null ? '' : kcal;
    return row;
  }
  const autoGrow = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

  function addGridRow(item, kcal, after, animate = true) {
    const row = gridRow(item, kcal);
    if (animate) row.classList.add('is-new');
    if (after && after.nextSibling) gridBody.insertBefore(row, after.nextSibling);
    else if (after) gridBody.appendChild(row);
    else gridBody.appendChild(row);
    requestAnimationFrame(() => autoGrow($('textarea', row)));
    return row;
  }

  function readGrid() {
    return $$('.grid-row', gridBody).map((row) => {
      const ta = $('textarea', row);
      const input = $('input', row);
      return { row, ta, input, text: ta.value.replace(/\r/g, '').trim(), kcalRaw: input.value.trim(), kcal: parseKcal(input.value) };
    });
  }

  function newMode() { return newForm.elements.mode.value; }

  function updateGridSummary() {
    const rows = readGrid().filter((r) => r.text || r.kcalRaw);
    const total = rows.reduce((s, r) => s + (r.kcal || 0), 0);
    const combine = newMode() === 'combine';
    const k = KIND[ui.newKind];
    $('#grid-total').textContent = rows.length ? `${rows.length} ${combine ? 'ingredient' : 'row'}${rows.length === 1 ? '' : 's'} · ${fmt(total)} kcal` : '';
    saveNewBtn.textContent = combine ? 'Save recipe' : rows.length > 1 ? `Save ${rows.length} ${k.plural}` : `Save ${k.one}`;
  }

  function openNewDialog(prefill = '') {
    ui.newKind = ui.tab;
    const k = KIND[ui.newKind];
    $('#dlg-new-title').textContent = `New ${k.plural}`;
    $('#col-kcal').textContent = k.col;
    $('#mode-switch').hidden = ui.newKind === EXERCISE;
    gridBody.innerHTML = '';
    newForm.elements.mode.value = 'separate';
    combineField.hidden = true;
    combineName.value = '';
    addGridRow(prefill, '', null, false);
    addGridRow('', '', null, false);
    addGridRow('', '', null, false);
    updateGridSummary();
    openDialog(dlgNew);
    const first = $('.grid-row textarea', gridBody);
    first.focus();
    first.setSelectionRange(first.value.length, first.value.length);
  }

  newForm.addEventListener('change', (e) => {
    if (e.target.name === 'mode') {
      const combine = newMode() === 'combine';
      combineField.hidden = !combine;
      if (combine) combineName.focus();
      updateGridSummary();
    }
  });

  gridBody.addEventListener('input', (e) => {
    if (e.target.matches('textarea')) autoGrow(e.target);
    e.target.closest('.grid-row')?.classList.remove('is-invalid');
    e.target.classList.remove('is-invalid');
    updateGridSummary();
  });

  gridBody.addEventListener('click', (e) => {
    const rm = e.target.closest('.grid-row__rm button');
    if (!rm) return;
    const row = rm.closest('.grid-row');
    const rows = $$('.grid-row', gridBody);
    if (rows.length === 1) { $('textarea', row).value = ''; $('input', row).value = ''; autoGrow($('textarea', row)); }
    else {
      const next = row.nextElementSibling || row.previousElementSibling;
      row.remove();
      $('textarea', next).focus();
    }
    updateGridSummary();
  });

  gridBody.addEventListener('keydown', (e) => {
    const row = e.target.closest('.grid-row');
    if (!row) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveNewBtn.click(); return; }
    // Enter in the calories cell jumps to the next row (creating one if needed)
    if (e.target.matches('input') && e.key === 'Enter') {
      e.preventDefault();
      const next = row.nextElementSibling || addGridRow('', '', row);
      $('textarea', next).focus();
      updateGridSummary();
    }
    // Backspace in an empty row removes it
    if (e.key === 'Backspace' && e.target.matches('textarea') && !e.target.value && !$('input', row).value && $$('.grid-row', gridBody).length > 1) {
      e.preventDefault();
      const prev = row.previousElementSibling || row.nextElementSibling;
      row.remove();
      const pin = $('input', prev);
      pin.focus();
      updateGridSummary();
    }
  });

  $('#add-row').addEventListener('click', () => {
    const row = addGridRow('', '', gridBody.lastElementChild);
    $('textarea', row).focus();
    gridBody.scrollTop = gridBody.scrollHeight;
    updateGridSummary();
  });

  combineName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('.grid-row textarea', gridBody)?.focus(); }
  });

  /** Parse tab-separated text, honouring quoted cells that contain newlines (Excel/Sheets style). */
  function parseTSV(text) {
    const rows = [];
    let row = [], cell = '', i = 0, quoted = false;
    text = text.replace(/\r\n?/g, '\n');
    while (i < text.length) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        if (c === '"') { quoted = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === '"' && cell === '') { quoted = true; i++; continue; }
      if (c === '\t') { row.push(cell); cell = ''; i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += c; i++;
    }
    row.push(cell);
    rows.push(row);
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  const LINE_RE = /^(.*?)(?:\s*[,;:|–—-]\s*|\s+)(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:k?cals?|kcal|calories)?\s*$/i;

  /** Turn pasted text into [{item, kcal}] rows, or null if it doesn't look tabular. */
  function parsePaste(text) {
    if (text.includes('\t')) {
      const rows = parseTSV(text).map((cells) => {
        const idx = cells.findIndex((c, i) => i > 0 && parseKcal(c) !== null);
        const kcal = idx > 0 ? parseKcal(cells[idx]) : null;
        const item = cells.filter((c, i) => i !== idx && parseKcal(c) === null).map((c) => c.trim()).filter(Boolean).join('\n');
        return { item, kcal };
      });
      // drop a header row such as "Item | Calories"
      if (rows.length && rows[0].kcal === null && /item|food|name|calor|kcal/i.test(rows[0].item)) rows.shift();
      return rows.length ? rows : null;
    }
    const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const matched = lines.filter((l) => LINE_RE.test(l)).length;
    if (matched < Math.ceil(lines.length / 2)) return null;
    const rows = [];
    for (const l of lines) {
      const m = l.match(LINE_RE);
      if (m) rows.push({ item: m[1].replace(/^[-•*\d.)\s]+(?=\D)/, '').trim(), kcal: parseKcal(m[2]) });
      else if (rows.length) rows[rows.length - 1].item += '\n' + l; // a line without a number is a note for the row above
      else rows.push({ item: l, kcal: null });
    }
    return rows;
  }

  gridBody.addEventListener('paste', (e) => {
    const row = e.target.closest('.grid-row');
    const text = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!row || !text) return;
    const parsed = parsePaste(text);
    if (!parsed) return; // ordinary paste into the cell
    e.preventDefault();
    let anchor = row;
    const ta = $('textarea', row);
    const input = $('input', row);
    const startHere = !ta.value.trim() && !input.value.trim();
    parsed.forEach((p, i) => {
      if (i === 0 && startHere) {
        ta.value = p.item; input.value = p.kcal ?? ''; autoGrow(ta);
      } else {
        anchor = addGridRow(p.item, p.kcal ?? '', anchor);
      }
    });
    // tidy: drop the blank placeholder rows
    $$('.grid-row', gridBody).forEach((r) => {
      if (!$('textarea', r).value.trim() && !$('input', r).value.trim()) r.remove();
    });
    updateGridSummary();
    toast(`Pasted ${parsed.length} row${parsed.length === 1 ? '' : 's'}`);
  });

  newForm.addEventListener('submit', (e) => {
    if (!e.submitter || e.submitter.value !== 'save') return;
    e.preventDefault();
    const combine = newMode() === 'combine' && ui.newKind === 'food';
    const kind = ui.newKind;
    const rows = readGrid().filter((r) => r.text || r.kcalRaw);
    let firstBad = null;
    rows.forEach((r) => {
      if (!r.text) { r.ta.classList.add('is-invalid'); firstBad = firstBad || r.ta; }
      if (r.kcal === null) { r.row.classList.add('is-invalid'); firstBad = firstBad || r.input; }
    });
    if (combine && !combineName.value.trim()) { combineName.classList.add('is-invalid'); firstBad = firstBad || combineName; }
    if (!rows.length) { toast('Add at least one item with its calories.'); $('textarea', gridBody).focus(); return; }
    if (firstBad) {
      toast(combine && firstBad === combineName ? 'Give the combined recipe a name.' : 'Each row needs an item and a calorie number.');
      firstBad.focus();
      return;
    }

    const now = Date.now();
    const created = combine
      ? [{ id: uid(), kind, text: `${combineName.value.trim()}\n${rows.map((r) => `${r.text.replace(/\n+/g, ', ')} (${fmt(r.kcal)})`).join('\n')}`, kcal: rows.reduce((s, r) => s + r.kcal, 0), uses: 0, lastUsed: 0, createdAt: now }]
      : rows.map((r, i) => ({ id: uid(), kind, text: r.text, kcal: r.kcal, uses: 0, lastUsed: 0, createdAt: now + i }));
    state.recipes.push(...created);
    if (!save()) return;
    created.forEach((r) => ui.newRecipeIds.add(r.id));
    ui.search = '';
    els.search.value = '';
    renderRecipes();
    renderLog();
    closeDialog(dlgNew);
    toast(created.length === 1 ? `Saved ${splitText(created[0].text).title}` : `Saved ${created.length} ${KIND[kind].plural}`);
  });
  combineName.addEventListener('input', () => combineName.classList.remove('is-invalid'));

  /* =========================================================
     Edit recipe dialog
     ========================================================= */
  const dlgEdit = $('#dlg-edit');
  const editText = $('#edit-text');
  const editKcal = $('#edit-kcal');
  let editingId = null;

  function openEditDialog(id) {
    const r = recipeById(id);
    if (!r) return;
    editingId = id;
    const burn = kindOf(r) === EXERCISE;
    $('#dlg-edit-title').textContent = burn ? 'Edit exercise' : 'Edit recipe';
    $('#edit-kcal-label').textContent = burn ? 'Calories burned' : 'Calories';
    editText.value = r.text;
    editKcal.value = r.kcal;
    editText.classList.remove('is-invalid');
    openDialog(dlgEdit);
    requestAnimationFrame(() => autoGrow(editText));
  }
  editText.addEventListener('input', () => autoGrow(editText));

  $('#edit-form').addEventListener('submit', (e) => {
    if (!e.submitter || e.submitter.value !== 'save') return;
    e.preventDefault();
    const r = recipeById(editingId);
    const kcal = parseKcal(editKcal.value);
    if (!editText.value.trim()) { editText.focus(); toast('The recipe needs a name.'); return; }
    if (kcal === null) { editKcal.focus(); toast('Enter calories between 0 and 20,000.'); return; }
    r.text = editText.value.replace(/\r/g, '').trim();
    r.kcal = kcal;
    save();
    renderRecipes();
    closeDialog(dlgEdit);
    toast('Recipe updated');
  });

  $('#delete-recipe').addEventListener('click', () => {
    const idx = state.recipes.findIndex((r) => r.id === editingId);
    if (idx < 0) return;
    const [removed] = state.recipes.splice(idx, 1);
    save();
    renderRecipes();
    closeDialog(dlgEdit);
    toast(`Deleted ${splitText(removed.text).title}`, {
      onAction: () => { state.recipes.splice(idx, 0, removed); save(); renderRecipes(); },
    });
  });

  /* =========================================================
     Log entry dialog (servings, meal, remove)
     ========================================================= */
  const dlgEntry = $('#dlg-entry');
  const servValue = $('#serv-value');
  const entryMeal = $('#entry-meal');
  let editingEntry = null; // { id, servings, meal }

  function openEntryDialog(id) {
    const e = entriesFor(ui.date).find((x) => x.id === id);
    if (!e) return;
    editingEntry = { id, servings: e.servings, meal: e.meal, kcal: e.kcal, burn: isBurn(e) };
    $('#dlg-entry-title').textContent = e.name;
    $('#servings-label').textContent = isBurn(e) ? 'Amount (× the saved session)' : 'Servings';
    $('#entry-meal-field').hidden = isBurn(e);
    renderEntryDialog();
    openDialog(dlgEntry);
  }
  function renderEntryDialog() {
    const x = editingEntry;
    servValue.textContent = x.servings;
    $('#serv-minus').disabled = x.servings <= 0.25;
    $('#entry-total').textContent = `${fmt(x.kcal * x.servings)} kcal${x.burn ? ' burned' : ''}${x.servings !== 1 ? ` (${fmt(x.kcal)} × ${x.servings})` : ''}`;
    renderMealPicker(entryMeal, x.meal, false);
  }
  const stepServings = (s, dir) => {
    const steps = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    const i = steps.findIndex((v) => v >= s);
    if (dir > 0) return steps.find((v) => v > s) || s;
    return [...steps].reverse().find((v) => v < s) || (i === 0 ? steps[0] : s);
  };
  $('#serv-minus').addEventListener('click', () => { editingEntry.servings = stepServings(editingEntry.servings, -1); renderEntryDialog(); });
  $('#serv-plus').addEventListener('click', () => { editingEntry.servings = stepServings(editingEntry.servings, 1); renderEntryDialog(); });
  wireMealPicker(entryMeal, (m) => { editingEntry.meal = m; renderEntryDialog(); });

  $('#entry-form').addEventListener('submit', (e) => {
    if (!e.submitter || e.submitter.value !== 'save') return;
    e.preventDefault();
    const entry = entriesFor(ui.date).find((x) => x.id === editingEntry.id);
    if (entry && (entry.servings !== editingEntry.servings || entry.meal !== editingEntry.meal)) {
      entry.servings = editingEntry.servings;
      entry.meal = editingEntry.meal;
      save();
      ui.justAdded = entry.id;
      renderSummary();
      renderWeek();
      renderLog();
    }
    closeDialog(dlgEntry);
  });
  $('#delete-entry').addEventListener('click', () => {
    closeDialog(dlgEntry);
    removeEntry(editingEntry.id);
  });

  /* =========================================================
     Quick add dialog
     ========================================================= */
  const dlgQuick = $('#dlg-quick');
  const quickKcal = $('#quick-kcal');
  const quickName = $('#quick-name');
  const quickSave = $('#quick-save');
  const quickMeal = $('#quick-meal');
  let quickMealValue = ui.meal;
  let quickKind = 'food';

  function renderQuickMeal() {
    const burn = quickKind === EXERCISE;
    $('#dlg-quick-title').textContent = burn ? 'Quick Add Exercise' : 'Quick Add Food';
    $('#quick-intro').textContent = burn ? 'Log a one-off workout or activity without saving it first.' : 'Log a one-off food without saving it first.';
    $('#quick-meal-field').hidden = burn;
    if (!burn) renderMealPicker(quickMeal, quickMealValue, false);
    quickName.placeholder = burn ? 'Evening walk' : 'Coffee with a friend';
    $('#quick-save-label').textContent = burn ? 'Also save to my exercises' : 'Also save to my recipes';
    $('label[for="quick-kcal"]').textContent = burn ? 'Calories burned' : 'Calories';
  }
  function openQuickDialog(kind = 'food') {
    quickKcal.value = '';
    quickName.value = '';
    quickSave.checked = false;
    quickKind = kind === EXERCISE ? EXERCISE : 'food';
    quickMealValue = quickKind === EXERCISE ? EXERCISE : ui.meal;
    renderQuickMeal();
    openDialog(dlgQuick);
    quickKcal.focus();
  }
  wireMealPicker(quickMeal, (m) => { quickMealValue = m; renderQuickMeal(); });

  $('#quick-form').addEventListener('submit', (e) => {
    if (!e.submitter || e.submitter.value !== 'save') return;
    e.preventDefault();
    const kcal = parseKcal(quickKcal.value);
    if (!kcal) { quickKcal.focus(); toast('Enter the calories to log.'); return; }
    const name = quickName.value.trim();
    if (quickSave.checked && !name) { quickName.focus(); toast(quickKind === EXERCISE ? 'Add a label to save it as an exercise.' : 'Add a label to save it as a recipe.'); return; }
    let recipeId = null;
    const burn = quickMealValue === EXERCISE;
    const kind = burn ? EXERCISE : 'food';
    if (quickSave.checked) {
      const r = { id: uid(), kind, text: name, kcal, uses: 1, lastUsed: Date.now(), createdAt: Date.now() };
      state.recipes.push(r);
      recipeId = r.id;
      ui.newRecipeIds.add(r.id);
    }
    const entry = { id: uid(), kind, recipeId, name: name || (burn ? 'Exercise' : 'Quick add'), kcal, servings: 1, meal: quickMealValue, at: Date.now() };
    (state.log[ui.date] = state.log[ui.date] || []).push(entry);
    if (!save()) return;
    ui.justAdded = entry.id;
    renderSummary();
    renderWeek();
    renderLog();
    if (recipeId) renderRecipes();
    pop(burn ? `−${fmt(kcal)}` : `+${fmt(kcal)}`, burn);
    closeDialog(dlgQuick);
    const date = ui.date;
    toast(burn ? `Logged ${fmt(kcal)} kcal of exercise` : `Logged ${fmt(kcal)} kcal`, { onAction: () => removeEntry(entry.id, { silent: true, date }) });
  });

  /* =========================================================
     Settings dialog
     ========================================================= */
  const dlgSettings = $('#dlg-settings');
  const goalInput = $('#goal-input');
  const settingsForm = $('#settings-form');

  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  function syncPresets() {
    $$('#goal-presets [data-goal]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.goal === state.settings.goal)));
  }

  function openSettings(focusGoal) {
    goalInput.value = state.settings.goal;
    settingsForm.elements.theme.value = state.settings.theme;
    syncPresets();
    const bytes = new Blob([localStorage.getItem(STORAGE_KEY) || '']).size;
    const days = Object.keys(state.log).length;
    $('#storage-usage').textContent = `${days} day${days === 1 ? '' : 's'} logged · ${bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB'}`;
    openDialog(dlgSettings);
    if (focusGoal) { goalInput.focus(); goalInput.select(); }
  }

  function setGoal(v) {
    const g = clamp(Math.round(v), 500, 10000);
    if (!Number.isFinite(g) || g === state.settings.goal) return;
    state.settings.goal = g;
    save();
    syncPresets();
    renderSummary();
    renderWeek();
  }
  goalInput.addEventListener('change', () => { setGoal(parseInt(goalInput.value, 10) || state.settings.goal); goalInput.value = state.settings.goal; });
  goalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goalInput.blur(); } });
  $('#goal-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-goal]');
    if (b) { setGoal(+b.dataset.goal); goalInput.value = state.settings.goal; }
  });
  settingsForm.addEventListener('change', (e) => {
    if (e.target.name === 'theme') { state.settings.theme = e.target.value; save(); applyTheme(); }
  });
  settingsForm.addEventListener('submit', (e) => {
    if (e.submitter && e.submitter.value === 'save') {
      e.preventDefault();
      if (document.activeElement === goalInput) goalInput.dispatchEvent(new Event('change'));
      closeDialog(dlgSettings);
    }
  });

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#export-json').addEventListener('click', () => {
    state.settings.lastBackup = Date.now();
    save();
    download(`tally-backup-${dateKey()}.json`, JSON.stringify({ app: 'tally', exportedAt: new Date().toISOString(), ...state }, null, 2), 'application/json');
    renderDataStatus();
    toast('Backup downloaded');
  });

  $('#export-csv').addEventListener('click', () => {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [['date', 'type', 'meal', 'item', 'servings', 'kcal_per_serving', 'kcal_total'].join(',')];
    Object.keys(state.log).sort().forEach((d) => {
      entriesFor(d).forEach((e) => lines.push([d, isBurn(e) ? 'exercise' : 'food', isBurn(e) ? '' : mealLabel(e.meal), q(e.name), e.servings, e.kcal, isBurn(e) ? -entryKcal(e) : entryKcal(e)].join(',')));
    });
    if (lines.length === 1) { toast('Nothing logged yet to export.'); return; }
    download(`tally-log-${dateKey()}.csv`, lines.join('\n'), 'text/csv');
    toast('Food/exercise log exported');
  });

  /* ---------- Full backup: restore (replace) or merge ---------- */
  const restoreBox = $('#restore-confirm');
  let pendingBackup = null;

  $('#import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse((await file.text()).replace(/^﻿/, ''));
      if (!data || (!Array.isArray(data.recipes) && !data.log)) throw new Error('shape');
      pendingBackup = normalise(data);
      const days = Object.keys(pendingBackup.log).length;
      const when = data.exportedAt ? ` from ${new Date(data.exportedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
      $('#restore-summary').textContent = `This backup${when} has ${pendingBackup.recipes.length} recipes/exercises and ${days} logged day${days === 1 ? '' : 's'}. Merge adds anything missing here; replace swaps everything for the backup.`;
      restoreBox.hidden = false;
      $('#restore-merge').focus();
    } catch (err) {
      toast('That file isn’t a valid Tally backup.');
    }
  });

  /** Add recipes and log entries from `incoming` that aren't already here. Settings stay as they are. */
  function mergeIn(incoming) {
    const ids = new Set(state.recipes.map((r) => r.id));
    const names = new Set(state.recipes.map((r) => kindOf(r) + '|' + splitText(r.text).title.toLowerCase()));
    let recipes = 0, entries = 0;
    for (const r of incoming.recipes) {
      const key = kindOf(r) + '|' + splitText(r.text).title.toLowerCase();
      if (ids.has(r.id) || names.has(key)) continue;
      state.recipes.push(r);
      ids.add(r.id); names.add(key);
      recipes++;
    }
    for (const [day, list] of Object.entries(incoming.log)) {
      const mine = (state.log[day] = state.log[day] || []);
      const have = new Set(mine.map((e) => e.id));
      for (const e of list) if (!have.has(e.id)) { mine.push(e); entries++; }
      mine.sort((a, b) => a.at - b.at);
    }
    return { recipes, entries };
  }

  $('#restore-merge').addEventListener('click', () => {
    if (!pendingBackup) return;
    const { recipes, entries } = mergeIn(pendingBackup);
    pendingBackup = null;
    restoreBox.hidden = true;
    save();
    renderAll();
    renderDataStatus();
    toast(recipes || entries ? `Merged ${recipes} recipe${recipes === 1 ? '' : 's'} and ${entries} log entr${entries === 1 ? 'y' : 'ies'}` : 'Nothing new. You already have everything in that backup.');
  });
  $('#restore-replace').addEventListener('click', () => {
    if (!pendingBackup) return;
    if (!confirm('Replace everything in this browser with the backup? Anything not in the backup will be lost.')) return;
    state = pendingBackup;
    pendingBackup = null;
    restoreBox.hidden = true;
    save();
    applyTheme();
    renderAll();
    renderDataStatus();
    toast('Backup restored');
  });
  $('#restore-cancel').addEventListener('click', () => { pendingBackup = null; restoreBox.hidden = true; });

  /* ---------- Import & export page ---------- */
  const dlgData = $('#dlg-data');
  const ago = (t) => {
    const days = Math.round((parseKey(dateKey()) - parseKey(dateKey(new Date(t)))) / 864e5);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  };
  function renderDataStatus() {
    const t = state.settings.lastBackup;
    $('#last-backup').textContent = t ? `Everything: recipes, exercises, log and settings. Last backup ${ago(t)}.` : 'Everything: recipes, exercises, log and settings. No backup yet.';
    $('#backup-status').textContent = t ? `Last backup ${ago(t)}` : 'Recipes, food/exercise log and backups. No backup yet.';
    const bytes = new Blob([localStorage.getItem(STORAGE_KEY) || '']).size;
    const days = Object.keys(state.log).length;
    $('#storage-usage').textContent = `${state.recipes.length} saved items · ${days} day${days === 1 ? '' : 's'} logged · ${bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB'} used`;
  }
  function openData() {
    restoreBox.hidden = true;
    pendingBackup = null;
    renderDataStatus();
    if (dlgSettings.open) dlgSettings.close();
    openDialog(dlgData);
  }
  $('#open-data').addEventListener('click', openData);
  $('#data-back').addEventListener('click', () => { dlgData.close(); openSettings(false); });

  const csvCell = (s) => (/[",\n\r]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const sortedForExport = () => state.recipes.slice().sort((a, b) => kindOf(a).localeCompare(kindOf(b)) || a.text.localeCompare(b.text));

  $('#export-recipes').addEventListener('click', () => {
    if (!state.recipes.length) { toast('No recipes to export yet.'); return; }
    const rows = [['type', 'item', 'calories', 'notes'].join(',')];
    for (const r of sortedForExport()) {
      const { title, notes } = splitText(r.text);
      rows.push([kindOf(r), csvCell(title), r.kcal, csvCell(notes)].join(','));
    }
    download(`tally-recipes-${dateKey()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv');
    toast(`Exported ${state.recipes.length} items`);
  });

  $('#copy-recipes').addEventListener('click', async () => {
    if (!state.recipes.length) { toast('No recipes to copy yet.'); return; }
    const tsvCell = (s) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const text = ['Item\tCalories\tType', ...sortedForExport().map((r) => `${tsvCell(r.text)}\t${r.kcal}\t${kindOf(r)}`)].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${state.recipes.length} items. Paste into a spreadsheet or note.`);
    } catch (_) {
      download(`tally-recipes-${dateKey()}.txt`, text, 'text/plain');
      toast('Clipboard blocked, so it was downloaded as a text file instead.');
    }
  });

  $('#export-daily').addEventListener('click', () => {
    const days = Object.keys(state.log).sort();
    if (!days.length) { toast('Nothing logged yet to export.'); return; }
    const goal = state.settings.goal;
    const rows = [['date', 'weekday', 'food_kcal', 'exercise_kcal', 'net_kcal', 'goal_kcal', 'within_goal'].join(',')];
    for (const d of days) {
      const net = dayNet(d);
      rows.push([d, parseKey(d).toLocaleDateString('en-GB', { weekday: 'short' }), dayFood(d), dayBurn(d), net, goal, net <= goal ? 'yes' : 'no'].join(','));
    }
    download(`tally-daily-${dateKey()}.csv`, rows.join('\r\n'), 'text/csv');
    toast(`Exported ${days.length} day${days.length === 1 ? '' : 's'}`);
  });

  /* ---------- Import recipes ---------- */
  const dlgImport = $('#dlg-import');
  const importText = $('#import-text');
  const importPreview = $('#import-preview');
  const importGo = $('#import-go');
  let importRows = [];

  const ITEM_COL = /^(item|name|food|recipe|title|exercise|activity|meal|description)\b/i;
  const KCAL_COL = /(cal|kcal|energy|burn)/i;
  const TYPE_COL = /^(type|kind|category)\b/i;
  const NOTES_COL = /^(notes?|details?|ingredients?)\b/i;
  const parseKind = (v) => (/exer|workout|activ|burn|sport/i.test(v || '') ? EXERCISE : /food|meal|recipe|drink|snack/i.test(v || '') ? 'food' : null);

  /** Parse delimited text (comma, semicolon or tab), honouring quoted cells with commas/newlines. */
  function parseDelimited(text, delim) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    text = text.replace(/\r\n?/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"' && cell.trim() === '') { quoted = true; cell = ''; }
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    row.push(cell);
    rows.push(row);
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  /** Turn a file or pasted text into [{ text, kcal, kind }] candidates. */
  function parseImport(raw) {
    const text = raw.replace(/^﻿/, '').trim();
    if (!text) return [];
    if (/^[[{]/.test(text)) {
      try {
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : data.recipes || [];
        return list.map((r) => ({
          text: String(r.text || [r.item || r.name || '', r.notes || ''].filter(Boolean).join('\n')).trim(),
          kcal: parseKcal(r.kcal ?? r.calories),
          kind: parseKind(r.kind || r.type),
        }));
      } catch (_) { /* not JSON after all, fall through */ }
    }
    const firstLine = text.split('\n')[0];
    const cells = (d) => firstLine.split(d).map((c) => c.trim().replace(/^"|"$/g, ''));
    const delim = firstLine.includes('\t') ? '\t' : cells(';').length > cells(',').length ? ';' : ',';
    const head = cells(delim);
    const hasHeader = head.some((c) => ITEM_COL.test(c)) && head.some((c) => KCAL_COL.test(c));

    if (hasHeader) {
      const rows = parseDelimited(text, delim);
      const h = rows.shift().map((c) => c.trim());
      const iItem = h.findIndex((c) => ITEM_COL.test(c));
      const iKcal = h.findIndex((c, i) => i !== iItem && KCAL_COL.test(c));
      const iType = h.findIndex((c) => TYPE_COL.test(c));
      const iNotes = h.findIndex((c) => NOTES_COL.test(c));
      return rows.map((c) => ({
        text: [c[iItem], iNotes >= 0 ? c[iNotes] : ''].map((s) => (s || '').trim()).filter(Boolean).join('\n'),
        kcal: parseKcal(c[iKcal]),
        kind: iType >= 0 ? parseKind(c[iType]) : null,
      }));
    }
    if (delim === '\t') {
      return parseDelimited(text, '\t').map((c) => ({ text: (c[0] || '').trim(), kcal: parseKcal(c[1]), kind: parseKind(c[2]) }));
    }
    // Free text: "Porridge, 340" / "Gravy: 60 kcal" / "Run - 350 exercise". Lines without a number become notes.
    const out = [];
    for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const typed = line.match(/^(.*?)[\s,;|]+(exercise|food)\s*$/i);
      const body = typed ? typed[1] : line;
      const m = body.match(LINE_RE);
      if (m) out.push({ text: m[1].replace(/^[-•*\d.)\s]+(?=\D)/, '').trim(), kcal: parseKcal(m[2]), kind: typed ? parseKind(typed[2]) : null });
      else if (out.length) out[out.length - 1].text += '\n' + line;
      else out.push({ text: line, kcal: null, kind: null });
    }
    return out;
  }

  function classifyImport() {
    const fallback = $('input[name="import-kind"]:checked').value;
    const dupes = $('#import-dupes').value;
    const existing = new Map(state.recipes.map((r) => [kindOf(r) + '|' + splitText(r.text).title.toLowerCase(), r]));
    const seen = new Set();
    return importRows.map((r) => {
      const kind = r.kind || fallback;
      const title = splitText(r.text || '').title;
      const key = kind + '|' + title.toLowerCase();
      let status = 'new';
      if (!title || r.kcal === null) status = 'bad';
      else if (existing.has(key) || seen.has(key)) status = dupes === 'add' ? 'new' : dupes === 'update' && existing.has(key) ? 'update' : 'dupe';
      seen.add(key);
      return { ...r, kind, title, key, status, match: existing.get(key) };
    });
  }

  function renderImport() {
    if (!importRows.length) {
      importPreview.innerHTML = '';
      $('#import-opts').hidden = true;
      importGo.disabled = true;
      importGo.textContent = 'Import';
      return;
    }
    $('#import-opts').hidden = false;
    const rows = classifyImport();
    const n = (s) => rows.filter((r) => r.status === s).length;
    const add = n('new'), upd = n('update'), dupe = n('dupe'), bad = n('bad');
    const parts = [add && `${add} new`, upd && `${upd} to update`, dupe && `${dupe} already saved`, bad && `${bad} skipped (missing name or calories)`].filter(Boolean);
    const label = { new: '<span class="badge">New</span>', update: '<span class="badge">Update</span>', dupe: '<span class="badge badge--dupe">Saved</span>', bad: '<span class="badge badge--bad">Skip</span>' };
    importPreview.innerHTML = `<p class="import-summary">${parts.join(' · ') || 'Nothing to import'}</p>
      <div class="import-table"><table>
        <thead><tr><th>Item</th><th class="num">kcal</th><th></th></tr></thead>
        <tbody>${rows.slice(0, 300).map((r) => `<tr>
          <td title="${esc(r.text || '')}">${r.kind === EXERCISE ? '<span class="badge badge--ex">Ex</span>' : ''}${esc(r.title || '—')}</td>
          <td class="num">${r.kcal === null ? '—' : fmt(r.kcal)}</td>
          <td>${label[r.status]}</td></tr>`).join('')}</tbody>
      </table></div>${rows.length > 300 ? `<p class="hint">Showing the first 300 of ${rows.length} rows.</p>` : ''}`;
    const count = add + upd;
    importGo.disabled = !count;
    importGo.textContent = count ? `Import ${count}` : 'Import';
  }

  let importTimer;
  importText.addEventListener('input', () => {
    clearTimeout(importTimer);
    importTimer = setTimeout(() => { importRows = parseImport(importText.value); renderImport(); }, 150);
  });
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5e6) { toast('That file is too large to import.'); return; }
    importText.value = (await file.text()).replace(/^﻿/, '');
    importRows = parseImport(importText.value);
    renderImport();
    if (!importRows.length) toast('Couldn’t find any rows in that file.');
  });
  $$('input[name="import-kind"]').forEach((i) => i.addEventListener('change', renderImport));
  $('#import-dupes').addEventListener('change', renderImport);

  importGo.addEventListener('click', () => {
    const rows = classifyImport();
    const now = Date.now();
    let added = 0, updated = 0;
    const firstKind = rows.find((r) => r.status === 'new' || r.status === 'update')?.kind;
    rows.forEach((r, i) => {
      if (r.status === 'update' && r.match) { r.match.kcal = r.kcal; if (r.text.includes('\n')) r.match.text = r.text; updated++; }
      else if (r.status === 'new') {
        const rec = { id: uid(), kind: r.kind, text: r.text, kcal: r.kcal, uses: 0, lastUsed: 0, createdAt: now + i };
        state.recipes.push(rec);
        ui.newRecipeIds.add(rec.id);
        added++;
      }
    });
    if (!save()) return;
    if (firstKind && firstKind !== ui.tab) { ui.tab = firstKind; renderTabs(); }
    ui.search = '';
    els.search.value = '';
    renderRecipes();
    renderLog();
    closeDialog(dlgImport);
    toast([added && `Imported ${added}`, updated && `updated ${updated}`].filter(Boolean).join(', ') || 'Nothing imported');
  });

  function openImport() {
    importText.value = '';
    importRows = [];
    $('#import-dupes').value = 'skip';
    $$('input[name="import-kind"]').forEach((i) => (i.checked = i.value === ui.tab));
    renderImport();
    if (dlgData.open) dlgData.close();
    openDialog(dlgImport);
  }
  $('#import-recipes').addEventListener('click', openImport);

  function addSamples(kind = ui.tab) {
    const have = new Set(state.recipes.filter((r) => kindOf(r) === kind).map((r) => splitText(r.text).title.toLowerCase()));
    const now = Date.now();
    const source = kind === EXERCISE ? SAMPLE_EXERCISES : SAMPLE_RECIPES;
    const added = source.filter(([t]) => !have.has(splitText(t).title.toLowerCase()))
      .map(([text, kcal], i) => ({ id: uid(), kind, text, kcal, uses: 0, lastUsed: 0, createdAt: now + i }));
    if (!added.length) { toast(`Sample ${KIND[kind].plural} are already in your list.`); return; }
    state.recipes.push(...added);
    save();
    added.forEach((r) => ui.newRecipeIds.add(r.id));
    renderRecipes();
    renderLog();
    toast(`Added ${added.length} sample ${KIND[kind].plural}`, {
      onAction: () => {
        const ids = new Set(added.map((r) => r.id));
        state.recipes = state.recipes.filter((r) => !ids.has(r.id));
        save();
        renderRecipes();
        renderLog();
      },
    });
  }
  $('#load-samples').addEventListener('click', () => { addSamples('food'); addSamples(EXERCISE); closeDialog($('#dlg-data')); });

  /* =========================================================
     Reports (week / month)
     ========================================================= */
  const dlgReports = $('#dlg-reports');
  const reportBody = $('#report-body');

  /** Days in the period containing `anchor`. Weeks run Monday–Sunday. */
  function periodDays(period, anchor) {
    const d = parseKey(anchor);
    if (period === 'week') {
      const offset = (d.getDay() + 6) % 7; // Monday = 0
      const start = addDays(anchor, -offset);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return Array.from({ length: n }, (_, i) => dateKey(new Date(d.getFullYear(), d.getMonth(), i + 1)));
  }
  function shiftPeriod(period, anchor, dir) {
    if (period === 'week') return addDays(anchor, 7 * dir);
    const d = parseKey(anchor);
    return dateKey(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  }
  function periodLabel(period, days) {
    const a = parseKey(days[0]), b = parseKey(days[days.length - 1]);
    if (period === 'month') return a.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const sameMonth = a.getMonth() === b.getMonth();
    const left = a.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    return `${left} – ${b.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  function summarise(days) {
    const goal = state.settings.goal;
    const s = { days: days.length, logged: 0, onTarget: 0, food: 0, burn: 0, net: 0, foods: new Map(), exercises: new Map(), meals: {} };
    MEALS.forEach((m) => (s.meals[m.id] = 0));
    for (const k of days) {
      const list = entriesFor(k);
      if (!list.length) continue;
      s.logged++;
      const net = dayNet(k);
      if (net <= goal) s.onTarget++;
      for (const e of list) {
        const kc = entryKcal(e);
        const bucket = isBurn(e) ? s.exercises : s.foods;
        const cur = bucket.get(e.name) || { count: 0, kcal: 0 };
        cur.count += e.servings;
        cur.kcal += kc;
        bucket.set(e.name, cur);
        if (isBurn(e)) s.burn += kc; else { s.food += kc; s.meals[e.meal] = (s.meals[e.meal] || 0) + kc; }
      }
    }
    s.net = s.food - s.burn;
    s.avg = s.logged ? s.net / s.logged : null;
    return s;
  }

  function rankList(map, burn) {
    const rows = [...map.entries()].sort((a, b) => b[1].kcal - a[1].kcal).slice(0, 5);
    if (!rows.length) return `<p class="rank__empty">${burn ? 'No exercise logged.' : 'No food logged.'}</p>`;
    return `<ol class="rank">${rows.map(([name, v]) => `<li><span class="rank__name">${esc(name)}</span><span class="rank__meta">${v.count % 1 ? v.count.toFixed(1) : v.count}× · ${burn ? '−' : ''}${fmt(v.kcal)} kcal</span></li>`).join('')}</ol>`;
  }

  function renderReport() {
    const { period, anchor } = ui.report;
    const days = periodDays(period, anchor);
    const s = summarise(days);
    const prev = summarise(periodDays(period, shiftPeriod(period, anchor, -1)));
    const goal = state.settings.goal;
    const word = period === 'week' ? 'week' : 'month';
    $('#report-label').textContent = periodLabel(period, days);
    $('#report-next').disabled = days[days.length - 1] >= ui.today;

    if (!s.logged) {
      reportBody.innerHTML = `<div class="week"><div class="week__plot" id="report-plot"></div></div>
        <div class="report-empty">Nothing logged in this ${word}${days[0] > ui.today ? ' yet' : ''}.</div>`;
      renderBars($('#report-plot'), days, { dense: period === 'month', selected: null });
      return;
    }

    let delta = '';
    if (prev.avg !== null) {
      const d = Math.round(s.avg - prev.avg);
      delta = d === 0 ? `Same as last ${word}` : `${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))} vs last ${word}`;
    } else delta = `Goal ${fmt(goal)}`;
    const elapsed = days.filter((k) => k <= ui.today).length;
    const mealMax = Math.max(1, ...Object.values(s.meals));

    reportBody.innerHTML = `
      <div class="tiles">
        <div class="tile"><span class="tile__label">Avg net / day</span><span class="tile__value">${fmt(s.avg)}<small>kcal</small></span><span class="tile__sub">${delta}</span></div>
        <div class="tile"><span class="tile__label">Within goal</span><span class="tile__value">${s.onTarget}<small>/ ${s.logged} days</small></span><span class="tile__sub">${s.logged} of ${elapsed} day${elapsed === 1 ? '' : 's'} logged</span></div>
        <div class="tile"><span class="tile__label">Food</span><span class="tile__value">${fmt(s.food)}<small>kcal</small></span><span class="tile__sub">${fmt(s.food / s.logged)} avg / day</span></div>
        <div class="tile"><span class="tile__label">Exercise</span><span class="tile__value">${fmt(s.burn)}<small>kcal</small></span><span class="tile__sub">${fmt(s.burn / s.logged)} avg / day</span></div>
      </div>

      <section class="report-section" aria-label="Net calories per day">
        <h4>Net calories per day</h4>
        <div class="week"><div class="week__plot" id="report-plot"></div></div>
        <p class="report-note">Food minus exercise. Tap a day to open it. Averages only count days you logged.</p>
      </section>

      <div class="report-cols">
        <section class="report-section"><h4>Top foods</h4>${rankList(s.foods, false)}</section>
        <section class="report-section"><h4>Top exercise</h4>${rankList(s.exercises, true)}</section>
      </div>

      <section class="report-section">
        <h4>Food by meal</h4>
        <div class="meal-rows">
          ${MEALS.map((m) => {
            const v = s.meals[m.id] || 0;
            const pct = s.food ? Math.round((v / s.food) * 100) : 0;
            return `<div class="meal-row"><span>${m.label}</span><span class="meal-row__bar" aria-hidden="true"><span style="width:${(v / mealMax) * 100}%"></span></span><span class="meal-row__val">${fmt(v)} · ${pct}%</span></div>`;
          }).join('')}
        </div>
      </section>`;
    renderBars($('#report-plot'), days, { dense: period === 'month', selected: null });
  }

  function openReports() {
    ui.report.anchor = ui.date;
    $$('#report-period input').forEach((i) => (i.checked = i.value === ui.report.period));
    openDialog(dlgReports);
    renderReport(); // after open so the chart can measure itself
  }
  $('#report-period').addEventListener('change', (e) => { ui.report.period = e.target.value; renderReport(); });
  $('#report-prev').addEventListener('click', () => { ui.report.anchor = shiftPeriod(ui.report.period, ui.report.anchor, -1); renderReport(); });
  $('#report-next').addEventListener('click', () => {
    const next = shiftPeriod(ui.report.period, ui.report.anchor, 1);
    ui.report.anchor = next > ui.today ? ui.today : next;
    renderReport();
  });
  reportBody.addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    closeDialog(dlgReports);
    setDate(b.dataset.day);
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });

  $('#erase-all').addEventListener('click', () => {
    if (!confirm('Erase all recipes, your food log and settings from this browser?\n\nThis can’t be undone. Download a backup first if you might want it back.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    state = freshState();
    ui.shown = { eaten: 0, remaining: state.settings.goal };
    applyTheme();
    renderAll();
    closeDialog($('#dlg-data'));
    toast('All data erased');
  });

  /* =========================================================
     Wiring
     ========================================================= */
  els.prev.addEventListener('click', () => setDate(addDays(ui.date, -1)));
  els.next.addEventListener('click', () => setDate(addDays(ui.date, 1)));
  els.goToday.addEventListener('click', () => setDate(ui.today));
  els.week.addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (b) setDate(b.dataset.day);
  });

  $('#open-reports').addEventListener('click', openReports);
  $('#open-reports-2').addEventListener('click', openReports);
  els.tabs.addEventListener('click', (e) => { const t = e.target.closest('[data-kind]'); if (t) setTab(t.dataset.kind); });
  els.tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    setTab(ui.tab === 'food' ? EXERCISE : 'food');
    $(`[data-kind="${ui.tab}"]`, els.tabs).focus();
  });
  $('#open-settings').addEventListener('click', () => openSettings(false));
  $('#edit-goal').addEventListener('click', () => openSettings(true));
  $('#footer-backup').addEventListener('click', () => openData());
  $('#open-new-recipes').addEventListener('click', () => openNewDialog());
  $$('[data-quick]').forEach((b) => b.addEventListener('click', () => openQuickDialog(b.dataset.quick)));

  wireMealPicker(els.mealPicker, setMeal);

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { ui.search = els.search.value; renderRecipes(); }, 80);
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.search.value) { e.preventDefault(); els.search.value = ''; ui.search = ''; renderRecipes(); }
    if (e.key === 'Enter') {
      // Enter adds the top match — handy when searching with the keyboard
      e.preventDefault();
      const first = $('[data-add]', els.recipeList);
      if (first) first.click();
    }
  });
  els.sort.addEventListener('change', () => { state.settings.sort = els.sort.value; save(); renderRecipes(); });

  els.recipeList.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { const r = recipeById(add.dataset.add); if (r) addRecipeToLog(r, add); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { openEditDialog(edit.dataset.edit); return; }
    const action = e.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'new') openNewDialog();
    if (action.dataset.action === 'samples') addSamples();
    if (action.dataset.action === 'new-from-search') openNewDialog(ui.search.trim());
  });

  // Keyboard shortcuts (only when not typing and no dialog is open)
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const typing = e.target.closest('input, textarea, select, [contenteditable]');
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); els.search.focus(); }
    else if (e.key === 'n') { e.preventDefault(); openNewDialog(); }
    else if (e.key === 'q') { e.preventDefault(); openQuickDialog('food'); }
    else if (e.key === 'e') { e.preventDefault(); openQuickDialog(EXERCISE); }
    else if (e.key === 'r') { e.preventDefault(); openReports(); }
    else if (e.key === 'ArrowLeft' && !e.target.closest('[role="radiogroup"]')) setDate(addDays(ui.date, -1));
    else if (e.key === 'ArrowRight' && !e.target.closest('[role="radiogroup"]')) setDate(addDays(ui.date, 1));
  });

  // Keep multiple tabs in sync
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    state = loadState();
    applyTheme();
    renderAll();
  });

  // Handle the day rolling over while the app is open in the background
  function checkRollover() {
    const now = dateKey();
    if (now === ui.today) {
      if (!ui.mealPicked && ui.meal !== defaultMeal()) { ui.meal = defaultMeal(); renderMealPicker(els.mealPicker, ui.meal, true); }
      return;
    }
    const wasToday = ui.date === ui.today;
    ui.today = now;
    if (wasToday) ui.date = now;
    if (!ui.mealPicked) ui.meal = defaultMeal();
    renderAll();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRollover(); });
  setInterval(checkRollover, 60 * 1000);

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderWeek, 120); });

  // Offline support when served over http(s)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // Open the app with ?debug to outline anything wider than the screen and show viewport details.
  // Useful for tracking down sideways scrolling on a specific phone/browser.
  function debugWidth() {
    $$('.debug-wide').forEach((e) => e.classList.remove('debug-wide'));
    const vw = document.documentElement.clientWidth;
    const bad = $$('body *').filter((e) => {
      if (e.closest('dialog:not([open]), .debug-panel, .sr-only')) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5);
    });
    bad.forEach((e) => e.classList.add('debug-wide'));
    const vv = window.visualViewport;
    const panel = $('.debug-panel') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'debug-panel' }));
    panel.textContent = [
      `innerWidth ${innerWidth} · clientWidth ${vw} · scrollWidth ${document.documentElement.scrollWidth}`,
      `visualViewport ${vv ? Math.round(vv.width) + ' @ scale ' + vv.scale.toFixed(2) : 'n/a'} · dpr ${devicePixelRatio}`,
      `font-size ${getComputedStyle(document.body).fontSize}`,
      navigator.userAgent,
      bad.length ? `${bad.length} element(s) past the edge:\n` + bad.slice(0, 15).map((e) => `  ${e.tagName.toLowerCase()}.${String(e.className.baseVal ?? e.className).replace(/\s+/g, '.')} → right ${Math.round(e.getBoundingClientRect().right)}`).join('\n') : 'Nothing past the edge ✓',
    ].join('\n');
  }
  if (/[?&]debug\b/.test(location.search)) {
    setTimeout(debugWidth, 600);
    window.addEventListener('resize', () => setTimeout(debugWidth, 200));
    window.visualViewport?.addEventListener('resize', () => setTimeout(debugWidth, 200));
  }

  applyTheme();
  renderAll();
})();
