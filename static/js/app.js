/**
 * NutriVision India — Application JavaScript Engine
 * Architecture: Clean, Modular, Functional, Robust
 */

// ==========================================
// 1. STATE & INITIALIZATION
// ==========================================
const AppState = {
  userId: 'nv_user',
  profile: null,
  diaryDate: new Date().toISOString().split('T')[0],
  diaryTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterML: 0,
  waterTargetML: 3000,
  
  // Scanner State
  currentFile: null,
  currentFoodName: '',
  currentNutrition: {},
  currentMealType: 'breakfast',
  
  // Profile Form State
  selectedGoal: 'fat_loss',
  selectedActivity: 'moderate',
  
  // Barcode & OCR State
  barcodeNutrition: {},
  barcodeRunning: false,
  barcodeStream: null,
  barcodeVideoTrack: null,
  isTorchOn: false,
  barcodeAnimFrame: null,
  
  // Live Camera State
  liveCameraStream: null,
  liveFacingMode: 'environment',
  
  // Search State
  searchCategory: 'all',
  searchTimer: null,
  
  // Coach State
  geminiKey: localStorage.getItem('nv_gemini_key') || '',
  coachHistory: [],
  isCoachReplying: false
};

// Initialize Native Barcode Detector if supported
let nativeBarcodeDetector = null;
if ('BarcodeDetector' in window) {
  try {
    nativeBarcodeDetector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']
    });
  } catch (e) {
    nativeBarcodeDetector = null;
  }
}

// Window Load Handler
window.addEventListener('DOMContentLoaded', () => {
  initProfile();
  initDateHeaders();
  loadDashboard();
  loadWaterData();
  checkGeminiKeyStatus();
  setupDropzone();
});

// ==========================================
// 2. NAVIGATION MANAGEMENT
// ==========================================
function showScreen(screenName) {
  // Update Screens
  document.querySelectorAll('.screen-view').forEach(s => s.classList.remove('active'));
  const targetScreen = document.getElementById('screen-' + screenName);
  if (targetScreen) targetScreen.classList.add('active');

  // Update Desktop Navigation
  document.querySelectorAll('.nav-link-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === screenName);
  });

  // Update Mobile Navigation
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.screen === screenName);
  });

  // Screen specific data refresh
  if (screenName === 'home') loadDashboard();
  if (screenName === 'history') loadHistoryTimeline();
  if (screenName === 'coach') loadCoachScreen();
  if (screenName === 'nutrition') {
    AppState.searchCategory = 'all';
    performFoodSearch('', 'all');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function initDateHeaders() {
  const now = new Date();
  const options = { weekday: 'long', day: 'numeric', month: 'short' };
  const dateStr = now.toLocaleDateString('en-IN', options);
  
  const dashDate = document.getElementById('dash-date-display');
  if (dashDate) dashDate.textContent = dateStr;

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = AppState.profile ? `, ${AppState.profile.name}` : '';
  const greetEl = document.getElementById('dash-greeting-text');
  if (greetEl) greetEl.textContent = `${greeting}${name}`;

  updateHistoryDateHeader();
}

// ==========================================
// 3. PROFILE & METABOLISM MANAGEMENT
// ==========================================
function initProfile() {
  const saved = localStorage.getItem('nv_profile');
  if (saved) {
    try {
      AppState.profile = JSON.parse(saved);
      renderProfileState(true);
    } catch (e) {
      AppState.profile = null;
      renderProfileState(false);
    }
  } else {
    renderProfileState(false);
  }
}

function renderProfileState(hasProfile) {
  const emptyBanner = document.getElementById('hero-profile-cta');
  const dashStats = document.getElementById('dash-active-summary');
  
  if (hasProfile && AppState.profile) {
    if (emptyBanner) emptyBanner.style.display = 'none';
    if (dashStats) dashStats.style.display = 'block';

    const goalMap = { fat_loss: 'Fat Loss 🔥', maintain: 'Maintenance ⚖️', muscle_gain: 'Muscle Gain 💪' };
    const goalTag = document.getElementById('dash-plan-badge');
    if (goalTag) goalTag.textContent = goalMap[AppState.profile.goal] || 'Custom Plan';

    // Populate profile form values
    const pName = document.getElementById('p-name');
    if (pName) pName.value = AppState.profile.name || '';
    const pAge = document.getElementById('p-age');
    if (pAge) pAge.value = AppState.profile.age || '';
    const pWeight = document.getElementById('p-weight');
    if (pWeight) pWeight.value = AppState.profile.weight || '';
    const pHeight = document.getElementById('p-height');
    if (pHeight) pHeight.value = AppState.profile.height || '';
    const pGender = document.getElementById('p-gender');
    if (pGender) pGender.value = AppState.profile.gender || 'male';

    selectGoal(AppState.profile.goal || 'fat_loss');
    selectActivity(AppState.profile.activity || 'moderate');
    renderTargetsOutput(AppState.profile.targets, AppState.profile.tdee);
  } else {
    if (emptyBanner) emptyBanner.style.display = 'block';
    if (dashStats) dashStats.style.display = 'none';
  }
}

function selectGoal(goal) {
  AppState.selectedGoal = goal;
  document.querySelectorAll('.goal-option-card').forEach(card => {
    card.classList.toggle('active', card.dataset.goal === goal);
  });
}

function selectActivity(act) {
  AppState.selectedActivity = act;
  document.querySelectorAll('.activity-option-card').forEach(card => {
    card.classList.toggle('active', card.dataset.activity === act);
  });
}

function calculateTDEE(weightKg, heightCm, age, gender, activity) {
  // Mifflin-St Jeor / Harris-Benedict BMR Formula
  const bmr = gender === 'male'
    ? (10 * weightKg) + (6.25 * heightCm) - (5 * age) + 5
    : (10 * weightKg) + (6.25 * heightCm) - (5 * age) - 161;
  const multipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
  return Math.round(bmr * (multipliers[activity] || 1.55));
}

function calculateTargets(tdee, goal, weightKg) {
  let calories = tdee;
  let proteinPerKg = 1.8;
  
  if (goal === 'fat_loss') {
    calories = tdee - 500;
    proteinPerKg = 2.2;
  } else if (goal === 'muscle_gain') {
    calories = tdee + 300;
    proteinPerKg = 2.0;
  }

  const proteinG = Math.round(proteinPerKg * weightKg);
  const fatG = Math.round((calories * 0.25) / 9);
  const carbsG = Math.max(0, Math.round((calories - (proteinG * 4) - (fatG * 9)) / 4));

  return {
    calories: Math.round(calories),
    protein_g: proteinG,
    fat_g: fatG,
    carbs_g: carbsG
  };
}

async function saveProfile() {
  const name = (document.getElementById('p-name').value || '').trim();
  const age = parseInt(document.getElementById('p-age').value);
  const weight = parseFloat(document.getElementById('p-weight').value);
  const height = parseFloat(document.getElementById('p-height').value);
  const gender = document.getElementById('p-gender').value;

  if (!name || isNaN(age) || isNaN(weight) || isNaN(height)) {
    showToast('Please enter all personal metrics.', true);
    return;
  }

  const tdee = calculateTDEE(weight, height, age, gender, AppState.selectedActivity);
  const targets = calculateTargets(tdee, AppState.selectedGoal, weight);

  AppState.profile = {
    name,
    age,
    weight,
    height,
    gender,
    goal: AppState.selectedGoal,
    activity: AppState.selectedActivity,
    tdee,
    targets
  };

  localStorage.setItem('nv_profile', JSON.stringify(AppState.profile));

  // Sync with backend API
  try {
    await fetch('/api/save_profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: AppState.userId,
        name,
        age,
        weight,
        height,
        gender,
        goal: AppState.selectedGoal,
        activity: AppState.selectedActivity
      })
    });
  } catch (e) {}

  renderTargetsOutput(targets, tdee);
  renderProfileState(true);
  initDateHeaders();
  loadDashboard();
  showToast('Profile & daily targets saved! 🎯');
}

