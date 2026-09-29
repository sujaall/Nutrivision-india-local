/**
 * NutriVision India v3.0 — Unified Client Application
 * Clean, lightweight, modular architecture.
 * Perfectly mapped to Flask backend endpoints.
 */

// ── GLOBAL STATE ──────────────────────────────────────────────────
const AppState = {
  userId: 'nv_user',
  profile: null,
  diaryDate: new Date().toISOString().split('T')[0],
  diaryTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterGL: 0,
  currentFile: null,
  currentFoodName: '',
  currentNutrition: {},
  currentMealType: 'breakfast',
  searchCategory: 'all',
  searchTimer: null,
  geminiKey: localStorage.getItem('nv_gemini_key') || '',
  coachHistory: [],
  isCoachReplying: false
};
window.AppState = AppState;

// ── TOAST NOTIFICATION ────────────────────────────────────────────
function showToast(message, isError = false) {
  const toast = document.getElementById('app-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast show ' + (isError ? 'error' : 'success');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ── MODAL HELPERS ─────────────────────────────────────────────────
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-bg')) {
    e.target.classList.remove('open');
  }
});

// ── TAB NAVIGATION ────────────────────────────────────────────────
function switchTab(name) {
  try {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    const pane = document.getElementById('tab-' + name);
    if (pane) pane.classList.add('active');

    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    const navBtn = document.getElementById('nav-' + name);
    if (navBtn) navBtn.classList.add('active');

    if (name === 'home') {
      loadDashboard();
      renderWaterCups();
    } else if (name === 'log') {
      setLogTab('scan');
      loadDiaryTab();
    } else if (name === 'progress') {
      loadProgressTab();
    } else if (name === 'tools') {
      setToolTab('favourites');
    } else if (name === 'me') {
      refreshMeTab();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error('switchTab error:', err);
  }
}

function setLogTab(name) {
  try {
    document.querySelectorAll('#tab-log .inner-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#tab-log .inner-pane').forEach(p => p.classList.remove('active'));
    const btn = document.querySelector('#tab-log .inner-tab[data-t="' + name + '"]');
    const pane = document.getElementById('logtab-' + name);
    if (btn) btn.classList.add('active');
    if (pane) pane.classList.add('active');

    if (name === 'search') {
      const input = document.getElementById('food-search-input');
      const val = input ? input.value.trim() : '';
      performFoodSearch(val, AppState.searchCategory || 'all');
    } else if (name === 'diary') {
      loadDiaryTab();
    }
  } catch (err) {
    console.error('setLogTab error:', err);
  }
}

function setToolTab(name) {
  try {
    document.querySelectorAll('#tools-pills .pill').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#tab-tools .inner-pane').forEach(p => p.classList.remove('active'));
    const pill = document.querySelector('#tools-pills .pill[data-tt="' + name + '"]');
    const pane = document.getElementById('toolstab-' + name);
    if (pill) pill.classList.add('active');
    if (pane) pane.classList.add('active');

    if (name === 'favourites') loadFavourites();
    else if (name === 'recipes') loadSavedRecipes();
  } catch (err) {
    console.error('setToolTab error:', err);
  }
}

// ── GREETING & HEADER ─────────────────────────────────────────────
function updateGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning 👋' : h < 17 ? 'Good afternoon 👋' : 'Good evening 👋';
  const el = document.getElementById('home-greeting');
  if (el) el.textContent = g;

  const p = AppState.profile;
  const hl = document.getElementById('home-headline');
  if (hl) {
    hl.textContent = p && p.name ? `Hey ${p.name}, let's track today` : "Let's track today";
  }
}

// ── HOME DASHBOARD & CALORIE RING ─────────────────────────────────
async function loadDashboard() {
  updateGreeting();
  const p = AppState.profile;
  const cta = document.getElementById('hero-profile-cta');
  const dash = document.getElementById('dash-active-summary');

  if (!p) {
    if (cta) cta.style.display = 'block';
    if (dash) dash.style.display = 'none';
    loadHomeMealPreview();
    updateHomeExercise();
    return;
  }

  if (cta) cta.style.display = 'none';
  if (dash) dash.style.display = 'block';

  try {
    const res = await fetch(`/api/get_diary/${AppState.userId}?date=${AppState.diaryDate}`);
    const data = await res.json();
    const t = data.totals || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    AppState.diaryTotals = t;

    const targetCal = p.target_calories || (p.targets && p.targets.calories) || 2000;
    const targetPro = p.target_protein || (p.targets && p.targets.protein_g) || 120;
    const targetCarb = p.target_carbs || (p.targets && p.targets.carbs_g) || 250;
    const targetFat = p.target_fat || (p.targets && p.targets.fat_g) || 65;

    const eaten = Math.round(t.calories || 0);
    const rem = Math.max(0, targetCal - eaten);

    const setEl = (id, v) => {
      const e = document.getElementById(id);
      if (e) e.textContent = v;
    };

    setEl('dash-cal-remaining', rem);
    setEl('dash-cal-eaten', eaten + ' kcal');
    setEl('dash-cal-target', targetCal + ' kcal');

    // Ring gauge — circumference 2 * pi * 46 ≈ 289
    const circ = 289;
    const pct = Math.min(1, eaten / targetCal);
    const fill = document.getElementById('dash-gauge-fill');
    if (fill) fill.style.strokeDashoffset = circ - (circ * pct);

    // Macro bars
    const pro = Math.round(t.protein || 0);
    const carb = Math.round(t.carbs || 0);
    const fat = Math.round(t.fat || 0);

    const setBar = (barId, valId, v, target, unit) => {
      const bar = document.getElementById(barId);
      if (bar) bar.style.width = Math.min(100, Math.round((v / target) * 100)) + '%';
      setEl(valId, `${v}${unit} / ${target}${unit}`);
    };
    setBar('dash-pro-bar', 'dash-pro-val', pro, targetPro, 'g');
    setBar('dash-carb-bar', 'dash-carb-val', carb, targetCarb, 'g');
    setBar('dash-fat-bar', 'dash-fat-val', fat, targetFat, 'g');

    loadHomeMealPreview();
    updateHomeExercise();
  } catch (err) {
    console.error('loadDashboard error:', err);
  }
}