function renderTargetsOutput(targets, tdee) {
  const targetCard = document.getElementById('profile-targets-card');
  if (!targetCard) return;

  document.getElementById('out-cal-target').textContent = targets.calories;
  document.getElementById('out-pro-target').textContent = targets.protein_g + 'g';
  document.getElementById('out-car-target').textContent = targets.carbs_g + 'g';
  document.getElementById('out-fat-target').textContent = targets.fat_g + 'g';

  const w = AppState.profile ? AppState.profile.weight : 70;
  const h = AppState.profile ? AppState.profile.height : 175;
  const bmi = (w / ((h / 100) * (h / 100))).toFixed(1);
  const bmiCategory = bmi < 18.5 ? 'Underweight' : bmi < 23.0 ? 'Normal (Asian Indian)' : bmi < 25.0 ? 'Overweight' : 'Obese';

  document.getElementById('out-bmi-val').textContent = `${bmi} (${bmiCategory})`;
  document.getElementById('out-tdee-val').textContent = `${tdee} kcal/day`;

  targetCard.style.display = 'block';
}

function resetProfile() {
  if (confirm('Reset your profile and nutrition goals?')) {
    localStorage.removeItem('nv_profile');
    AppState.profile = null;
    renderProfileState(false);
    document.getElementById('profile-targets-card').style.display = 'none';
    showToast('Profile data cleared.');
  }
}

// ==========================================
// 4. DASHBOARD & NUTRITION TRACKING
// ==========================================
async function loadDashboard() {
  if (!AppState.profile) return;
  try {
    const res = await fetch(`/api/get_diary/${AppState.userId}?date=${AppState.diaryDate}`);
    const data = await res.json();
    AppState.diaryTotals = data.totals || { calories: 0, protein: 0, carbs: 0, fat: 0 };
    renderDashboardStats(AppState.diaryTotals);
  } catch (e) {
    renderDashboardStats({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  }
}

function renderDashboardStats(totals) {
  if (!AppState.profile) return;
  const targets = AppState.profile.targets || { calories: 2000, protein_g: 120, carbs_g: 220, fat_g: 55 };
  
  const eatenCal = Math.round(totals.calories || 0);
  const targetCal = targets.calories;
  const remCal = Math.max(0, targetCal - eatenCal);

  document.getElementById('dash-cal-eaten').textContent = eatenCal;
  document.getElementById('dash-cal-target').textContent = targetCal;
  document.getElementById('dash-cal-remaining').textContent = remCal;

  // Render SVG Circular Gauge (Circumference ~414.7)
  const ringCircumference = 414.7;
  const pctCal = Math.min(1, eatenCal / targetCal);
  const strokeOffset = ringCircumference - (ringCircumference * pctCal);
  const gaugeFill = document.getElementById('dash-gauge-fill');
  if (gaugeFill) gaugeFill.style.strokeDashoffset = strokeOffset;

  // Render Macro Bars
  const pct = (val, max) => Math.min(100, Math.round((val / max) * 100));
  document.getElementById('dash-pro-fill').style.width = pct(totals.protein || 0, targets.protein_g) + '%';
  document.getElementById('dash-car-fill').style.width = pct(totals.carbs || 0, targets.carbs_g) + '%';
  document.getElementById('dash-fat-fill').style.width = pct(totals.fat || 0, targets.fat_g) + '%';

  document.getElementById('dash-pro-nums').textContent = `${Math.round(totals.protein || 0)} / ${targets.protein_g}g`;
  document.getElementById('dash-car-nums').textContent = `${Math.round(totals.carbs || 0)} / ${targets.carbs_g}g`;
  document.getElementById('dash-fat-nums').textContent = `${Math.round(totals.fat || 0)} / ${targets.fat_g}g`;

  // Status message
  const diff = eatenCal - targetCal;
  const statusBox = document.getElementById('dash-status-box');
  const statusTitle = document.getElementById('dash-status-title');
  const statusDesc = document.getElementById('dash-status-desc');

  if (eatenCal === 0) {
    if (statusTitle) statusTitle.textContent = 'Log your meals to start tracking today.';
    if (statusDesc) statusDesc.textContent = 'Your calorie and macro balance will update dynamically.';
  } else if (diff > 100) {
    if (statusTitle) statusTitle.textContent = `Caloric Surplus: +${diff} kcal`;
    if (statusDesc) statusDesc.textContent = AppState.profile.goal === 'muscle_gain' ? 'Optimal for muscle building.' : 'Consider lighter meals for the rest of today.';
  } else if (diff < -100) {
    if (statusTitle) statusTitle.textContent = `Caloric Deficit: ${Math.abs(diff)} kcal left`;
    if (statusDesc) statusDesc.textContent = AppState.profile.goal === 'fat_loss' ? 'On track for steady fat loss.' : 'Fuel up with protein or complex carbs to hit target.';
  } else {
    if (statusTitle) statusTitle.textContent = 'On Target: Balanced intake';
    if (statusDesc) statusDesc.textContent = 'You are hitting your daily nutritional budget perfectly.';
  }
}

// ==========================================
// 5. HYDRATION TRACKING
// ==========================================
async function loadWaterData() {
  try {
    const res = await fetch(`/api/get_water/${AppState.userId}?date=${AppState.diaryDate}`);
    const data = await res.json();
    AppState.waterML = data.water_ml || 0;
    renderWaterUI(AppState.waterML);
  } catch (e) {
    renderWaterUI(0);
  }
}

function renderWaterUI(ml) {
  AppState.waterML = ml;
  const target = AppState.waterTargetML;
  const glasses = Math.round(ml / 250);
  const pct = Math.min(100, Math.round((ml / target) * 100));

  const countEl = document.getElementById('water-count-display');
  if (countEl) countEl.textContent = `${ml} / ${target} ml (${glasses} glasses)`;

  const fillEl = document.getElementById('water-gauge-fill');
  if (fillEl) fillEl.style.width = `${pct}%`;
}

async function addWater(amount) {
  try {
    const res = await fetch('/api/log_water', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: AppState.userId, date: AppState.diaryDate, amount_ml: amount, action: 'add' })
    });
    const data = await res.json();
    if (data.success) {
      renderWaterUI(data.water_ml);
      showToast(amount > 0 ? `Logged +${amount} ml water 💧` : `Updated: ${data.water_ml} ml`);
    }
  } catch (e) {}
}

async function resetWater() {
  try {
    const res = await fetch('/api/log_water', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: AppState.userId, date: AppState.diaryDate, action: 'reset' })
    });
    const data = await res.json();
    if (data.success) {
      renderWaterUI(0);
      showToast('Hydration counter reset.');
    }
  } catch (e) {}
}

// ==========================================
// 6. FOOD SCANNER (AI VISION & ENSEMBLE)
// ==========================================
function setupDropzone() {
  const dropzone = document.getElementById('scanner-dropzone');
  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      AppState.currentFile = files[0];
      analyzeUploadedFood();
    }
  });
}

function handleFileInput(e) {
  const file = e.target.files[0];
  if (file) {
    AppState.currentFile = file;
    analyzeUploadedFood();
  }
}

async function analyzeUploadedFood() {
  if (!AppState.currentFile) return;

  const dropzone = document.getElementById('scanner-dropzone');
  const loading = document.getElementById('scanner-analyzing-card');
  const result = document.getElementById('scanner-result-card');

  if (dropzone) dropzone.style.display = 'none';
  if (loading) loading.style.display = 'block';
  if (result) result.style.display = 'none';

  // Preview local image
  const reader = new FileReader();
  reader.onload = ev => {
    const imgEl = document.getElementById('result-image-element');
    if (imgEl) imgEl.src = ev.target.result;
  };
  reader.readAsDataURL(AppState.currentFile);

  const fd = new FormData();
  fd.append('file', AppState.currentFile);

  try {
    const res = await fetch('/analyze', { method: 'POST', body: fd });
    const data = await res.json();
    if (loading) loading.style.display = 'none';

    if (res.ok && data.predictions && data.predictions.length > 0) {
      renderScanPrediction(data);
    } else {
      showToast(data.error || 'Could not recognize meal. Try manual search.', true);
      resetScanner();
    }
  } catch (err) {
    if (loading) loading.style.display = 'none';
    showToast('Analysis error. Please check server connection.', true);
    resetScanner();
  }
}