async function loadHomeMealPreview() {
  const container = document.getElementById('home-meal-preview');
  if (!container) return;

  try {
    const res = await fetch(`/api/get_diary/${AppState.userId}?date=${AppState.diaryDate}`);
    const data = await res.json();
    const entries = Array.isArray(data.entries) ? data.entries : [];

    if (!entries.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div><div class="empty-text">No meals logged yet today.<br>Tap <strong>Scan Food</strong> to start.</div></div>';
      return;
    }

    const recent = entries.slice(-3).reverse();
    container.innerHTML = recent.map(item => `
      <div class="meal-item" style="margin-bottom:6px;">
        <div class="meal-item-left">
          <div class="mi-name">${escapeHtml(item.food || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
          <div class="mi-sub">${escapeHtml(item.meal_type || 'meal')} · ${item.portion || 100}g</div>
        </div>
        <span class="mi-cal">${Math.round(item.calories || 0)} kcal</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('loadHomeMealPreview error:', err);
  }
}

async function updateHomeExercise() {
  try {
    const res = await fetch(`/api/get_exercise/${AppState.userId}?date=${AppState.diaryDate}`);
    const data = await res.json();
    const burned = data.total_burned || 0;
    const net = data.net_calories !== undefined ? data.net_calories : (AppState.diaryTotals.calories - burned);

    const bEl = document.getElementById('home-burned');
    if (bEl) bEl.textContent = burned;

    const nEl = document.getElementById('home-net');
    if (nEl) nEl.textContent = net + ' kcal';
  } catch (err) {
    console.error('updateHomeExercise error:', err);
  }
}

// ── WATER TRACKER ─────────────────────────────────────────────────
function renderWaterCups() {
  const container = document.getElementById('water-cups-home');
  if (!container) return;
  const filled = AppState.waterGL || 0;

  container.innerHTML = Array.from({ length: 8 }, (_, i) => `
    <div class="water-cup ${i < filled ? 'filled' : ''}" onclick="toggleWaterCup(${i})" title="Glass ${i + 1}">💧</div>
  `).join('');

  const countEl = document.getElementById('water-count-home');
  if (countEl) countEl.textContent = `${filled} / 8`;
}

async function toggleWaterCup(index) {
  const filled = AppState.waterGL || 0;
  AppState.waterGL = (index < filled && index === filled - 1) ? index : index + 1;
  renderWaterCups();

  try {
    await fetch('/api/log_water', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        date: AppState.diaryDate,
        action: 'set',
        amount_ml: AppState.waterGL * 250
      })
    });
  } catch (e) {}
}

async function loadWaterData() {
  try {
    const res = await fetch(`/api/get_water/${AppState.userId}?date=${AppState.diaryDate}`);
    const data = await res.json();
    const ml = data.water_ml || 0;
    AppState.waterGL = Math.min(8, Math.round(ml / 250));
    renderWaterCups();
  } catch (e) {
    renderWaterCups();
  }
}

// ── FOOD IMAGE SCANNER ────────────────────────────────────────────
function handleScanFile(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;

  AppState.currentFile = file;
  const preview = document.getElementById('scan-preview-img');
  if (preview) {
    preview.src = URL.createObjectURL(file);
    preview.style.display = 'block';
  }

  const zone = document.getElementById('scan-zone');
  if (zone) zone.style.borderStyle = 'solid';

  const btn = document.getElementById('btn-analyze');
  if (btn) btn.style.display = 'flex';

  const res = document.getElementById('scan-result');
  if (res) res.style.display = 'none';

  const analyzing = document.getElementById('scan-analyzing');
  if (analyzing) analyzing.style.display = 'none';
}

async function analyzeFood() {
  if (!AppState.currentFile) {
    showToast('Upload or snap a food photo first.', true);
    return;
  }

  const btn = document.getElementById('btn-analyze');
  const analyzing = document.getElementById('scan-analyzing');
  const resultDiv = document.getElementById('scan-result');

  if (btn) btn.style.display = 'none';
  if (analyzing) analyzing.style.display = 'block';
  if (resultDiv) resultDiv.style.display = 'none';

  try {
    const fd = new FormData();
    fd.append('file', AppState.currentFile);
    fd.append('user_id', AppState.userId);

    const res = await fetch('/analyze', { method: 'POST', body: fd });
    const data = await res.json();

    if (analyzing) analyzing.style.display = 'none';

    if (!res.ok || data.error) {
      showToast(data.error || 'Could not identify dish.', true);
      if (btn) btn.style.display = 'flex';
      return;
    }

    const foodName = data.food_name || (data.predictions && data.predictions[0] && data.predictions[0].food) || 'Indian Dish';
    const nut = data.nutrition || { calories_per_100g: 150, protein: 4, carbs: 20, fat: 5 };
    const aiSource = data.ai_source || 'pytorch_ensemble';
    const isGemini = aiSource === 'gemini_vision';
    const isVerified = data.ai_verified === true;
    const pytorchConf = data.pytorch_confidence || 0;
    const predictions = data.predictions || [];

    AppState.currentFoodName = foodName;
    AppState.currentNutrition = nut;

    // ── Food Name ──
    const nameEl = document.getElementById('result-food-name');
    if (nameEl) nameEl.textContent = foodName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // ── AI Description ──
    const descEl = document.getElementById('result-ai-desc');
    const desc = data.gemini_description || nut.notes || '';
    if (descEl && desc) {
      descEl.textContent = desc;
      descEl.style.display = 'block';
    } else if (descEl) {
      descEl.style.display = 'none';
    }

    // ── Badge Row ──
    const badgesRow = document.getElementById('result-badges-row');
    if (badgesRow) {
      const badges = [];

      // Gemini Verified badge with model confidence
      if (isGemini) {
        const modelConf = pytorchConf > 0 ? `Models: ${pytorchConf.toFixed(1)}%` : 'Gemini Verified';
        badges.push(`<span class="ai-badge ai-badge-verified">✅ Gemini Verified (${modelConf})</span>`);
        badges.push(`<span class="ai-badge ai-badge-verified">+ AI Verified</span>`);
        badges.push(`<span class="ai-badge ai-badge-gemini">✦ Gemini Vision</span>`);
      } else {
        // PyTorch-only result
        const conf = pytorchConf > 0 ? pytorchConf.toFixed(1) : (predictions[0] ? parseFloat(predictions[0].confidence) : 0);
        badges.push(`<span class="ai-badge ai-badge-pytorch">🤖 PyTorch Ensemble</span>`);
        if (conf > 0) badges.push(`<span class="ai-badge ai-badge-conf">📊 ${conf}% Confidence</span>`);
      }

      badgesRow.innerHTML = badges.join('');
    }

    // ── Predictions Section ──
    const predsSection = document.getElementById('result-predictions-section');
    const ensembleChips = document.getElementById('result-ensemble-chips');
    const geminiMatchDiv = document.getElementById('result-gemini-match');
    const geminiChip = document.getElementById('result-gemini-chip');

    if (predictions.length > 0) {
      if (predsSection) predsSection.style.display = 'block';

      // Gemini top match chip (shown in "Other Likely Matches")
      const geminiPred = predictions.find(p => p.source === 'gemini_vision');
      if (geminiMatchDiv && geminiChip && geminiPred) {
        geminiChip.innerHTML = `✦ Gemini Vision &nbsp;<strong>${escapeHtml((geminiPred.display || geminiPred.food || '').replace(/_/g,' ').toUpperCase())}</strong>`;
        geminiMatchDiv.style.display = 'block';
      } else if (geminiMatchDiv) {
        geminiMatchDiv.style.display = 'none';
      }

      // Ensemble chips — show pytorch predictions
      if (ensembleChips) {
        const pytorchPreds = predictions.filter(p => p.source === 'pytorch' || !p.source || p.source === 'pytorch_ensemble');
        const toShow = pytorchPreds.length ? pytorchPreds : predictions;
        ensembleChips.innerHTML = toShow.slice(0, 5).map((p, i) => {
          const label = (p.food || '').replace(/_/g, ' ').toUpperCase();
          const conf = p.confidence || '0%';
          return `<div class="ensemble-chip${i === 0 ? ' top' : ''}">${escapeHtml(label)} <span style="opacity:.6;font-size:.65rem;">(${conf})</span></div>`;
        }).join('');
      }
    } else {
      if (predsSection) predsSection.style.display = 'none';
    }

    // Reset slider
    const slider = document.getElementById('portion-slider-input');
    if (slider) slider.value = nut.portion_estimate_g || 100;
    updateScanResult(nut.portion_estimate_g || 100);

    if (resultDiv) resultDiv.style.display = 'block';
  } catch (err) {
    console.error('analyzeFood error:', err);
    if (analyzing) analyzing.style.display = 'none';
    if (btn) btn.style.display = 'flex';
    showToast('Analysis failed. Try again.', true);
  }
}

function updateScanResult(portion) {
  const n = AppState.currentNutrition || {};
  const factor = (portion || 100) / 100;

  const cal = Math.round((n.calories_per_100g || 0) * factor);
  const pro = Math.round((n.protein || 0) * factor * 10) / 10;
  const carb = Math.round((n.carbs || 0) * factor * 10) / 10;
  const fat = Math.round((n.fat || 0) * factor * 10) / 10;

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setVal('portion-display', `${portion}g`);
  // Correct IDs matching the HTML: r-cal, r-pro, r-car, r-fat
  setVal('r-cal', cal);
  setVal('r-pro', pro + 'g');
  setVal('r-car', carb + 'g');
  setVal('r-fat', fat + 'g');
}

function updatePortion(val) {
  updateScanResult(parseInt(val, 10));
}

function selectMealType(el, type) {
  // Pills are in logtab-scan, not inside scan-result
  document.querySelectorAll('#logtab-scan .pill[data-meal]').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  AppState.currentMealType = type;
}

async function saveCurrentAsFavourite() {
  if (!AppState.currentFoodName) {
    showToast('No food scanned yet.', true);
    return;
  }
  const portion = parseInt(document.getElementById('portion-slider-input')?.value || '100', 10);
  const factor = portion / 100;
  const n = AppState.currentNutrition || {};
  const name = AppState.currentFoodName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  try {
    const res = await fetch('/api/save_favourite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        name: name,
        food: AppState.currentFoodName,
        display_name: name,
        portion: portion,
        calories: Math.round((n.calories_per_100g || 0) * factor),
        protein: Math.round((n.protein || 0) * factor * 10) / 10,
        carbs: Math.round((n.carbs || 0) * factor * 10) / 10,
        fat: Math.round((n.fat || 0) * factor * 10) / 10,
        meal_type: AppState.currentMealType || 'lunch'
      })
    });
    const d = await res.json();
    if (d.success) showToast(`⭐ Saved "${name}" as favourite!`);
    else showToast('Could not save favourite.', true);
  } catch (e) {
    showToast('Save failed.', true);
  }
}

async function logScannedFood() {
  if (!AppState.currentFoodName) return;
  const portion = parseInt(document.getElementById('portion-slider-input')?.value || '100', 10);
  const factor = portion / 100;
  const n = AppState.currentNutrition || {};

  try {
    const res = await fetch('/api/log_meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        date: AppState.diaryDate,
        food: AppState.currentFoodName,
        portion: portion,
        calories: Math.round((n.calories_per_100g || 0) * factor),
        protein: Math.round((n.protein || 0) * factor * 10) / 10,
        carbs: Math.round((n.carbs || 0) * factor * 10) / 10,
        fat: Math.round((n.fat || 0) * factor * 10) / 10,
        meal_type: AppState.currentMealType
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Logged to diary! ✅');
      const resCard = document.getElementById('scan-result');
      if (resCard) resCard.style.display = 'none';
      const preview = document.getElementById('scan-preview-img');
      if (preview) preview.style.display = 'none';
      const zone = document.getElementById('scan-zone');
      if (zone) zone.style.borderStyle = 'dashed';
      AppState.currentFile = null;
      loadDashboard();
    } else {
      showToast('Could not save meal.', true);
    }
  } catch (err) {
    showToast('Failed to log meal.', true);
  }
}

// ── FOOD SEARCH & DATABASE ─────────────────────────────────────────
function filterCategory(el, cat) {
  document.querySelectorAll('#logtab-search .pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  AppState.searchCategory = cat;
  const input = document.getElementById('food-search-input');
  performFoodSearch(input ? input.value.trim() : '', cat);
}

function searchFood(query) {
  clearTimeout(AppState.searchTimer);
  AppState.searchTimer = setTimeout(() => {
    performFoodSearch(query, AppState.searchCategory || 'all');
  }, 250);
}

let _searchResultsCache = [];
async function performFoodSearch(query, category) {
  const container = document.getElementById('search-results-list');
  if (!container) return;

  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const url = `/api/search_food?q=${encodeURIComponent(query || '')}&category=${encodeURIComponent(category || 'all')}`;
    const res = await fetch(url);
    const data = await res.json();
    const items = data.results || [];
    _searchResultsCache = items;

    if (!items.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">No matching foods found.<br>Try a different keyword.</div></div>';
      return;
    }

    container.innerHTML = items.map((item, idx) => `
      <div class="food-row" onclick="openFoodModalByIndex(${idx})">
        <div>
          <div class="food-row-name">${escapeHtml(item.display_name || item.name || '')} ${item.is_veg ? '🟢' : '🔴'}</div>
          <div class="food-row-cal">${Math.round(item.calories_per_100g || 0)} kcal · ${item.protein || 0}g P per 100g</div>
        </div>
        <button class="food-add-btn" onclick="event.stopPropagation(); openFoodModalByIndex(${idx})">+</button>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty"><div class="empty-text">Error loading foods.</div></div>';
  }
}

let _modalFoodItem = null;
let _modalFoodMeal = 'breakfast';

function openFoodModalByIndex(idx) {
  const food = _searchResultsCache[idx];
  if (!food) return;
  _modalFoodItem = food;

  const nameEl = document.getElementById('food-modal-name');
  if (nameEl) nameEl.textContent = food.display_name || food.name;

  const slider = document.getElementById('fm-portion-slider');
  if (slider) slider.value = 100;
  updateFoodModalPortion(100);

  openModal('food-detail-modal');
}

function updateFoodModalPortion(val) {
  const portion = parseInt(val, 10) || 100;
  const disp = document.getElementById('fm-portion-display');
  if (disp) disp.textContent = `${portion}g`;

  if (!_modalFoodItem) return;
  const factor = portion / 100;
  const cal = Math.round((_modalFoodItem.calories_per_100g || 0) * factor);
  const pro = Math.round((_modalFoodItem.protein || 0) * factor * 10) / 10;
  const carb = Math.round((_modalFoodItem.carbs || 0) * factor * 10) / 10;
  const fat = Math.round((_modalFoodItem.fat || 0) * factor * 10) / 10;

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setVal('fm-cal', cal);
  setVal('fm-pro', pro + 'g');
  setVal('fm-car', carb + 'g');
  setVal('fm-fat', fat + 'g');
}

function fmSelectMeal(el, meal) {
  document.querySelectorAll('#food-detail-modal .pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  _modalFoodMeal = meal;
}

async function logFromFoodModal() {
  if (!_modalFoodItem) return;
  const portion = parseInt(document.getElementById('fm-portion-slider')?.value || '100', 10);
  const factor = portion / 100;

  try {
    const res = await fetch('/api/log_meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        date: AppState.diaryDate,
        food: _modalFoodItem.name || _modalFoodItem.display_name,
        portion: portion,
        calories: Math.round((_modalFoodItem.calories_per_100g || 0) * factor),
        protein: Math.round((_modalFoodItem.protein || 0) * factor * 10) / 10,
        carbs: Math.round((_modalFoodItem.carbs || 0) * factor * 10) / 10,
        fat: Math.round((_modalFoodItem.fat || 0) * factor * 10) / 10,
        meal_type: _modalFoodMeal
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Added to diary! ✅');
      closeModal('food-detail-modal');
      loadDashboard();
    }
  } catch (err) {
    showToast('Failed to add meal.', true);
  }
}

// ── BARCODE SCANNER ───────────────────────────────────────────────
let _barcodeDetections = {};   // code → count of consistent reads
let _barcodeLocked = false;    // prevent double-fire
let _barcodeCurrentData = null;// last fetched product

function manualBarcodeSearch() {
  const inp = document.getElementById('manual-barcode-input');
  const code = (inp ? inp.value : '').trim().replace(/\D/g, '');
  if (!code || code.length < 6) {
    showToast('Enter a valid barcode number.', true);
    return;
  }
  lookupBarcode(code);
}

function startBarcodeScanner() {
  const promptCard = document.getElementById('barcode-prompt-card');
  const view = document.getElementById('barcode-scanner-view');
  const wrap = document.getElementById('barcode-video-wrap');

  if (!wrap) return;
  if (view) view.style.display = 'block';
  if (promptCard) promptCard.style.display = 'none';

  _barcodeDetections = {};
  _barcodeLocked = false;

  if (typeof Quagga === 'undefined') {
    showToast('Barcode scanner module not loaded.', true);
    stopBarcodeScanner();
    return;
  }

  Quagga.init({
    inputStream: {
      name: 'Live',
      type: 'LiveStream',
      target: wrap,
      constraints: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'environment',
        focusMode: 'continuous'
      },
      area: { top: '15%', right: '5%', left: '5%', bottom: '15%' }  // limit scan area
    },
    locator: { patchSize: 'medium', halfSample: false },
    numOfWorkers: 2,
    frequency: 12,
    decoder: {
      readers: [
        'ean_reader',        // EAN-13 (most Indian products)
        'ean_8_reader',      // EAN-8
        'upc_reader',        // UPC-A
        'upc_e_reader',      // UPC-E
        'code_128_reader',   // Code 128 (some packets)
        'code_39_reader'     // Code 39
      ],
      multiple: false
    }
  }, (err) => {
    if (err) {
      showToast('Camera access denied — use manual entry below.', true);
      stopBarcodeScanner();
      return;
    }
    Quagga.start();
    const st = document.getElementById('barcode-scan-status');
    if (st) st.textContent = '🟠 Scanning — hold barcode steady inside the frame';
  });

  // Remove any existing listener first
  Quagga.offDetected();

  Quagga.onDetected((result) => {
    if (_barcodeLocked) return;

    const code = result?.codeResult?.code;
    const err = result?.codeResult?.decodedCodes?.reduce((sum, d) => sum + (d.error || 0), 0) / (result?.codeResult?.decodedCodes?.length || 1);

    // Only accept high-confidence reads (low error rate)
    if (!code || err > 0.22) return;

    _barcodeDetections[code] = (_barcodeDetections[code] || 0) + 1;

    const st = document.getElementById('barcode-scan-status');

    // Require 3 consistent reads of the same code
    if (_barcodeDetections[code] >= 3) {
      _barcodeLocked = true;
      if (st) st.textContent = `✅ Got it! Looking up ${code}...`;

      // Flash the laser green
      const laser = document.getElementById('barcode-laser');
      if (laser) {
        laser.style.background = 'linear-gradient(90deg,transparent,#10b981,transparent)';
        laser.style.boxShadow = '0 0 12px #10b981';
      }

      setTimeout(() => {
        stopBarcodeScanner();
        lookupBarcode(code);
      }, 400);
    } else {
      if (st) st.textContent = `🟠 Barcode detected (${_barcodeDetections[code]}/3 confirmations)…`;
    }
  });
}

function stopBarcodeScanner() {
  if (typeof Quagga !== 'undefined') {
    try { Quagga.stop(); } catch (e) {}
    Quagga.offDetected();
  }
  const view = document.getElementById('barcode-scanner-view');
  if (view) view.style.display = 'none';
  const promptCard = document.getElementById('barcode-prompt-card');
  if (promptCard) promptCard.style.display = 'block';
  _barcodeLocked = false;
  _barcodeDetections = {};
}

async function lookupBarcode(code) {
  showToast(`🔍 Looking up barcode ${code}…`);
  const container = document.getElementById('barcode-result');
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = `
    <div class="result-card" style="text-align:center;padding:20px;">
      <div class="spinner" style="margin:0 auto 10px;"></div>
      <div style="font-size:.82rem;color:#64748b;">Searching Open Food Facts, USDA &amp; AI database…<br><strong style="color:#f97316;">${escapeHtml(code)}</strong></div>
    </div>`;

  try {
    const res = await fetch(`/api/barcode/${encodeURIComponent(code)}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      container.innerHTML = `
        <div class="result-card" style="text-align:center;padding:20px;">
          <div style="font-size:1.8rem;margin-bottom:8px;">❌</div>
          <div style="color:#ef4444;font-size:.88rem;font-weight:600;">Product not found</div>
          <div style="font-size:.76rem;color:#64748b;margin:6px 0 14px;">Barcode: ${escapeHtml(code)}</div>
          <button class="btn btn-primary btn-block" onclick="startBarcodeScanner()">&#x1F501; Try Again</button>
        </div>`;
      return;
    }

    _barcodeCurrentData = data;
    renderBarcodeResult(data, code);
  } catch (err) {
    container.innerHTML = `<div style="color:#ef4444;font-size:.85rem;padding:12px;text-align:center;">Lookup failed. Check connection &amp; try again.</div>`;
  }
}

let _barcodeServing = 100;  // current serving size in grams

function renderBarcodeResult(data, code) {
  const container = document.getElementById('barcode-result');
  if (!container) return;

  const name = data.name || data.product_name || 'Packaged Product';
  const cal100 = data.calories_per_100g || 0;
  const pro100 = data.protein || 0;
  const car100 = data.carbs || 0;
  const fat100 = data.fat || 0;
  const source = data.source || 'Product Database';
  const brand = data.brand || '';
  const serving = data.serving_size_g || 100;
  _barcodeServing = serving;

  // Source badge colour
  const isOFF = source.includes('Open Food');
  const isUSDA = source.includes('USDA');
  const isAI = source.includes('AI') || source.includes('Universal');
  const badgeColor = isOFF ? '#10b981' : isUSDA ? '#38bdf8' : '#a78bfa';
  const badgeBg = isOFF ? 'rgba(16,185,129,.12)' : isUSDA ? 'rgba(56,189,248,.12)' : 'rgba(167,139,250,.12)';
  const sourceIcon = isOFF ? '🌍' : isUSDA ? '🇺🇸' : '🤖';

  container.innerHTML = `
    <div class="result-card">
      <!-- Source & barcode badges -->
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
        <span style="display:inline-flex;align-items:center;gap:4px;background:${badgeBg};border:1px solid ${badgeColor}40;border-radius:99px;padding:3px 10px;font-size:.68rem;font-weight:700;color:${badgeColor};">
          ${sourceIcon} ${escapeHtml(source.split('(')[0].trim())}
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px;background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.25);border-radius:99px;padding:3px 10px;font-size:.68rem;font-weight:700;color:#fb923c;">
          📦 ${escapeHtml(code)}
        </span>
      </div>

      <!-- Product name -->
      <div class="result-name" style="margin-bottom:2px;">${escapeHtml(name)}</div>
      ${brand ? `<div style="font-size:.75rem;color:#64748b;margin-bottom:10px;">${escapeHtml(brand)}</div>` : ''}

      <!-- Serving size selector -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;background:rgba(255,255,255,.04);border-radius:10px;padding:8px 12px;">
        <span style="font-size:.78rem;color:#94a3b8;">Serving size</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <button onclick="setBarcodeServing(this,100)" class="pill ${serving===100?'active':''}" style="padding:3px 10px;font-size:.7rem;">100g</button>
          <button onclick="setBarcodeServing(this,${serving})" class="pill ${serving!==100?'active':''}" style="padding:3px 10px;font-size:.7rem;">${serving}g (1 srv)</button>
          <span style="font-size:.78rem;font-weight:700;color:#f97316;" id="bc-serving-label">${_barcodeServing}g</span>
        </div>
      </div>

      <!-- Macro boxes -->
      <div class="macros-row" id="bc-macros">
        <div class="macro-box"><div class="mv cal" id="bc-cal">${Math.round(cal100 * _barcodeServing / 100)}</div><div class="ml">kcal</div></div>
        <div class="macro-box"><div class="mv pro" id="bc-pro">${Math.round(pro100 * _barcodeServing / 100 * 10) / 10}g</div><div class="ml">protein</div></div>
        <div class="macro-box"><div class="mv car" id="bc-car">${Math.round(car100 * _barcodeServing / 100 * 10) / 10}g</div><div class="ml">carbs</div></div>
        <div class="macro-box"><div class="mv fat" id="bc-fat">${Math.round(fat100 * _barcodeServing / 100 * 10) / 10}g</div><div class="ml">fat</div></div>
      </div>

      <!-- Portion slider -->
      <div class="portion-row" style="margin-bottom:4px;"><span class="portion-lbl">Custom portion</span><span class="portion-val" id="bc-custom-label">${_barcodeServing}g</span></div>
      <input type="range" id="bc-portion-slider" min="10" max="500" value="${_barcodeServing}" step="5"
             oninput="updateBarcodePortionSlider(this.value)">

      <!-- Meal type -->
      <div class="pill-row" style="margin-bottom:12px;">
        <span style="font-size:.72rem;color:#64748b;align-self:center;">Meal:</span>
        <div class="pill active" data-meal="breakfast" onclick="bcSelectMeal(this,'breakfast')">Breakfast</div>
        <div class="pill" data-meal="lunch" onclick="bcSelectMeal(this,'lunch')">Lunch</div>
        <div class="pill" data-meal="dinner" onclick="bcSelectMeal(this,'dinner')">Dinner</div>
        <div class="pill" data-meal="snack" onclick="bcSelectMeal(this,'snack')">Snack</div>
      </div>

      <!-- Log button -->
      <button class="btn btn-primary btn-block" onclick="logBarcodeProduct()">✅ Add to Diary</button>
      <button style="display:block;width:100%;margin-top:8px;background:none;border:none;color:#64748b;font-size:.75rem;cursor:pointer;padding:6px;" onclick="startBarcodeScanner()">🔄 Wrong product? Scan again</button>
    </div>
  `;
}

let _bcMealType = 'breakfast';
function bcSelectMeal(el, type) {
  document.querySelectorAll('#barcode-result .pill[data-meal]').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  _bcMealType = type;
}

function setBarcodeServing(el, grams) {
  _barcodeServing = grams;
  document.querySelectorAll('#barcode-result .pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  const slider = document.getElementById('bc-portion-slider');
  if (slider) slider.value = grams;
  updateBarcodePortionSlider(grams);
}

function updateBarcodePortionSlider(val) {
  _barcodeServing = parseInt(val, 10);
  const d = _barcodeCurrentData || {};
  const factor = _barcodeServing / 100;
  const setEl = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setEl('bc-cal', Math.round((d.calories_per_100g || 0) * factor));
  setEl('bc-pro', Math.round((d.protein || 0) * factor * 10) / 10 + 'g');
  setEl('bc-car', Math.round((d.carbs || 0) * factor * 10) / 10 + 'g');
  setEl('bc-fat', Math.round((d.fat || 0) * factor * 10) / 10 + 'g');
  setEl('bc-serving-label', _barcodeServing + 'g');
  setEl('bc-custom-label', _barcodeServing + 'g');
}

async function logBarcodeProduct() {
  const d = _barcodeCurrentData;
  if (!d) { showToast('No product loaded.', true); return; }
  const factor = _barcodeServing / 100;
  try {
    const res = await fetch('/api/log_meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        date: AppState.diaryDate,
        food: d.name,
        portion: _barcodeServing,
        calories: Math.round((d.calories_per_100g || 0) * factor),
        protein: Math.round((d.protein || 0) * factor * 10) / 10,
        carbs: Math.round((d.carbs || 0) * factor * 10) / 10,
        fat: Math.round((d.fat || 0) * factor * 10) / 10,
        meal_type: _bcMealType,
        source: 'barcode'
      })
    });
    const r = await res.json();
    if (r.success) {
      showToast(`✅ ${d.name} logged to diary!`);
      const container = document.getElementById('barcode-result');
      if (container) container.style.display = 'none';
      _barcodeCurrentData = null;
      loadDashboard();
    }
  } catch (e) {
    showToast('Failed to log product.', true);
  }
}

// ── VOICE LOGGING ─────────────────────────────────────────────────
function startVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('Voice input is not supported in this browser.', true);
    return;
  }
  const rec = new SR();
  rec.lang = 'en-IN';
  showToast('🎤 Listening... Speak your meal');

  rec.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    const input = document.getElementById('voice-text-input');
    if (input) input.value = transcript;
    parseVoiceLog();
  };
  rec.onerror = () => showToast('Voice recognition error.', true);
  rec.start();
}

let _voiceParsedItems = [];
let _voiceMealType = 'breakfast';

async function parseVoiceLog() {
  const input = document.getElementById('voice-text-input');
  const text = (input ? input.value : '').trim();
  if (!text) {
    showToast('Type or speak your meal first.', true);
    return;
  }

  const out = document.getElementById('voice-parse-result');
  if (out) {
    out.style.display = 'block';
    out.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  }

  try {
    const res = await fetch('/api/voice_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        user_id: AppState.userId,
        api_key: AppState.geminiKey
      })
    });
    const data = await res.json();
    if (!data.success || !data.parsed) {
      if (out) out.innerHTML = `<div style="color:#ef4444;font-size:.85rem;padding:8px;">${data.error || 'Could not understand meal.'}</div>`;
      return;
    }

    const p = data.parsed;
    _voiceMealType = p.meal_type || 'lunch';
    _voiceParsedItems = p.items || [];

    if (!_voiceParsedItems.length) {
      if (out) out.innerHTML = '<div style="color:#ef4444;padding:8px;">No foods identified.</div>';
      return;
    }

    if (out) {
      // Helper: resolve calories from any field Gemini may return
      const itemCal = (item) => {
        return Math.round(
          item.calories ||
          item.calories_total ||
          ((item.calories_per_100g || 0) * (item.portion_g || 100) / 100)
        );
      };

      const mealEmoji = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🥪' };
      const emoji = mealEmoji[_voiceMealType] || '🍽️';

      out.innerHTML = `
        <div class="result-card">
          <div class="result-name">${emoji} ${_voiceMealType.charAt(0).toUpperCase() + _voiceMealType.slice(1)}</div>
          <div style="margin:10px 0;">
            ${_voiceParsedItems.map(item => {
              const cal = itemCal(item);
              const name = item.display_name || (item.food || '').replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
              const portionDesc = item.quantity_description || `${item.portion_g || 100}g`;
              return `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                <div>
                  <div style="font-size:.88rem;font-weight:600;color:#f0f4f8;">${escapeHtml(name)}</div>
                  <div style="font-size:.72rem;color:#64748b;margin-top:2px;">${escapeHtml(portionDesc)} · ${item.protein||0}g P · ${item.carbs||0}g C · ${item.fat||0}g F</div>
                </div>
                <span style="font-weight:800;color:#f97316;font-size:.95rem;">${cal} <span style="font-size:.65rem;font-weight:600;">kcal</span></span>
              </div>`;
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);">
            <span style="font-size:.8rem;color:#94a3b8;">Total</span>
            <span style="font-weight:800;color:#f97316;">${_voiceParsedItems.reduce((s,i) => s + (i.calories || i.calories_total || Math.round((i.calories_per_100g||0)*(i.portion_g||100)/100)), 0)} kcal</span>
          </div>
          <button class="btn btn-primary btn-block" onclick="logVoiceParsedMeals()">✅ Add All to Diary</button>
        </div>
      `;
    }
  } catch (err) {
    if (out) out.innerHTML = '<div style="color:#ef4444;padding:8px;">Voice parsing failed.</div>';
  }
}

async function logVoiceParsedMeals() {
  if (!_voiceParsedItems.length) return;
  let logged = 0;
  for (const item of _voiceParsedItems) {
    try {
      // Resolve calories with triple fallback
      const cal = Math.round(
        item.calories ||
        item.calories_total ||
        ((item.calories_per_100g || 0) * (item.portion_g || 100) / 100)
      );
      // Resolve macros — Gemini sometimes puts them at top-level per-portion
      const pro = parseFloat(item.protein || 0);
      const carb = parseFloat(item.carbs || item.carbohydrates || 0);
      const fat = parseFloat(item.fat || 0);

      await fetch('/api/log_meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: AppState.userId,
          date: AppState.diaryDate,
          food: item.food || item.display_name || 'Food Item',
          portion: item.portion_g || 100,
          calories: cal,
          protein: pro,
          carbs: carb,
          fat: fat,
          meal_type: _voiceMealType
        })
      });
      logged++;
    } catch (e) { console.error('logVoiceParsedMeals item error:', e); }
  }
  showToast(`${logged} item${logged !== 1 ? 's' : ''} added to diary! ✅`);
  const out = document.getElementById('voice-parse-result');
  if (out) out.style.display = 'none';
  const inp = document.getElementById('voice-text-input');
  if (inp) inp.value = '';
  loadDashboard();
}

// ── DIARY VIEW & DATE NAVIGATION ──────────────────────────────────
function changeDiaryDate(delta) {
  const d = new Date(AppState.diaryDate);
  d.setDate(d.getDate() + delta);
  AppState.diaryDate = d.toISOString().split('T')[0];
  loadDiaryTab();
  loadDashboard();
}

async function loadDiaryTab() {
  const label = document.getElementById('diary-date-label');
  if (label) {
    const today = new Date().toISOString().split('T')[0];
    label.textContent = AppState.diaryDate === today ? 'Today' : AppState.diaryDate;
  }

  const container = document.getElementById('diary-entries-list');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`/api/get_diary/${AppState.userId}?date=${AppState.diaryDate}`);
    const data = await res.json();
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const totals = data.totals || { calories: 0, protein: 0, carbs: 0, fat: 0 };

    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    setVal('diary-total-cal', Math.round(totals.calories || 0));
    setVal('diary-total-pro', Math.round(totals.protein || 0) + 'g');
    setVal('diary-total-carb', Math.round(totals.carbs || 0) + 'g');
    setVal('diary-total-fat', Math.round(totals.fat || 0) + 'g');

    if (!entries.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">📖</div><div class="empty-text">No meals logged for this date.</div></div>';
      return;
    }

    // Group entries by meal_type
    const mealGroups = { breakfast: [], lunch: [], dinner: [], snack: [] };
    entries.forEach((item, idx) => {
      const mt = (item.meal_type || 'snack').toLowerCase();
      if (!mealGroups[mt]) mealGroups[mt] = [];
      mealGroups[mt].push({ item, originalIndex: idx });
    });

    let html = '';
    const groupTitles = {
      breakfast: '🌅 Breakfast',
      lunch: '☀️ Lunch',
      dinner: '🌙 Dinner',
      snack: '🥪 Snacks & Drinks'
    };

    for (const [key, group] of Object.entries(mealGroups)) {
      if (!group.length) continue;
      const groupCal = group.reduce((sum, g) => sum + (g.item.calories || 0), 0);
      html += `
        <div class="meal-group-lbl" style="display:flex;justify-content:space-between;">
          <span>${groupTitles[key] || key}</span>
          <span>${Math.round(groupCal)} kcal</span>
        </div>
      `;
      group.forEach(g => {
        const item = g.item;
        html += `
          <div class="meal-item">
            <div>
              <div class="mi-name">${escapeHtml(item.food || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
              <div class="mi-sub">${item.portion || 100}g · ${item.protein || 0}g P · ${item.carbs || 0}g C · ${item.fat || 0}g F</div>
            </div>
            <div style="display:flex;align-items:center;">
              <span class="mi-cal">${Math.round(item.calories || 0)} kcal</span>
              <button class="mi-del" onclick="deleteDiaryEntry(${g.originalIndex})" title="Delete item">🗑️</button>
            </div>
          </div>
        `;
      });
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="empty"><div class="empty-text">Could not load diary.</div></div>';
  }
}

async function deleteDiaryEntry(index) {
  if (!confirm('Remove this food from diary?')) return;
  try {
    const res = await fetch('/api/delete_meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        date: AppState.diaryDate,
        meal_index: index
      })
    });
    const d = await res.json();
    if (d.success) {
      showToast('Item deleted.');
      loadDiaryTab();
      loadDashboard();
    }
  } catch (err) {
    showToast('Delete failed.', true);
  }
}

// ── PROGRESS TAB (ANALYTICS, EXERCISE, MICROS) ────────────────────
async function loadProgressTab() {
  loadAnalytics(7);
  loadProgressExercise();
  loadMicronutrients();
  loadGlycemicInfo();
}

async function loadProgressExercise() {
  try {
    const exRes = await fetch(`/api/get_exercise/${AppState.userId}?date=${AppState.diaryDate}`);
    const exData = await exRes.json();

    const dRes = await fetch(`/api/get_diary/${AppState.userId}?date=${AppState.diaryDate}`);
    const dData = await dRes.json();

    const foodCal = Math.round((dData.totals && dData.totals.calories) || 0);
    const burned = exData.total_burned || 0;
    const net = foodCal - burned;

    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    setVal('p-food-cal', foodCal);
    setVal('p-burned-cal', burned);
    setVal('p-net-cal', net);

    const listEl = document.getElementById('p-exercise-list');
    if (!listEl) return;
    const entries = exData.entries || [];
    if (!entries.length) {
      listEl.innerHTML = '<div style="font-size:.83rem;color:#64748b;padding:8px 0;">No exercise logged today.</div>';
      return;
    }

    listEl.innerHTML = entries.map((e, idx) => `
      <div class="ex-row">
        <div>
          <div class="ex-name">${escapeHtml(e.exercise || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
          <div class="ex-sub">${e.duration_min} min · ${e.time || ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="ex-burned">-${e.calories_burned} kcal</span>
          <button onclick="deleteExercise(${idx})" style="background:none;border:none;color:#64748b;cursor:pointer;">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('loadProgressExercise error:', err);
  }
}

function openExerciseModal() {
  openModal('exercise-modal');
}

async function logExercise() {
  const type = document.getElementById('ex-type-select')?.value || 'walking';
  const duration = parseFloat(document.getElementById('ex-duration')?.value || '30');
  const weight = (AppState.profile && AppState.profile.weight) || 70;

  try {
    const res = await fetch('/api/log_exercise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        date: AppState.diaryDate,
        exercise_type: type,
        duration_min: duration,
        weight_kg: weight
      })
    });
    const d = await res.json();
    if (d.success) {
      showToast(`🔥 Burned ${d.calories_burned} kcal!`);
      closeModal('exercise-modal');
      loadProgressExercise();
      loadDashboard();
    }
  } catch (err) {
    showToast('Exercise logging failed.', true);
  }
}

async function deleteExercise(idx) {
  try {
    const res = await fetch('/api/delete_exercise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        date: AppState.diaryDate,
        index: idx
      })
    });
    const d = await res.json();
    if (d.success) {
      showToast('Exercise removed.');
      loadProgressExercise();
      loadDashboard();
    }
  } catch (e) {}
}

function selectPeriod(days, el) {
  document.querySelectorAll('.pill[id^="period-"]').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  loadAnalytics(days);
}

let _calChartInstance = null;
async function loadAnalytics(days = 7) {
  try {
    const res = await fetch(`/api/get_analytics/${AppState.userId}?days=${days}`);
    const data = await res.json();

    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.textContent = v;
    };
    setVal('p-streak', data.streak_days || 0);
    setVal('p-avg-cal', (data.averages && data.averages.calories) || 0);
    setVal('p-avg-pro', ((data.averages && data.averages.protein) || 0) + 'g');

    if (typeof Chart !== 'undefined') {
      const labels = (data.days || []).map(d => {
        const dt = new Date(d.date);
        return dt.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      });

      const chartOpts = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      };

      // ── Calories bar chart ──
      const calCtx = document.getElementById('chart-calories');
      if (calCtx) {
        const calData = (data.days || []).map(d => d.calories || 0);
        if (_calChartInstance) _calChartInstance.destroy();
        _calChartInstance = new Chart(calCtx, {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Calories', data: calData, backgroundColor: 'rgba(249,115,22,0.7)', borderRadius: 6 }] },
          options: chartOpts
        });
      }

      // ── Protein line chart ──
      const proCtx = document.getElementById('chart-protein');
      if (proCtx) {
        const proData = (data.days || []).map(d => Math.round(d.protein || 0));
        if (proCtx._ci) proCtx._ci.destroy();
        proCtx._ci = new Chart(proCtx, {
          type: 'line',
          data: { labels, datasets: [{ label: 'Protein (g)', data: proData, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', borderWidth: 2, pointRadius: 3, tension: 0.35, fill: true }] },
          options: chartOpts
        });
      }

      // ── Body Weight chart ──
      const wtCtx = document.getElementById('chart-weight');
      if (wtCtx) {
        try {
          const wtRes = await fetch(`/api/get_weight/${AppState.userId}?days=${days}`);
          const wtJson = await wtRes.json();
          const wte = wtJson.entries || [];
          if (wte.length) {
            const wtLabels = wte.map(e => { const dt = new Date(e.date); return dt.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }); });
            const wtVals = wte.map(e => e.weight_kg);
            if (wtCtx._ci) wtCtx._ci.destroy();
            wtCtx._ci = new Chart(wtCtx, {
              type: 'line',
              data: { labels: wtLabels, datasets: [{ label: 'Weight (kg)', data: wtVals, borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,0.1)', borderWidth: 2, pointRadius: 4, tension: 0.3, fill: true }] },
              options: chartOpts
            });
          }
        } catch (e) { /* no weight data */ }
      }
    }
  } catch (err) {
    console.error('loadAnalytics error:', err);
  }
}


async function logWeightToday() {
  const inp = document.getElementById('weight-input');
  const wt = parseFloat(inp ? inp.value : 0);
  if (!wt || wt <= 20 || wt > 300) {
    showToast('Please enter a valid weight in kg.', true);
    return;
  }
  try {
    const res = await fetch('/api/log_weight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        date: AppState.diaryDate,
        weight_kg: wt
      })
    });
    const d = await res.json();
    if (d.success) {
      showToast(`Weight recorded: ${wt} kg ✅`);
      if (AppState.profile) AppState.profile.weight = wt;
      loadAnalytics(7);
    }
  } catch (e) {
    showToast('Failed to record weight.', true);
  }
}

async function loadMicronutrients() {
  const container = document.getElementById('p-micronutrients');
  if (!container) return;

  try {
    const res = await fetch(`/api/get_micronutrients/${AppState.userId}?date=${AppState.diaryDate}`);
    const data = await res.json();
    const list = data.micronutrients || [];

    if (!list.length) {
      container.innerHTML = '<div style="font-size:.8rem;color:#64748b;">No micronutrient data for today yet.</div>';
      return;
    }

    container.innerHTML = list.map(m => `
      <div class="micro-item">
        <div class="micro-hdr">
          <span class="micro-name">${escapeHtml(m.label)}</span>
          <span class="micro-val" style="color:${m.percent >= 70 ? '#10b981' : m.percent >= 40 ? '#f59e0b' : '#ef4444'}">${m.consumed} / ${m.target} ${m.unit}</span>
        </div>
        <div class="micro-track">
          <div class="micro-fill" style="width:${Math.min(100, m.percent)}%;background:${m.percent >= 70 ? '#10b981' : m.percent >= 40 ? '#f59e0b' : '#ef4444'};"></div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('loadMicronutrients error:', err);
  }
}

async function loadGlycemicInfo() {
  const container = document.getElementById('p-gi-result');
  if (!container) return;

  try {
    const res = await fetch('/api/get_glycemic_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: AppState.userId, date: AppState.diaryDate })
    });
    const data = await res.json();
    const foods = data.foods || [];

    if (!foods.length) {
      container.innerHTML = '<div style="font-size:.8rem;color:#64748b;padding:6px 0;">Log meals to see blood sugar & GI impact.</div>';
      return;
    }

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:.85rem;">
        <span style="font-weight:700;">Total Glycemic Load</span>
        <span style="font-weight:800;color:${data.daily_gl_status === 'Low' ? '#10b981' : data.daily_gl_status === 'Moderate' ? '#f59e0b' : '#ef4444'};">${data.total_glycemic_load} (${data.daily_gl_status})</span>
      </div>
      <div style="font-size:.78rem;color:#94a3b8;margin-bottom:10px;">${escapeHtml(data.recommendation || '')}</div>
      ${foods.map(f => `
        <div class="gi-row">
          <span>${escapeHtml(f.food || '')}</span>
          <span style="font-weight:700;color:${f.diabetes_friendly ? '#10b981' : '#f59e0b'};">${f.gi_category || 'GI'}</span>
        </div>
      `).join('')}
    `;
  } catch (e) {
    console.error('loadGlycemicInfo error:', e);
  }
}

// ── TOOLS TAB (FAVOURITES, RECIPES, MEAL PLAN) ────────────────────
async function loadFavourites() {
  const container = document.getElementById('t-favourites-list');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`/api/get_favourites/${AppState.userId}`);
    const data = await res.json();
    const list = data.favourites || [];

    if (!list.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">⭐</div><div class="empty-text">No favourites saved yet.<br>Save any scanned or searched food as a favourite for 1-tap logging!</div></div>';
      return;
    }

    container.innerHTML = list.map(f => `
      <div class="fav-item">
        <div>
          <div class="fav-name">${escapeHtml(f.name || f.display_name || f.food || '')}</div>
          <div class="fav-meta">${f.calories} kcal · ${f.portion || 100}g · ${f.meal_type || 'meal'}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-primary" style="padding:6px 12px;font-size:.78rem;" onclick="quickLogFavourite('${escapeHtml(f.name || '').replace(/'/g, "\\'")}')">⚡ Log</button>
          <button style="background:none;border:none;color:#64748b;cursor:pointer;padding:4px;" onclick="deleteFavourite('${escapeHtml(f.name || '').replace(/'/g, "\\'")}')">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div class="empty"><div class="empty-text">Error loading favourites.</div></div>';
  }
}

async function quickLogFavourite(name) {
  try {
    const res = await fetch('/api/quicklog_favourite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        name: name,          // backend expects 'name', not 'meal_name'
        date: AppState.diaryDate
      })
    });
    const d = await res.json();
    if (d.success) {
      showToast(`Logged "${name}"! ✅`);
      loadDashboard();
    } else {
      showToast(d.error || 'Could not log favourite.', true);
    }
  } catch (e) {
    showToast('Quick log failed.', true);
  }
}

async function deleteFavourite(name) {
  try {
    await fetch('/api/delete_favourite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: AppState.userId, name: name })
    });
    showToast('Favourite removed.');
    loadFavourites();
  } catch (e) {}
}

function saveSearchAsFavourite() {
  if (!_modalFoodItem) return;
  const name = prompt('Name for this favourite:', _modalFoodItem.display_name || _modalFoodItem.name);
  if (!name) return;

  const portion = parseInt(document.getElementById('fm-portion-slider')?.value || '100', 10);
  const factor = portion / 100;

  fetch('/api/save_favourite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: AppState.userId,
      name: name,
      food: _modalFoodItem.name,
      display_name: name,
      portion: portion,
      calories: Math.round((_modalFoodItem.calories_per_100g || 0) * factor),
      protein: Math.round((_modalFoodItem.protein || 0) * factor * 10) / 10,
      carbs: Math.round((_modalFoodItem.carbs || 0) * factor * 10) / 10,
      fat: Math.round((_modalFoodItem.fat || 0) * factor * 10) / 10,
      meal_type: _modalFoodMeal
    })
  }).then(() => showToast(`⭐ Saved "${name}"!`)).catch(() => showToast('Save failed.', true));
}

// Recipes
let _recipeIngredients = [];
function addRecipeIngredient() {
  const name = prompt('Ingredient name (e.g. Paneer, Rice, Moong Dal):');
  if (!name) return;
  const grams = parseFloat(prompt('Quantity in grams:', '100')) || 100;
  const cals = parseFloat(prompt('Calories per 100g (optional, 0 for estimate):', '150')) || 150;

  _recipeIngredients.push({ name, grams, calories_per_100g: cals, protein: 5, carbs: 20, fat: 5 });
  renderRecipeIngredients();
}

function removeIngredient(idx) {
  _recipeIngredients.splice(idx, 1);
  renderRecipeIngredients();
}

function renderRecipeIngredients() {
  const container = document.getElementById('recipe-ingredients-list');
  if (!container) return;
  if (!_recipeIngredients.length) {
    container.innerHTML = '<div style="font-size:.8rem;color:#64748b;">No ingredients added yet.</div>';
    return;
  }
  container.innerHTML = _recipeIngredients.map((item, i) => `
    <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:.84rem;">
      <span>${escapeHtml(item.name)} (${item.grams}g)</span>
      <button onclick="removeIngredient(${i})" style="background:none;border:none;color:#ef4444;cursor:pointer;">✕</button>
    </div>
  `).join('');
}

async function saveRecipe() {
  const name = (document.getElementById('recipe-name')?.value || '').trim();
  const servings = parseInt(document.getElementById('recipe-servings')?.value || '1', 10);
  if (!name || !_recipeIngredients.length) {
    showToast('Enter recipe name and at least 1 ingredient.', true);
    return;
  }

  try {
    const res = await fetch('/api/save_recipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        name: name,
        ingredients: _recipeIngredients,
        servings: servings
      })
    });
    const d = await res.json();
    if (d.success) {
      showToast(`Recipe "${name}" saved! ✅`);
      _recipeIngredients = [];
      renderRecipeIngredients();
      loadSavedRecipes();
    }
  } catch (e) {
    showToast('Failed to save recipe.', true);
  }
}

async function loadSavedRecipes() {
  const container = document.getElementById('t-recipes-list');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`/api/get_recipes/${AppState.userId}`);
    const data = await res.json();
    const list = data.recipes || [];

    if (!list.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">📖</div><div class="empty-text">No custom recipes saved yet.</div></div>';
      return;
    }

    container.innerHTML = list.map(r => `
      <div class="recipe-item">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div class="recipe-name">${escapeHtml(r.name)}</div>
            <div class="recipe-meta">${r.servings} serving(s) · ${r.total_calories} total kcal</div>
          </div>
          <button onclick="deleteRecipe('${escapeHtml(r.name).replace(/'/g, "\\'")}')" style="background:none;border:none;color:#64748b;cursor:pointer;">🗑️</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div class="empty"><div class="empty-text">Error loading recipes.</div></div>';
  }
}