function renderScanPrediction(data) {
  const resultCard = document.getElementById('scanner-result-card');
  if (!resultCard) return;
  resultCard.style.display = 'block';

  const top = data.predictions[0];
  AppState.currentFoodName = top.food;
  AppState.currentNutrition = data.nutrition || {};

  document.getElementById('result-dish-title').textContent = top.food.replace(/_/g, ' ');
  
  // Intelligent confidence label
  const confRaw = parseFloat(top.confidence) || 0;
  const confBadge = document.getElementById('result-confidence-badge');
  if (confBadge) {
    confBadge.textContent = confRaw >= 70 ? `High Confidence: ${top.confidence}` : `Likely Match: ${top.confidence}`;
  }

  // Render Alternative Predictions
  const altContainer = document.getElementById('alt-predictions-container');
  if (altContainer) {
    altContainer.innerHTML = data.predictions.map((p, i) => `
      <button type="button" class="alt-pred-chip ${i === 0 ? 'active' : ''}" onclick="switchActivePrediction('${p.food}', this)">
        <span>${p.food.replace(/_/g, ' ').toUpperCase()}</span>
        <span style="opacity:0.75;">(${p.confidence})</span>
      </button>
    `).join('');
  }

  // Set default 100g portion
  document.getElementById('portion-slider-input').value = 100;
  updatePortionMetrics(100);

  // Nutrition Guidance
  const n = data.nutrition || {};
  const notesContainer = document.getElementById('result-diet-notes');
  if (notesContainer) {
    const notes = [];
    if (n.protein >= 8) notes.push('💪 Excellent Protein Source');
    if ((n.calories_per_100g || 0) < 150) notes.push('🥗 Low Calorie Density');
    if ((n.calories_per_100g || 0) > 280) notes.push('⚠️ Calorie Dense Dish');
    if (n.notes) notes.push(`📋 ${n.notes}`);

    notesContainer.innerHTML = notes.map(note => `
      <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:4px;">${note}</div>
    `).join('');
  }

  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function switchActivePrediction(foodKey, btnEl) {
  document.querySelectorAll('.alt-pred-chip').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  AppState.currentFoodName = foodKey;
  document.getElementById('result-dish-title').textContent = foodKey.replace(/_/g, ' ');

  try {
    const res = await fetch(`/api/search_food?q=${encodeURIComponent(foodKey)}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      AppState.currentNutrition = data.results[0];
      updatePortionMetrics(document.getElementById('portion-slider-input').value);
    }
  } catch (e) {}
}

function setPortionPreset(grams, btnEl) {
  document.querySelectorAll('.preset-chip-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  const slider = document.getElementById('portion-slider-input');
  if (slider) slider.value = grams;
  updatePortionMetrics(grams);
}

function updatePortionMetrics(grams) {
  const g = parseInt(grams) || 100;
  const label = document.getElementById('portion-display-label');
  if (label) label.textContent = `${g}g`;

  const factor = g / 100;
  const n = AppState.currentNutrition || {};

  document.getElementById('metric-val-cal').textContent = Math.round((n.calories_per_100g || 0) * factor);
  document.getElementById('metric-val-pro').textContent = Math.round((n.protein || 0) * factor * 10) / 10 + 'g';
  document.getElementById('metric-val-car').textContent = Math.round((n.carbs || 0) * factor * 10) / 10 + 'g';
  document.getElementById('metric-val-fat').textContent = Math.round((n.fat || 0) * factor * 10) / 10 + 'g';
}

function setMealType(meal, btnEl) {
  AppState.currentMealType = meal;
  document.querySelectorAll('.meal-type-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.meal === meal);
  });
}

async function logScannedMealToDiary() {
  const portion = parseInt(document.getElementById('portion-slider-input').value) || 100;
  const factor = portion / 100;
  const n = AppState.currentNutrition || {};

  const payload = {
    user_id: AppState.userId,
    food: AppState.currentFoodName,
    portion: portion,
    calories: Math.round((n.calories_per_100g || 0) * factor),
    protein: Math.round((n.protein || 0) * factor * 10) / 10,
    carbs: Math.round((n.carbs || 0) * factor * 10) / 10,
    fat: Math.round((n.fat || 0) * factor * 10) / 10,
    meal_type: AppState.currentMealType,
    date: AppState.diaryDate
  };

  try {
    const res = await fetch('/api/log_meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Meal added to daily history! ✅');
      resetScanner();
      setTimeout(() => showScreen('history'), 500);
    }
  } catch (e) {
    showToast('Failed to log meal. Check connection.', true);
  }
}

function resetScanner() {
  const fileInput = document.getElementById('food-file-input');
  if (fileInput) fileInput.value = '';
  document.getElementById('scanner-dropzone').style.display = 'block';
  document.getElementById('scanner-analyzing-card').style.display = 'none';
  document.getElementById('scanner-result-card').style.display = 'none';
  stopLiveCamera();
  AppState.currentFile = null;
}

/* LIVE CAMERA ENGINE */
async function startLiveCamera() {
  const wrapper = document.getElementById('live-camera-wrapper');
  const dropzone = document.getElementById('scanner-dropzone');
  const video = document.getElementById('live-camera-video');

  try {
    if (AppState.liveCameraStream) {
      AppState.liveCameraStream.getTracks().forEach(t => t.stop());
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: AppState.liveFacingMode } },
      audio: false
    });
    AppState.liveCameraStream = stream;
    video.srcObject = stream;
    wrapper.style.display = 'block';
    dropzone.style.display = 'none';
  } catch (e) {
    showToast('Camera stream unavailable. Upload a photo instead.', true);
  }
}

function stopLiveCamera() {
  const wrapper = document.getElementById('live-camera-wrapper');
  const dropzone = document.getElementById('scanner-dropzone');
  if (AppState.liveCameraStream) {
    AppState.liveCameraStream.getTracks().forEach(t => t.stop());
    AppState.liveCameraStream = null;
  }
  if (wrapper) wrapper.style.display = 'none';
  if (dropzone) dropzone.style.display = 'block';
}

function switchCameraFacing() {
  AppState.liveFacingMode = AppState.liveFacingMode === 'environment' ? 'user' : 'environment';
  startLiveCamera();
}

function captureCameraSnapshot() {
  const video = document.getElementById('live-camera-video');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(blob => {
    AppState.currentFile = new File([blob], 'snapshot.jpg', { type: 'image/jpeg' });
    stopLiveCamera();
    analyzeUploadedFood();
  }, 'image/jpeg', 0.9);
}

// ==========================================
// 7. FOOD SEARCH & NUTRITION DATABASE
// ==========================================
function onSearchInputChange(val) {
  clearTimeout(AppState.searchTimer);
  AppState.searchTimer = setTimeout(() => {
    performFoodSearch(val, AppState.searchCategory);
  }, 350);
}

function filterSearchCategory(category, btnEl) {
  AppState.searchCategory = category;
  document.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  const query = document.getElementById('search-text-input').value;
  performFoodSearch(query, category);
}

function clearSearchField() {
  const input = document.getElementById('search-text-input');
  if (input) {
    input.value = '';
    performFoodSearch('', AppState.searchCategory);
  }
}

async function performFoodSearch(query, category) {
  const container = document.getElementById('search-results-list');
  if (!container) return;
  container.innerHTML = '<div style="padding:14px;color:var(--text-tertiary);font-size:0.85rem;">Searching database...</div>';

  try {
    const url = `/api/search_food?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category || 'all')}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      container.innerHTML = `
        <div style="padding:24px;text-align:center;color:var(--text-secondary);">
          <div style="font-size:1.8rem;margin-bottom:6px;">🔍</div>
          <div style="font-weight:600;font-size:0.92rem;">No foods found</div>
          <div style="font-size:0.8rem;color:var(--text-tertiary);margin-top:2px;">Try searching generic names like "dal", "paneer", "rice", or "roti"</div>
        </div>
      `;
      return;
    }

    container.innerHTML = data.results.map(item => `
      <div class="search-row-card" onclick="selectSearchItem(${JSON.stringify(item).replace(/"/g, '&quot;')})">
        <div>
          <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary);">
            <span class="diet-dot ${item.is_veg ? 'veg' : 'non-veg'}"></span>
            <span>${item.display_name || item.name.replace(/_/g, ' ')}</span>
          </div>
          <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px;">
            ${item.calories_per_100g} kcal · P:${item.protein}g · C:${item.carbs}g · F:${item.fat}g (per 100g)
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-secondary">Select +</button>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div style="padding:14px;color:var(--text-tertiary);">Search service unavailable.</div>';
  }
}

function selectSearchItem(item) {
  AppState.currentFoodName = item.name;
  AppState.currentNutrition = item;

  document.getElementById('manual-dish-name').textContent = item.display_name || item.name.replace(/_/g, ' ');
  document.getElementById('manual-grams-slider').value = 100;
  updateManualServing(100);

  const calcCard = document.getElementById('manual-portion-card');
  if (calcCard) {
    calcCard.style.display = 'block';
    calcCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updateManualServing(grams) {
  const g = parseInt(grams) || 100;
  const label = document.getElementById('manual-serving-label');
  if (label) label.textContent = `${g}g`;

  const factor = g / 100;
  const n = AppState.currentNutrition || {};

  document.getElementById('m-val-cal').textContent = Math.round((n.calories_per_100g || 0) * factor);
  document.getElementById('m-val-pro').textContent = Math.round((n.protein || 0) * factor * 10) / 10 + 'g';
  document.getElementById('m-val-car').textContent = Math.round((n.carbs || 0) * factor * 10) / 10 + 'g';
  document.getElementById('m-val-fat').textContent = Math.round((n.fat || 0) * factor * 10) / 10 + 'g';
}

async function logManualSearchMeal() {
  const portion = parseInt(document.getElementById('manual-grams-slider').value) || 100;
  const factor = portion / 100;
  const n = AppState.currentNutrition || {};

  const payload = {
    user_id: AppState.userId,
    food: AppState.currentFoodName,
    portion: portion,
    calories: Math.round((n.calories_per_100g || 0) * factor),
    protein: Math.round((n.protein || 0) * factor * 10) / 10,
    carbs: Math.round((n.carbs || 0) * factor * 10) / 10,
    fat: Math.round((n.fat || 0) * factor * 10) / 10,
    meal_type: AppState.currentMealType,
    date: AppState.diaryDate
  };

  try {
    const res = await fetch('/api/log_meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Meal added to diary! ✅');
      document.getElementById('manual-portion-card').style.display = 'none';
      setTimeout(() => showScreen('history'), 500);
    }
  } catch (e) {}
}

// ==========================================
// 8. BARCODE & FMCG SCANNER
// ==========================================
async function openBarcodeModal() {
  document.getElementById('barcode-scan-modal').classList.add('open');
  const viewport = document.getElementById('barcode-camera-viewport');
  viewport.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:82%;height:60%;border:2px solid #f97316;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,0,0,0.5);pointer-events:none;"></div>';
  AppState.barcodeRunning = true;

  if (nativeBarcodeDetector && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
      });
      AppState.barcodeStream = stream;
      const tracks = stream.getVideoTracks();
      if (tracks.length > 0) AppState.barcodeVideoTrack = tracks[0];

      const video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.autoplay = true;
      video.muted = true;
      viewport.appendChild(video);
      await video.play();

      function scanNativeFrame() {
        if (!AppState.barcodeRunning) return;
        if (video.readyState >= 2) {
          nativeBarcodeDetector.detect(video).then(codes => {
            if (codes.length > 0 && codes[0].rawValue && AppState.barcodeRunning) {
              onBarcodeFound(codes[0].rawValue);
              return;
            }
            if (AppState.barcodeRunning) AppState.barcodeAnimFrame = requestAnimationFrame(scanNativeFrame);
          }).catch(() => {
            if (AppState.barcodeRunning) AppState.barcodeAnimFrame = requestAnimationFrame(scanNativeFrame);
          });
        } else {
          if (AppState.barcodeRunning) AppState.barcodeAnimFrame = requestAnimationFrame(scanNativeFrame);
        }
      }
      AppState.barcodeAnimFrame = requestAnimationFrame(scanNativeFrame);
      return;
    } catch (e) {}
  }

  // Quagga Fallback
  if (typeof Quagga !== 'undefined') {
    Quagga.init({
      inputStream: { name: 'Live', type: 'LiveStream', target: viewport },
      decoder: { readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'code_128_reader'] }
    }, (err) => {
      if (!err) Quagga.start();
    });
    Quagga.onDetected(res => {
      if (res && res.codeResult && res.codeResult.code) {
        onBarcodeFound(res.codeResult.code);
      }
    });
  }
}

function onBarcodeFound(code) {
  AppState.barcodeRunning = false;
  if (AppState.barcodeAnimFrame) cancelAnimationFrame(AppState.barcodeAnimFrame);
  if (navigator.vibrate) try { navigator.vibrate(100); } catch (e) {}
  closeBarcodeModal();
  lookupBarcodeProduct(code);
}

function closeBarcodeModal() {
  document.getElementById('barcode-scan-modal').classList.remove('open');
  AppState.barcodeRunning = false;
  if (AppState.barcodeAnimFrame) cancelAnimationFrame(AppState.barcodeAnimFrame);
  if (AppState.barcodeStream) {
    AppState.barcodeStream.getTracks().forEach(t => t.stop());
    AppState.barcodeStream = null;
  }
  if (typeof Quagga !== 'undefined') {
    try { Quagga.stop(); } catch (e) {}
  }
}

async function toggleTorchlight() {
  if (!AppState.barcodeVideoTrack) {
    showToast('Flashlight not available.', true);
    return;
  }
  try {
    const caps = AppState.barcodeVideoTrack.getCapabilities ? AppState.barcodeVideoTrack.getCapabilities() : {};
    if (caps.torch) {
      AppState.isTorchOn = !AppState.isTorchOn;
      await AppState.barcodeVideoTrack.applyConstraints({ advanced: [{ torch: AppState.isTorchOn }] });
      showToast(AppState.isTorchOn ? 'Flashlight ON 🔦' : 'Flashlight OFF 🔦');
    }
  } catch (e) {}
}

function lookupManualBarcodeString() {
  const val = (document.getElementById('manual-barcode-digits').value || '').trim();
  if (val.length < 4) {
    showToast('Please enter a valid barcode.', true);
    return;
  }
  lookupBarcodeProduct(val);
}

async function lookupBarcodeProduct(code) {
  showToast(`Searching barcode (${code})...`);
  try {
    const keyParam = AppState.geminiKey ? `?api_key=${encodeURIComponent(AppState.geminiKey)}` : '';
    const res = await fetch(`/api/barcode/${encodeURIComponent(code)}${keyParam}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      showToast(data.error || 'Product not recognized.', true);
      return;
    }

    AppState.barcodeNutrition = data;
    document.getElementById('bc-item-name').textContent = data.name;
    document.getElementById('bc-brand-badge').textContent = data.brand || data.source || 'PACKAGED FOOD';
    document.getElementById('bc-serving-slider').value = 100;
    updateBarcodeServing(100);

    const modal = document.getElementById('barcode-result-modal');
    if (modal) {
      modal.classList.add('open');
    }
    showToast(`Found: ${data.name}`);
  } catch (e) {
    showToast('Lookup failed. Check connection.', true);
  }
}