async function deleteRecipe(name) {
  try {
    await fetch('/api/delete_recipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: AppState.userId, name: name })
    });
    showToast('Recipe deleted.');
    loadSavedRecipes();
  } catch (e) {}
}

// AI Meal Plan
async function generateMealPlan() {
  const days = parseInt(document.getElementById('plan-days')?.value || '3', 10);
  const diet = document.getElementById('plan-diet')?.value || 'vegetarian';
  const region = document.getElementById('plan-region')?.value || 'North Indian';

  const loading = document.getElementById('meal-plan-loading');
  const btn = document.getElementById('btn-generate-plan');
  const out = document.getElementById('meal-plan-output');

  if (loading) loading.style.display = 'block';
  if (btn) btn.disabled = true;
  if (out) out.style.display = 'none';

  try {
    const res = await fetch('/api/generate_meal_plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        api_key: AppState.geminiKey,
        days: days,
        preferences: { diet, region }
      })
    });
    const data = await res.json();
    if (loading) loading.style.display = 'none';
    if (btn) btn.disabled = false;

    if (!data.success || !data.meal_plan) {
      showToast(data.error || 'Failed to generate plan.', true);
      return;
    }

    const plan = data.meal_plan;
    if (out) out.style.display = 'block';

    const shopEl = document.getElementById('plan-shopping-list');
    if (shopEl && plan.shopping_list) {
      shopEl.innerHTML = plan.shopping_list.map(item => `
        <span style="background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.25);padding:4px 10px;border-radius:99px;font-size:.76rem;">${escapeHtml(item)}</span>
      `).join('');
    }

    const daysEl = document.getElementById('plan-days-container');
    if (daysEl && plan.plan) {
      daysEl.innerHTML = plan.plan.map(d => `
        <div class="plan-day">
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
            <span style="font-weight:800;font-size:.95rem;">Day ${d.day}</span>
            <span style="font-size:.78rem;color:#64748b;">${d.total_calories || ''} kcal · ${d.total_protein || ''}g P</span>
          </div>
          ${Object.entries(d.meals || {}).map(([mName, mVal]) => `
            <div class="plan-meal">
              <div class="plan-meal-name">${mName.toUpperCase()} · ${mVal.time || ''}</div>
              <div class="plan-meal-items">${(mVal.items || []).join(' · ')}</div>
            </div>
          `).join('')}
        </div>
      `).join('');
    }
    showToast('Meal plan ready! 🥗');
  } catch (err) {
    if (loading) loading.style.display = 'none';
    if (btn) btn.disabled = false;
    showToast('Plan generation failed.', true);
  }
}

// ── PROFILE & ME TAB ──────────────────────────────────────────────
function updateMeTab() {
  const p = AppState.profile;
  const card = document.getElementById('profile-summary-card');
  const editCard = document.getElementById('profile-edit-card');

  if (!p) {
    if (card) card.style.display = 'none';
    if (editCard) editCard.style.display = 'block';
    return;
  }

  if (card) card.style.display = 'block';
  if (editCard) editCard.style.display = 'none';

  const goalMap = {
    lose_weight: 'Lose Weight 🔥',
    maintain: 'Maintain Weight ⚖️',
    build_muscle: 'Build Muscle 💪'
  };

  const setVal = (id, v, clr) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = v;
      if (clr) el.style.color = clr;
    }
  };
  setVal('me-name', p.name || 'User');
  setVal('me-goal-label', goalMap[p.goal] || p.goal || 'Healthy Diet');
  setVal('me-calories', p.target_calories || (p.targets && p.targets.calories) || '—');
  setVal('me-protein', (p.target_protein || (p.targets && p.targets.protein_g) || '—') + 'g');

  if (p.height && p.weight) {
    const bmi = (p.weight / Math.pow(p.height / 100, 2)).toFixed(1);
    const clr = bmi < 18.5 ? '#38bdf8' : bmi < 25 ? '#10b981' : bmi < 30 ? '#f59e0b' : '#ef4444';
    setVal('me-bmi', bmi, clr);
  }
}