function updateBarcodeServing(grams) {
  const g = parseInt(grams) || 100;
  const label = document.getElementById('bc-serving-label');
  if (label) label.textContent = `${g}g`;

  const f = g / 100;
  const n = AppState.barcodeNutrition;

  document.getElementById('bc-val-cal').textContent = Math.round((n.calories_per_100g || 0) * f);
  document.getElementById('bc-val-pro').textContent = Math.round((n.protein || 0) * f * 10) / 10 + 'g';
  document.getElementById('bc-val-car').textContent = Math.round((n.carbs || 0) * f * 10) / 10 + 'g';
  document.getElementById('bc-val-fat').textContent = Math.round((n.fat || 0) * f * 10) / 10 + 'g';
}

async function logBarcodeItemToDiary() {
  const portion = parseInt(document.getElementById('bc-serving-slider').value) || 100;
  const f = portion / 100;
  const n = AppState.barcodeNutrition;

  const payload = {
    user_id: AppState.userId,
    food: n.name,
    portion: portion,
    calories: Math.round((n.calories_per_100g || 0) * f),
    protein: Math.round((n.protein || 0) * f * 10) / 10,
    carbs: Math.round((n.carbs || 0) * f * 10) / 10,
    fat: Math.round((n.fat || 0) * f * 10) / 10,
    meal_type: AppState.currentMealType,
    date: AppState.diaryDate
  };

  try {
    const res = await fetch('/api/log_meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Packaged item added to diary! ✅');
      document.getElementById('barcode-result-card').style.display = 'none';
      setTimeout(() => showScreen('history'), 500);
    }
  } catch (e) {}
}