function toggleProfileEdit() {
  const editCard = document.getElementById('profile-edit-card');
  const sumCard = document.getElementById('profile-summary-card');
  if (!editCard) return;
  const hidden = editCard.style.display === 'none';
  editCard.style.display = hidden ? 'block' : 'none';
  if (sumCard && !hidden) sumCard.style.display = 'block';
}

function refreshMeTab() {
  const p = AppState.profile;
  if (p) {
    updateMeTab();
    ['name', 'age', 'height', 'weight'].forEach(k => {
      const el = document.getElementById('pro-' + k);
      if (el && p[k] !== undefined) el.value = p[k];
    });
    const gEl = document.getElementById('pro-gender');
    if (gEl && p.gender) gEl.value = p.gender;
    const aEl = document.getElementById('pro-activity');
    if (aEl && p.activity) aEl.value = p.activity;
    const goEl = document.getElementById('pro-goal');
    if (goEl && p.goal) goEl.value = p.goal;
  }
  checkGeminiKeyStatus();
}

async function saveProfile() {
  const name = document.getElementById('pro-name')?.value.trim() || 'User';
  const age = parseInt(document.getElementById('pro-age')?.value || '25', 10);
  const gender = document.getElementById('pro-gender')?.value || 'male';
  const height = parseFloat(document.getElementById('pro-height')?.value || '170');
  const weight = parseFloat(document.getElementById('pro-weight')?.value || '65');
  const activity = document.getElementById('pro-activity')?.value || 'moderate';
  const goal = document.getElementById('pro-goal')?.value || 'maintain';

  try {
    const res = await fetch('/api/save_profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        name, age, gender, height, weight, activity, goal
      })
    });
    const data = await res.json();
    if (data.success) {
      const targets = data.targets || {};
      AppState.profile = {
        name, age, gender, height, weight, activity, goal,
        target_calories: targets.calories || 2000,
        target_protein: targets.protein_g || 120,
        target_carbs: targets.carbs_g || 250,
        target_fat: targets.fat_g || 65,
        tdee: data.tdee
      };
      localStorage.setItem('nv_profile', JSON.stringify(AppState.profile));
      showToast('Profile saved! Targets calculated ✅');
      updateMeTab();
      loadDashboard();
    }
  } catch (err) {
    showToast('Failed to save profile.', true);
  }
}

// Gemini API Key
function saveGeminiAPIKey() {
  const key = (document.getElementById('gemini-key-input')?.value || '').trim();
  if (key) {
    localStorage.setItem('nv_gemini_key', key);
    AppState.geminiKey = key;
    showToast('API Key saved! ✅');
  } else {
    localStorage.removeItem('nv_gemini_key');
    AppState.geminiKey = '';
    showToast('API Key removed.');
  }
  checkGeminiKeyStatus();
}

function saveGeminiAPIKeyFromModal() {
  const key = (document.getElementById('gemini-key-modal-input')?.value || '').trim();
  if (key) {
    localStorage.setItem('nv_gemini_key', key);
    AppState.geminiKey = key;
    showToast('API Key saved! ✅');
    closeModal('gemini-key-modal');
  }
  checkGeminiKeyStatus();
}

function checkGeminiKeyStatus() {
  const badge = document.getElementById('gemini-key-status');
  fetch('/api/coach/status')
    .then(r => r.json())
    .then(d => {
      const active = d.has_server_key || Boolean(AppState.geminiKey);
      if (badge) badge.style.display = active ? 'inline-block' : 'none';
    })
    .catch(() => {
      if (badge) badge.style.display = AppState.geminiKey ? 'inline-block' : 'none';
    });
}