async function handlePackageImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  showToast('AI analyzing package OCR & nutrition facts...');

  const fd = new FormData();
  fd.append('image', file);
  if (AppState.geminiKey) fd.append('api_key', AppState.geminiKey);

  try {
    const res = await fetch('/api/scan_package', { method: 'POST', body: fd });
    const data = await res.json();
    if (res.ok && data.success) {
      AppState.barcodeNutrition = data;
      document.getElementById('bc-item-name').textContent = data.name;
      document.getElementById('bc-brand-badge').textContent = data.source || 'AI OCR Verified';
      const defPortion = data.portion_g || 100;
      document.getElementById('bc-serving-slider').value = defPortion;
      updateBarcodeServing(defPortion);

      const modal = document.getElementById('barcode-result-modal');
      if (modal) {
        modal.classList.add('open');
      }
      showToast(`Recognized: ${data.name}`);
    } else {
      showToast(data.error || 'Could not read package label.', true);
    }
  } catch (err) {
    showToast('Package OCR scan failed.', true);
  }
}

// ==========================================
// 9. HISTORY & DIARY TIMELINE
// ==========================================
function navigateHistoryDate(daysDelta) {
  const cur = new Date(AppState.diaryDate);
  cur.setDate(cur.getDate() + daysDelta);
  AppState.diaryDate = cur.toISOString().split('T')[0];
  updateHistoryDateHeader();
  loadHistoryTimeline();
}

function updateHistoryDateHeader() {
  const isToday = AppState.diaryDate === new Date().toISOString().split('T')[0];
  const options = { weekday: 'short', day: 'numeric', month: 'short' };
  const str = new Date(AppState.diaryDate).toLocaleDateString('en-IN', options);
  
  const title = document.getElementById('history-date-title');
  if (title) title.textContent = isToday ? `Today (${str})` : str;
}

async function loadHistoryTimeline() {
  try {
    const res = await fetch(`/api/get_diary/${AppState.userId}?date=${AppState.diaryDate}`);
    const data = await res.json();
    renderHistoryTimeline(data.entries || [], data.totals || {});
  } catch (e) {
    renderHistoryTimeline([], {});
  }
}

function renderHistoryTimeline(entries, totals) {
  const container = document.getElementById('history-timeline-container');
  if (!container) return;

  document.getElementById('hist-cal-total').textContent = Math.round(totals.calories || 0);
  document.getElementById('hist-pro-total').textContent = Math.round(totals.protein || 0) + 'g';
  document.getElementById('hist-car-total').textContent = Math.round(totals.carbs || 0) + 'g';
  document.getElementById('hist-fat-total').textContent = Math.round(totals.fat || 0) + 'g';

  if (!entries || entries.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:44px 20px;background:var(--bg-surface-subtle);border-radius:var(--radius-lg);border:1px solid var(--border-hairline);">
        <div style="font-size:2.5rem;margin-bottom:8px;">🍽️</div>
        <div style="font-family:var(--font-display);font-weight:700;font-size:1.05rem;color:var(--text-primary);">No meals logged for this day</div>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin:4px 0 18px;">Scan your food or search the database to log meals.</p>
        <button type="button" class="btn btn-primary btn-sm" onclick="showScreen('scanner')">Scan Food Plate</button>
      </div>
    `;
    return;
  }

  const mealGroups = { breakfast: [], lunch: [], dinner: [], snack: [] };
  entries.forEach((e, idx) => {
    e._index = idx;
    const type = e.meal_type || 'lunch';
    if (!mealGroups[type]) mealGroups[type] = [];
    mealGroups[type].push(e);
  });

  const mealHeaders = {
    breakfast: '🌅 Breakfast',
    lunch: '☀️ Lunch',
    dinner: '🌙 Dinner',
    snack: '🍎 Snacks'
  };

  let html = '';
  ['breakfast', 'lunch', 'dinner', 'snack'].forEach(m => {
    const list = mealGroups[m];
    if (!list || list.length === 0) return;

    const subCal = list.reduce((acc, x) => acc + (x.calories || 0), 0);
    const subPro = list.reduce((acc, x) => acc + (x.protein || 0), 0);

    html += `
      <div class="meal-timeline-block">
        <div class="meal-block-top">
          <span>${mealHeaders[m]}</span>
          <span style="color:var(--accent-primary);">${subCal} kcal · ${Math.round(subPro)}g Pro</span>
        </div>
        <div>
          ${list.map(e => `
            <div class="timeline-entry-row">
              <div>
                <div class="entry-food-title">${e.food.replace(/_/g, ' ')}</div>
                <div class="entry-food-meta">
                  ${e.portion}g · P:${e.protein}g · C:${e.carbs}g · F:${e.fat}g ${e.time ? '· ' + e.time : ''}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:12px;">
                <span style="font-family:var(--font-display);font-weight:700;color:var(--accent-primary);font-size:0.95rem;">${e.calories} kcal</span>
                <button type="button" class="delete-entry-btn" onclick="deleteHistoryEntry(${e._index})" title="Remove item">🗑️</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

async function deleteHistoryEntry(index) {
  if (!confirm('Remove this food item from your timeline?')) return;
  try {
    const res = await fetch('/api/delete_meal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: AppState.userId, date: AppState.diaryDate, meal_index: index })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Meal removed.');
      renderHistoryTimeline(data.entries, data.totals);
      loadDashboard();
    }
  } catch (e) {}
}

function copyHistorySummary() {
  const cal = document.getElementById('hist-cal-total').textContent;
  const pro = document.getElementById('hist-pro-total').textContent;
  const car = document.getElementById('hist-car-total').textContent;
  const fat = document.getElementById('hist-fat-total').textContent;
  
  const text = `🍛 NutriVision India — Daily Summary (${AppState.diaryDate})\n🔥 Total Calories: ${cal} kcal\n💪 Protein: ${pro} | ⚡ Carbs: ${car} | 🥑 Fat: ${fat}\nTracked with NutriVision India.`;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Timeline summary copied! 📋');
  }).catch(() => {
    showToast('Could not copy summary.', true);
  });
}

// ==========================================
// 10. NUTRI-COACH AI (GEMINI)
// ==========================================
function checkGeminiKeyStatus() {
  const statusEl = document.getElementById('key-status-label');
  const btnText = document.getElementById('key-btn-text');
  const inputEl = document.getElementById('gemini-key-input');
  if (inputEl && AppState.geminiKey) inputEl.value = AppState.geminiKey;

  if (AppState.geminiKey) {
    if (statusEl) { statusEl.textContent = 'Saved in Browser ✓'; statusEl.style.color = '#10b981'; }
    if (btnText) btnText.textContent = 'API Key Configured ✓';
  } else {
    fetch('/api/coach/status').then(r => r.json()).then(data => {
      if (data.has_server_key) {
        if (statusEl) { statusEl.textContent = 'Server Environment Key Active ✓'; statusEl.style.color = '#38bdf8'; }
        if (btnText) btnText.textContent = 'Server Key Active ✓';
      }
    }).catch(() => {});
  }
}

function openGeminiModal() {
  document.getElementById('gemini-key-modal').classList.add('open');
}
function closeGeminiModal() {
  document.getElementById('gemini-key-modal').classList.remove('open');
}

function saveGeminiAPIKey() {
  const val = (document.getElementById('gemini-key-input').value || '').trim();
  AppState.geminiKey = val;
  if (val) {
    localStorage.setItem('nv_gemini_key', val);
    showToast('Gemini API Key Saved! 🚀');
  } else {
    localStorage.removeItem('nv_gemini_key');
    showToast('API Key cleared.');
  }
  checkGeminiKeyStatus();
  closeGeminiModal();
}

async function testGeminiAPIKey() {
  const keyInput = (document.getElementById('gemini-key-input').value || '').trim();
  const testBtn = document.getElementById('btn-test-gemini-key');
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';

  try {
    const res = await fetch('/api/coach/test_key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: keyInput })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Gemini API Connected Successfully! 🚀');
    } else {
      showToast(data.error || 'Connection test failed.', true);
    }
  } catch (e) {
    showToast('Network error during test.', true);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Key';
  }
}

function loadCoachScreen() {
  updateCoachContextStrip();
  const stream = document.getElementById('coach-chat-stream');
  if (stream && stream.children.length === 0) {
    initCoachWelcome();
  }
}

function updateCoachContextStrip() {
  const goalEl = document.getElementById('c-ctx-goal');
  const calEl = document.getElementById('c-ctx-cal');
  const proEl = document.getElementById('c-ctx-pro');
  const mealsEl = document.getElementById('c-ctx-meals');

  if (!AppState.profile) return;
  const targets = AppState.profile.targets || { calories: 2000, protein_g: 120 };
  const remCal = Math.max(0, targets.calories - Math.round(AppState.diaryTotals.calories || 0));
  const remPro = Math.max(0, targets.protein_g - Math.round(AppState.diaryTotals.protein || 0));

  if (goalEl) goalEl.textContent = AppState.profile.goal === 'fat_loss' ? 'Fat Loss' : AppState.profile.goal === 'muscle_gain' ? 'Muscle Gain' : 'Maintain';
  if (calEl) calEl.textContent = `${remCal} kcal`;
  if (proEl) proEl.textContent = `${remPro}g`;
}

function initCoachWelcome() {
  const stream = document.getElementById('coach-chat-stream');
  if (!stream) return;
  stream.innerHTML = '';
  AppState.coachHistory = [];
  const name = AppState.profile ? AppState.profile.name : 'there';
  const welcome = `👋 **Namaste ${name}!** I am your **NutriCoach AI** nutritionist.\n\nI have live context of your calorie budget, daily protein target, and meals logged today.\n\nAsk me for:\n- 🍛 High-protein Indian meal ideas tailored to your remaining macros\n- ⚖️ Healthy restaurant swaps and festival diet strategies\n- 🥗 Low-calorie Indian evening snacks (<150 kcal)\n- 🏋️ Pre/Post workout nutrition\n\n*Tap a suggestion below or type your question!*`;
  appendCoachMessage(welcome, false);
}

function clearCoachConversation() {
  if (confirm('Reset conversation history?')) {
    initCoachWelcome();
    showToast('Conversation reset.');
  }
}

function appendUserMessage(text) {
  const stream = document.getElementById('coach-chat-stream');
  const row = document.createElement('div');
  row.className = 'chat-bubble-row user';
  row.innerHTML = `<div class="chat-bubble"><p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p></div>`;
  stream.appendChild(row);
  stream.scrollTop = stream.scrollHeight;
}

function appendCoachMessage(markdown, save = true) {
  const stream = document.getElementById('coach-chat-stream');
  const row = document.createElement('div');
  row.className = 'chat-bubble-row assistant';
  row.innerHTML = `
    <div style="font-size:1.25rem;">🤖</div>
    <div class="chat-bubble">${renderMarkdownText(markdown)}</div>
  `;
  stream.appendChild(row);
  stream.scrollTop = stream.scrollHeight;
  if (save) AppState.coachHistory.push({ role: 'assistant', content: markdown });
}

function renderMarkdownText(text) {
  if (!text) return '';
  let escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = escaped.split('\n');
  let res = '';
  let inList = false;

  for (let l of lines) {
    let t = l.trim();
    if (!t) { if (inList) { res += '</ul>'; inList = false; } continue; }
    if (t.startsWith('- ') || t.startsWith('* ')) {
      if (!inList) { res += '<ul>'; inList = true; }
      res += `<li>${t.substring(2)}</li>`;
    } else {
      if (inList) { res += '</ul>'; inList = false; }
      res += `<p>${t}</p>`;
    }
  }
  if (inList) res += '</ul>';
  return res;
}

function sendPromptChip(text) {
  sendCoachChat(text);
}

function handleCoachInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCoachChat();
  }
}

async function sendCoachChat(customText) {
  if (AppState.isCoachReplying) return;
  const input = document.getElementById('coach-query-input');
  const text = (customText || (input ? input.value : '')).trim();
  if (!text) return;
  if (!customText && input) input.value = '';

  appendUserMessage(text);
  AppState.coachHistory.push({ role: 'user', content: text });

  AppState.isCoachReplying = true;
  const sendBtn = document.getElementById('coach-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  const stream = document.getElementById('coach-chat-stream');
  const typingIndicator = document.createElement('div');
  typingIndicator.id = 'coach-thinking-bubble';
  typingIndicator.className = 'chat-bubble-row assistant';
  typingIndicator.innerHTML = `<div style="font-size:1.25rem;">🤖</div><div class="chat-bubble" style="font-style:italic;color:var(--text-tertiary);">NutriCoach is analyzing your diet context...</div>`;
  stream.appendChild(typingIndicator);
  stream.scrollTop = stream.scrollHeight;

  try {
    const res = await fetch('/api/coach/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: AppState.coachHistory.slice(0, -1),
        user_id: AppState.userId,
        api_key: AppState.geminiKey
      })
    });
    typingIndicator.remove();
    const data = await res.json();
    if (res.ok && data.success) {
      appendCoachMessage(data.reply, true);
    } else {
      appendCoachMessage(`⚠️ ${data.error || 'Unable to connect to Gemini AI.'}`, false);
    }
  } catch (err) {
    typingIndicator.remove();
    appendCoachMessage('⚠️ Connection error. Please verify server status.', false);
  } finally {
    AppState.isCoachReplying = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function startVoiceMic() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Speech recognition not supported in this browser.', true);
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-IN';
  const micBtn = document.getElementById('coach-voice-btn');
  if (micBtn) micBtn.style.color = '#ef4444';
  showToast('🎙️ Listening... Speak your question.');

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById('coach-query-input').value = transcript;
    if (micBtn) micBtn.style.color = 'var(--text-secondary)';
    sendCoachChat();
  };
  recognition.onerror = () => {
    if (micBtn) micBtn.style.color = 'var(--text-secondary)';
  };
  recognition.onend = () => {
    if (micBtn) micBtn.style.color = 'var(--text-secondary)';
  };
  recognition.start();
}

// ==========================================
// 11. TOAST NOTIFICATIONS
// ==========================================
function showToast(message, isError = false) {
  const toast = document.getElementById('app-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.borderColor = isError ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)';
  toast.style.color = isError ? '#fca5a5' : '#86efac';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}