// ── NUTRICOACH CHAT ───────────────────────────────────────────────
async function sendCoachChat() {
  const input = document.getElementById('coach-query-input');
  const query = (input?.value || '').trim();
  if (!query || AppState.isCoachReplying) return;

  input.value = '';
  AppState.isCoachReplying = true;

  const messagesEl = document.getElementById('coach-messages');
  if (messagesEl) {
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.textContent = query;
    messagesEl.appendChild(userBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  try {
    const res = await fetch('/api/coach/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        message: query,
        api_key: AppState.geminiKey
      })
    });
    const data = await res.json();
    const reply = data.reply || data.message || 'Sorry, could not answer right now.';

    if (messagesEl) {
      const botBubble = document.createElement('div');
      botBubble.className = 'chat-bubble bot';
      botBubble.innerHTML = reply.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
      messagesEl.appendChild(botBubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } catch (err) {
    if (messagesEl) {
      const errBubble = document.createElement('div');
      errBubble.className = 'chat-bubble bot';
      errBubble.textContent = 'Network error. Try again.';
      messagesEl.appendChild(errBubble);
    }
  }
  AppState.isCoachReplying = false;
}

function startCoachVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('Voice recognition not supported.', true);
    return;
  }
  const rec = new SR();
  rec.lang = 'en-IN';
  showToast('🎤 Listening to your question...');
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    const inp = document.getElementById('coach-query-input');
    if (inp) inp.value = t;
    sendCoachChat();
  };
  rec.start();
}

async function openCoachQuickTip() {
  openModal('coach-tip-modal');
  const content = document.getElementById('coach-tip-content');
  if (content) content.innerHTML = '<div class="spinner"></div>';

  try {
    const res = await fetch('/api/coach/quick_insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: AppState.userId, api_key: AppState.geminiKey })
    });
    const d = await res.json();
    if (content) {
      content.innerHTML = `<div style="font-size:.9rem;line-height:1.6;color:#e2e8f0;padding:8px 0;">${escapeHtml(d.insight || 'Keep your protein high and stay hydrated today!')}</div>`;
    }
  } catch (e) {
    if (content) content.innerHTML = '<div style="font-size:.85rem;color:#94a3b8;">Stay consistent with your hydration and daily calorie goals!</div>';
  }
}

// ── UTILS ─────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setupDropzone() {
  const zone = document.getElementById('scan-zone');
  if (!zone) return;
  ['dragenter', 'dragover'].forEach(eName => {
    zone.addEventListener(eName, (e) => {
      e.preventDefault();
      zone.style.borderColor = '#f97316';
    });
  });
  ['dragleave', 'drop'].forEach(eName => {
    zone.addEventListener(eName, (e) => {
      e.preventDefault();
      zone.style.borderColor = 'rgba(249,115,22,.3)';
    });
  });
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) {
      handleScanFile({ files: [file] });
    }
  });
}

// ── INIT ON DOM LOAD ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  try {
    // 1. Load saved profile from localStorage
    const saved = localStorage.getItem('nv_profile');
    if (saved) {
      try { AppState.profile = JSON.parse(saved); } catch (e) { AppState.profile = null; }
    }

    // 2. Setup dropzone
    setupDropzone();

    // 3. Bind enter key on inputs
    const searchInp = document.getElementById('food-search-input');
    if (searchInp) {
      searchInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performFoodSearch(searchInp.value.trim(), AppState.searchCategory || 'all');
      });
    }

    const coachInp = document.getElementById('coach-query-input');
    if (coachInp) {
      coachInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendCoachChat();
      });
    }

    // 4. Update Header, Dashboard, and Water
    updateGreeting();
    loadWaterData();
    loadDashboard();
    checkGeminiKeyStatus();
  } catch (err) {
    console.error('Initialization error:', err);
  }
});
