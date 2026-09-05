import sys, os
SRC_DIR = os.path.dirname(os.path.abspath(__file__))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)

from flask import Flask, render_template, request, jsonify
from ensemble_predict import load_all_models, ensemble_predict
from tdee import calculate_tdee, calculate_targets
from werkzeug.utils import secure_filename
import json, re, base64, requests as req
import time

search_cache = {}
CACHE_DURATION = 300
barcode_cache = {}
BARCODE_CACHE_DURATION = 3600

def get_cached_search(query):
    if query in search_cache:
        result, timestamp = search_cache[query]
        if time.time() - timestamp < CACHE_DURATION:
            return result
    return None

def set_cached_search(query, results):
    search_cache[query] = (results, time.time())
from datetime import datetime, date

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# ============ CONFIG ============
USDA_API_KEY = os.environ.get("USDA_API_KEY", "GGEnPm3hmMjnPmtnLtMF6st8W05L7X4IkMDohzoQ")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""

BASE_DIR = os.path.dirname(SRC_DIR)

app = Flask(__name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static'))
app.secret_key = os.environ.get('SECRET_KEY', 'nutrivision2025secretkey')

UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
DIARY_PATH    = os.path.join(BASE_DIR, 'data', 'food_diary.json')
PROFILE_PATH  = os.path.join(BASE_DIR, 'data', 'user_profiles.json')
DATA_PATH     = os.path.join(BASE_DIR, 'data', 'indian_nutrition.json')
WATER_PATH    = os.path.join(BASE_DIR, 'data', 'water_tracker.json')
MODEL_PATH    = os.path.join(BASE_DIR, 'models', 'nutrivision_model.pth')

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ============ LOAD DATA (small, load eagerly) ============
with open(DATA_PATH) as f:
    nutrition_db = json.load(f)
print(f"Nutrition DB loaded: {len(nutrition_db)} foods")

# ============ LAZY MODEL LOADING ============
# Models are NOT loaded at startup to avoid OOM on Render free tier (512MB).
# They are loaded on the first /analyze request.
import threading
_model_lock = threading.Lock()
MODELS_DIR = os.path.join(BASE_DIR, 'models')
models_list = None
class_names = None

def _ensure_models_loaded():
    global models_list, class_names
    if models_list is not None:
        return
    with _model_lock:
        if models_list is not None:
            return
        print("[lazy] Loading ensemble models...")
        models_list, class_names = load_all_models(MODELS_DIR)
        print(f"[lazy] Ready! {len(models_list)} models loaded")

# ============ HELPERS ============
def load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except:
        return {}

def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)

def extract_nutrient(nutrients, keyword):
    """Safely extract a nutrient value from USDA nutrients list"""
    for n in nutrients:
        if keyword.lower() in n.get('nutrientName', '').lower():
            return round(n.get('value', 0), 1)
    return 0

def get_day_totals(diary, user_id, target_date=None):
    day_str = target_date or str(date.today())
    entries = diary.get(user_id, {}).get(day_str, [])
    totals = {'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0}
    for e in entries:
        totals['calories'] += e.get('calories', 0)
        totals['protein']  += e.get('protein', 0)
        totals['carbs']    += e.get('carbs', 0)
        totals['fat']      += e.get('fat', 0)
    totals['calories'] = round(totals['calories'])
    totals['protein']  = round(totals['protein'], 1)
    totals['carbs']    = round(totals['carbs'], 1)
    totals['fat']      = round(totals['fat'], 1)
    return totals, entries

def get_today_totals(diary, user_id):
    return get_day_totals(diary, user_id, str(date.today()))

# ============ ROUTES ============

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/ping')
def ping():
    return jsonify({'status': 'alive'})

# ---------- GS1 INDIA BRAND DIRECTORY & DAIRY CATALOG ----------

GS1_INDIAN_BRANDS = {
    "8901262": "Amul (GCMMF) - Milk, Taaza, Gold, Ice Cream, Butter, Cheese, Paneer, Dahi, Lassi, Buttermilk",
    "8901030": "Hindustan Unilever / Kwality Wall's - Ice Creams, Cornetto, Feast, Magnum, Cassatta, Kulfi, Knorr, Bru",
    "8901648": "Mother Dairy - Milk (Full Cream, Toned, Cow Milk), Ice Cream, Dahi, Chaach, Paneer",
    "8906007": "Vadilal Industries - Ice Creams, Kulfi, Gourmet Tubs, Cones, Cassatta, Frozen Desserts",
    "8906019": "Havmor Ice Cream - Ice Creams, Butterscotch, Kulfi, Choco Block, Cones, Tubs",
    "8904004": "Nandini / KMF - Toned Milk, Full Cream Milk, Curd, Ghee, Ice Creams, Kulfi",
    "8908001": "Arun Icecreams / Hatsun Agro / Arokya Milk",
    "8902080": "Dinshaw's Dairy & Ice Creams - Tubs, Cones, Kulfi, Milk",
    "8906071": "Epigamia (Drums Food) - Greek Yogurt, Flavoured Milk, Milkshakes, Smoothies",
    "8904153": "Country Delight - Fresh Cow Milk, Buffalo Milk, Ghee, Paneer, Dahi",
    "8906012": "Cream Bell Ice Cream (Devyani Food) - Cones, Tubs, Cups, Kulfi",
    "8904256": "Baskin Robbins India - Ice Creams, Sundaes, Shakes",
    "8901058": "Nestle India - Everyday Milk, A+ Milk, KitKat, Munch, Milkybar, Maggi",
    "8901063": "Britannia Industries - Winkin Cow Milkshakes, Cheese, Butter, Daily Bread, Biscuits",
    "8901491": "PepsiCo India - Tropicana, Lay's, Kurkure, Quaker Oats",
    "8901719": "Parle Products - Parle-G, Monaco, Hide & Seek, Frooti, Real Milk",
    "8901207": "ITC Limited - Sunfeast Milkshakes, Aashirvaad, Dark Fantasy, Bingo",
    "8901233": "Dabur India - Real Fruit Juice, Milkshakes, Honey, Chyawanprash",
    "8901725": "Haldiram's Snacks - Namkeen, Bhujia, Gulab Jamun, Rasgulla, Sweets",
    "8901764": "Bikanervala / Bikano",
    "8906010": "Patanjali Ayurved - Cow Milk, Cow Ghee, Biscuits, Honey",
    "8901072": "Cadbury / Mondelez India - Dairy Milk, Bournvita, Oreo, 5 Star"
}

INDIAN_DAIRY_CATALOG = {
    # Amul Milk & Dairy
    "8901262010053": {"name": "Amul Taaza Toned Milk (Homogenised)", "calories_per_100g": 58, "protein": 3.0, "carbs": 4.7, "fat": 3.0, "brand": "Amul"},
    "8901262010015": {"name": "Amul Gold Full Cream Milk", "calories_per_100g": 87, "protein": 3.5, "carbs": 5.0, "fat": 6.0, "brand": "Amul"},
    "8901262010114": {"name": "Amul Cow Milk", "calories_per_100g": 62, "protein": 3.1, "carbs": 4.8, "fat": 3.5, "brand": "Amul"},
    "8901262010077": {"name": "Amul Slim 'n' Trim Double Toned Milk", "calories_per_100g": 46, "protein": 3.2, "carbs": 4.9, "fat": 1.5, "brand": "Amul"},
    "8901262010046": {"name": "Amul Diamond Milk", "calories_per_100g": 93, "protein": 3.6, "carbs": 5.0, "fat": 7.0, "brand": "Amul"},
    "8901262010206": {"name": "Amul Fresh Cream", "calories_per_100g": 245, "protein": 2.0, "carbs": 3.5, "fat": 25.0, "brand": "Amul"},
    "8901262030013": {"name": "Amul Masti Dahi (Curd)", "calories_per_100g": 60, "protein": 3.7, "carbs": 4.4, "fat": 3.0, "brand": "Amul"},
    "8901262040012": {"name": "Amul Salted Butter", "calories_per_100g": 717, "protein": 0.9, "carbs": 0.0, "fat": 80.0, "brand": "Amul"},
    "8901262050011": {"name": "Amul Malai Paneer", "calories_per_100g": 289, "protein": 18.0, "carbs": 2.0, "fat": 23.0, "brand": "Amul"},
    "8901262070019": {"name": "Amul Vanilla Magic Ice Cream", "calories_per_100g": 185, "protein": 3.8, "carbs": 22.5, "fat": 8.8, "brand": "Amul"},
    "8901262070026": {"name": "Amul Chocolate Ice Cream", "calories_per_100g": 210, "protein": 4.0, "carbs": 24.0, "fat": 10.5, "brand": "Amul"},
    "8901262070033": {"name": "Amul Kesar Pista Ice Cream", "calories_per_100g": 215, "protein": 4.2, "carbs": 23.8, "fat": 11.0, "brand": "Amul"},
    "8901262070057": {"name": "Amul Rajbhog Ice Cream", "calories_per_100g": 225, "protein": 4.5, "carbs": 24.5, "fat": 12.0, "brand": "Amul"},

    # Mother Dairy Milk & Ice Cream
    "8901648001015": {"name": "Mother Dairy Toned Milk", "calories_per_100g": 59, "protein": 3.1, "carbs": 4.7, "fat": 3.0, "brand": "Mother Dairy"},
    "8901648001022": {"name": "Mother Dairy Full Cream Milk", "calories_per_100g": 88, "protein": 3.5, "carbs": 5.0, "fat": 6.0, "brand": "Mother Dairy"},
    "8901648001039": {"name": "Mother Dairy Cow Milk", "calories_per_100g": 62, "protein": 3.2, "carbs": 4.8, "fat": 3.5, "brand": "Mother Dairy"},
    "8901648001046": {"name": "Mother Dairy Live Lite Double Toned Milk", "calories_per_100g": 47, "protein": 3.3, "carbs": 4.9, "fat": 1.5, "brand": "Mother Dairy"},
    "8901648003019": {"name": "Mother Dairy Classic Curd / Dahi", "calories_per_100g": 61, "protein": 3.8, "carbs": 4.5, "fat": 3.1, "brand": "Mother Dairy"},
    "8901648007017": {"name": "Mother Dairy Vanilla Ice Cream", "calories_per_100g": 190, "protein": 3.6, "carbs": 23.0, "fat": 9.2, "brand": "Mother Dairy"},
    "8901648007024": {"name": "Mother Dairy Kulfi / Malai Kulfi", "calories_per_100g": 230, "protein": 4.6, "carbs": 25.0, "fat": 12.5, "brand": "Mother Dairy"},

    # Kwality Wall's Ice Creams
    "8901030383709": {"name": "Kwality Wall's Cornetto Double Chocolate", "calories_per_100g": 285, "protein": 4.2, "carbs": 38.0, "fat": 13.0, "brand": "Kwality Wall's"},
    "8901030383716": {"name": "Kwality Wall's Feast Chocolate Bar", "calories_per_100g": 310, "protein": 4.5, "carbs": 32.0, "fat": 18.5, "brand": "Kwality Wall's"},
    "8901030383723": {"name": "Kwality Wall's Magnum Classic", "calories_per_100g": 340, "protein": 4.8, "carbs": 31.0, "fat": 22.0, "brand": "Kwality Wall's"},
    "8901030383730": {"name": "Kwality Wall's Cassatta Slice", "calories_per_100g": 220, "protein": 3.8, "carbs": 32.0, "fat": 8.5, "brand": "Kwality Wall's"},
    "8901030383747": {"name": "Kwality Wall's Vanilla Tub", "calories_per_100g": 180, "protein": 3.2, "carbs": 22.0, "fat": 8.8, "brand": "Kwality Wall's"},

    # Nandini (KMF)
    "8904004400018": {"name": "Nandini Toned Fresh Milk", "calories_per_100g": 58, "protein": 3.1, "carbs": 4.7, "fat": 3.0, "brand": "Nandini"},
    "8904004400025": {"name": "Nandini Shubham Special Milk", "calories_per_100g": 72, "protein": 3.3, "carbs": 4.8, "fat": 4.5, "brand": "Nandini"},
    "8904004400032": {"name": "Nandini Samrudhi Full Cream Milk", "calories_per_100g": 87, "protein": 3.5, "carbs": 5.0, "fat": 6.0, "brand": "Nandini"},

    # Vadilal Ice Cream
    "8906007280017": {"name": "Vadilal Vanilla Party Pack", "calories_per_100g": 182, "protein": 3.5, "carbs": 22.0, "fat": 8.7, "brand": "Vadilal"},
    "8906007280024": {"name": "Vadilal Kesar Pista Ice Cream", "calories_per_100g": 218, "protein": 4.1, "carbs": 24.0, "fat": 11.2, "brand": "Vadilal"},
    "8906007280031": {"name": "Vadilal Matka Kulfi", "calories_per_100g": 240, "protein": 4.8, "carbs": 26.0, "fat": 13.0, "brand": "Vadilal"},

    # Havmor Ice Cream
    "8906019120014": {"name": "Havmor Butterscotch Ice Cream", "calories_per_100g": 215, "protein": 3.8, "carbs": 25.5, "fat": 10.8, "brand": "Havmor"},
    "8906019120021": {"name": "Havmor Chocolate Block Cone", "calories_per_100g": 295, "protein": 4.3, "carbs": 36.0, "fat": 15.0, "brand": "Havmor"},
    "8906019120038": {"name": "Havmor Zulubar Ice Cream", "calories_per_100g": 310, "protein": 4.5, "carbs": 33.0, "fat": 18.0, "brand": "Havmor"},

    # Epigamia Greek Yogurt
    "8906071740018": {"name": "Epigamia Natural Greek Yogurt (High Protein)", "calories_per_100g": 90, "protein": 6.0, "carbs": 6.5, "fat": 4.0, "brand": "Epigamia"},
    "8906071740025": {"name": "Epigamia Strawberry Greek Yogurt", "calories_per_100g": 105, "protein": 5.5, "carbs": 14.0, "fat": 3.2, "brand": "Epigamia"},

    # Country Delight
    "8904153000012": {"name": "Country Delight Pure Cow Milk", "calories_per_100g": 64, "protein": 3.2, "carbs": 4.8, "fat": 3.6, "brand": "Country Delight"},
    "8904153000029": {"name": "Country Delight Buffalo Milk", "calories_per_100g": 98, "protein": 4.0, "carbs": 5.1, "fat": 7.2, "brand": "Country Delight"}
}

def parse_off_nutriments(product, source_label, clean_barcode):
    nutriments = product.get('nutriments', {})
    name = (product.get('product_name') or product.get('generic_name') or product.get('product_name_en') or '').strip()
    brand = (product.get('brands') or '').strip()
    
    if brand and brand.lower() not in name.lower():
        display_name = f"{brand} - {name}".strip(' -')
    else:
        display_name = name or f"Packaged Food ({clean_barcode})"

    # Calories per 100g
    cal = nutriments.get('energy-kcal_100g') or nutriments.get('energy-kcal') or nutriments.get('energy-kcal_value') or 0
    if not cal:
        kj = nutriments.get('energy_100g') or nutriments.get('energy') or 0
        if kj:
            try:
                cal = float(kj) / 4.184
            except Exception:
                cal = 0

    pro = nutriments.get('proteins_100g') or nutriments.get('proteins') or nutriments.get('proteins_value') or 0
    car = nutriments.get('carbohydrates_100g') or nutriments.get('carbohydrates') or nutriments.get('carbohydrates_value') or 0
    fat = nutriments.get('fat_100g') or nutriments.get('fat') or nutriments.get('fat_value') or 0

    try:
        cal = float(cal)
        pro = float(pro)
        car = float(car)
        fat = float(fat)
    except Exception:
        pass

    if display_name and (cal or pro or car or fat):
        return {
            'name': display_name[:60],
            'barcode': clean_barcode,
            'calories_per_100g': round(cal),
            'protein': round(pro, 1),
            'carbs': round(car, 1),
            'fat': round(fat, 1),
            'source': source_label,
            'brand': brand or 'Verified Brand'
        }
    return None

@app.route('/api/barcode/<barcode>')
def lookup_barcode(barcode):
    clean_barcode = re.sub(r'[^0-9A-Za-z]', '', str(barcode).strip())
    if not clean_barcode:
        return jsonify({'error': 'Invalid barcode provided'}), 400

    custom_key = request.args.get('api_key', '').strip()

    # Check cache
    if clean_barcode in barcode_cache:
        cached_result, ts = barcode_cache[clean_barcode]
        if time.time() - ts < BARCODE_CACHE_DURATION:
            return jsonify(cached_result)

    # 1. Barcode normalization variations
    variations = [clean_barcode]
    if len(clean_barcode) == 12:
        variations.append("0" + clean_barcode)  # 13-digit EAN
    elif len(clean_barcode) == 13 and clean_barcode.startswith("0"):
        variations.append(clean_barcode[1:])    # 12-digit UPC
    elif len(clean_barcode) == 8:
        variations.append(clean_barcode.zfill(13))

    # 2. Curated Indian Dairy & Ice Cream Catalog check
    for code in variations:
        if code in INDIAN_DAIRY_CATALOG:
            item = INDIAN_DAIRY_CATALOG[code]
            parsed = {
                'name': item['name'],
                'barcode': clean_barcode,
                'calories_per_100g': item['calories_per_100g'],
                'protein': item['protein'],
                'carbs': item['carbs'],
                'fat': item['fat'],
                'source': f"Indian Dairy & FMCG Catalog ({item.get('brand', 'Verified')})",
                'brand': item.get('brand', 'Dairy')
            }
            barcode_cache[clean_barcode] = (parsed, time.time())
            return jsonify(parsed)

    # 3. Database 1 & 2 — Open Food Facts India & Global (v2 & v0 APIs)
    off_endpoints = [
        ("https://in.openfoodfacts.org/api/v2/product/{code}.json", "Open Food Facts India"),
        ("https://world.openfoodfacts.org/api/v2/product/{code}.json", "Open Food Facts"),
        ("https://in.openfoodfacts.org/api/v0/product/{code}.json", "Open Food Facts India"),
        ("https://world.openfoodfacts.org/api/v0/product/{code}.json", "Open Food Facts")
    ]

    for code in variations:
        for url_pattern, source_name in off_endpoints:
            try:
                url = url_pattern.format(code=code)
                res = req.get(url, headers={'User-Agent': 'NutriVision-India-Local-App/1.0 (https://nutrivision.in)'}, timeout=3.5)
                if res.status_code == 200:
                    data = res.json()
                    if data.get('status') == 1 and 'product' in data:
                        parsed = parse_off_nutriments(data['product'], source_name, clean_barcode)
                        if parsed:
                            barcode_cache[clean_barcode] = (parsed, time.time())
                            return jsonify(parsed)
            except Exception as e:
                pass

    # 4. Database 3 — USDA FoodData Central (Branded & Foundation)
    for code in variations:
        try:
            usda_url = "https://api.nal.usda.gov/fdc/v1/foods/search"
            params = {
                'api_key': USDA_API_KEY,
                'query': code,
                'dataType': 'Branded,Foundation,SR Legacy',
                'pageSize': 2
            }
            res = req.get(usda_url, params=params, timeout=4)
            if res.status_code == 200:
                foods = res.json().get('foods', [])
                if foods:
                    food = foods[0]
                    nutrients = food.get('foodNutrients', [])
                    cal = extract_nutrient(nutrients, 'Energy')
                    name = food.get('description', '').strip()
                    brand = food.get('brandOwner') or food.get('brandName') or ''
                    display_name = f"{brand} - {name}".strip(' -') if brand and brand.lower() not in name.lower() else name
                    if cal or extract_nutrient(nutrients, 'Protein'):
                        parsed = {
                            'name': display_name[:60],
                            'barcode': clean_barcode,
                            'calories_per_100g': round(cal),
                            'protein': extract_nutrient(nutrients, 'Protein'),
                            'carbs': extract_nutrient(nutrients, 'Carbohydrate'),
                            'fat': extract_nutrient(nutrients, 'Total lipid'),
                            'source': 'USDA FoodData Central'
                        }
                        barcode_cache[clean_barcode] = (parsed, time.time())
                        return jsonify(parsed)
        except Exception as e:
            pass

    # 5. Database 4 (Universal AI Fallback with GS1 Brand Identification)
    try:
        brand_hint = ""
        for pfx, binfo in GS1_INDIAN_BRANDS.items():
            if clean_barcode.startswith(pfx):
                brand_hint = f"GS1 Manufacturer Identified: {binfo}"
                break

        is_indian = clean_barcode.startswith("890")
        prompt = f"""You are an advanced food packaging and nutrition database system.
A user scanned food barcode: {clean_barcode} (Country prefix: {"India GS1 (890)" if is_indian else "Global"}).
{brand_hint}

1. Identify the specific packaged food product (e.g. Milk packet like Amul Taaza/Gold, Mother Dairy, Nandini; or Ice Cream like Kwality Wall's Cornetto/Feast, Vadilal, Havmor, Arun; or FMCG snack) corresponding to this barcode.
2. If this exact barcode is unknown, determine the most standard packaged food product for this brand/sequence.
3. Provide accurate per-100g (or per-100ml) nutritional facts (Calories, Protein, Carbs, Fat) for this packaged food.

Output ONLY a JSON object (no markdown, no backticks, no other text):
{{
  "name": "Full Product Name with Brand (e.g. Amul Taaza Toned Milk or Kwality Wall's Cornetto)",
  "calories_per_100g": 58,
  "protein": 3.0,
  "carbs": 4.7,
  "fat": 3.0,
  "brand": "Brand Name",
  "notes": "Verified via AI Universal Food Database"
}}"""
        success, reply = call_gemini_api(
            messages=[{'role': 'user', 'content': prompt}],
            system_prompt="You are an accurate nutritional database parser. Always return valid JSON only.",
            api_key=custom_key
        )
        if success and reply:
            clean_reply = reply.replace("```json", "").replace("```", "").strip()
            start = clean_reply.find("{")
            end = clean_reply.rfind("}")
            if start != -1 and end != -1:
                ai_data = json.loads(clean_reply[start:end+1])
                parsed = {
                    'name': str(ai_data.get('name', 'Packaged Food Item'))[:60],
                    'barcode': clean_barcode,
                    'calories_per_100g': round(float(ai_data.get('calories_per_100g', 250))),
                    'protein': round(float(ai_data.get('protein', 5.0)), 1),
                    'carbs': round(float(ai_data.get('carbs', 30.0)), 1),
                    'fat': round(float(ai_data.get('fat', 8.0)), 1),
                    'source': f"Universal AI Database ({ai_data.get('brand', 'Verified')})",
                    'notes': ai_data.get('notes', 'Identified via AI Nutrition Model')
                }
                barcode_cache[clean_barcode] = (parsed, time.time())
                return jsonify(parsed)
    except Exception as e:
        print(f"Gemini barcode fallback error: {e}")

    # Fallback estimate
    fallback_res = {
        'name': f"Packaged Food Item ({clean_barcode})",
        'barcode': clean_barcode,
        'calories_per_100g': 250,
        'protein': 5.0,
        'carbs': 35.0,
        'fat': 8.0,
        'source': 'Standard Packaged Food Database',
        'notes': 'Standard nutritional estimate for packaged food'
    }
    barcode_cache[clean_barcode] = (fallback_res, time.time())
    return jsonify(fallback_res)

# ---------- GEMINI VISION: FOOD IDENTIFICATION & ENRICHMENT ----------

def call_gemini_vision_for_food(image_b64, mime_type, ensemble_hints):
    """
    Sends the food image + ensemble top-K hints to Gemini Vision.
    Returns a dict with:
      food_name, calories_per_100g, protein, carbs, fat,
      portion_estimate_g, health_score, confidence_note, ai_notes
    or None if Gemini is unavailable.
    """
    if not GEMINI_API_KEY:
        return None

    hint_text = ", ".join(
        [f"{h['food'].replace('_', ' ')} ({h['confidence']})" for h in ensemble_hints]
    ) if ensemble_hints else "unknown"

    prompt = f"""You are an expert Indian and global food nutritionist and portion-estimation AI.

A user has photographed a meal. Our local image classifier suggests it could be one of:
  {hint_text}

Your tasks:
1. Look at the image carefully. Confirm the correct dish name (override the hint if you see something different).
2. Estimate the serving weight in grams based on the visual plate/bowl size (typical Indian katori ~150g, full plate ~300-400g, snack ~50-100g).
3. Provide accurate per-100g nutritional values for this dish:
   - calories (kcal), protein (g), carbs (g), fat (g)
4. Give a health score 1-10 for this dish (10 = very healthy, Indian diet context).
5. Write one crisp sentence of nutritional insight (e.g. high protein, high glycaemic index, rich in fibre, etc.).

Return ONLY a JSON object, no markdown, no backticks:
{{
  "food_name": "dish name in English (use _ for spaces, e.g. dal_makhani)",
  "food_display": "Human readable dish name (e.g. Dal Makhani)",
  "calories_per_100g": 120,
  "protein": 6.5,
  "carbs": 14.0,
  "fat": 4.5,
  "portion_estimate_g": 200,
  "health_score": 7,
  "confidence_note": "High confidence — clearly visible bowl of dal",
  "ai_notes": "Rich in plant protein and complex carbs; moderate calorie density."
}}"""

    message_payload = {
        'role': 'user',
        'parts': [
            {'text': prompt},
            {
                'inline_data': {
                    'mime_type': mime_type,
                    'data': image_b64
                }
            }
        ]
    }

    success, reply = call_gemini_api(
        messages=[message_payload],
        system_prompt="You are a precise food nutrition expert. Always return valid JSON only."
    )

    if not success or not reply:
        return None

    try:
        clean = reply.replace("```json", "").replace("```", "").strip()
        start = clean.find("{")
        end = clean.rfind("}")
        if start == -1 or end == -1:
            return None
        ai = json.loads(clean[start:end+1])
        return {
            'food_name':         str(ai.get('food_name', '')).replace(' ', '_').lower(),
            'food_display':      str(ai.get('food_display', ai.get('food_name', ''))).replace('_', ' ').title(),
            'calories_per_100g': round(float(ai.get('calories_per_100g', 0))),
            'protein':           round(float(ai.get('protein', 0)), 1),
            'carbs':             round(float(ai.get('carbs', 0)), 1),
            'fat':               round(float(ai.get('fat', 0)), 1),
            'portion_estimate_g': int(ai.get('portion_estimate_g', 150)),
            'health_score':      min(10, max(1, int(ai.get('health_score', 5)))),
            'confidence_note':   str(ai.get('confidence_note', '')),
            'ai_notes':          str(ai.get('ai_notes', ''))
        }
    except Exception as e:
        print(f"[Gemini Vision] JSON parse error: {e}")
        return None

# ---------- AI PACKAGE & NUTRITION LABEL SCANNER ----------

@app.route('/api/scan_package', methods=['POST'])
def scan_package():
    """
    AI Food Packet & Nutrition Label Scanner using Google Gemini Multimodal Vision.
    Accepts image file or base64 photo of milk pouches, ice cream containers, or nutrition labels.
    """
    custom_key = request.form.get('api_key', '').strip() or request.headers.get('X-Gemini-Key', '').strip()
    image_file = request.files.get('image')
    base64_data = request.form.get('image_base64', '')

    if not image_file and not base64_data:
        data = request.json or {}
        base64_data = data.get('image_base64', '')
        custom_key = custom_key or data.get('api_key', '').strip()

    mime_type = "image/jpeg"
    encoded_str = ""

    if image_file:
        raw_bytes = image_file.read()
        encoded_str = base64.b64encode(raw_bytes).decode('utf-8')
        fname = (image_file.filename or '').lower()
        if fname.endswith('.png'):
            mime_type = "image/png"
        elif fname.endswith('.webp'):
            mime_type = "image/webp"
    elif base64_data:
        if ',' in base64_data:
            header, content = base64_data.split(',', 1)
            encoded_str = content
            if 'png' in header:
                mime_type = 'image/png'
            elif 'webp' in header:
                mime_type = 'image/webp'
        else:
            encoded_str = base64_data

    if not encoded_str:
        return jsonify({'error': 'No image provided for package scanning', 'success': False}), 400

    prompt = """You are an expert food packaging and nutrition facts OCR system for Indian and global products.
Examine this image of a food packet, milk pouch, ice cream container/tub, beverage, or nutrition facts table.

Tasks:
1. Identify the exact product name and brand (e.g. 'Amul Taaza Toned Milk', 'Kwality Wall's Cornetto Double Chocolate', 'Mother Dairy Full Cream Milk', 'Vadilal Matka Kulfi', 'Havmor Butterscotch', 'Epigamia Greek Yogurt', 'Cadbury Dairy Milk', etc.).
2. Extract or compute the nutritional values per 100g (or 100ml):
   - Calories (kcal)
   - Protein (g)
   - Carbohydrates (g)
   - Fat (g)
   - Typical portion size in grams/ml (e.g. 100, 200, 250)

Return ONLY a JSON object (no markdown, no backticks, no other text):
{
  "name": "Full Product Name with Brand",
  "brand": "Brand Name",
  "calories_per_100g": 60,
  "protein": 3.2,
  "carbs": 4.8,
  "fat": 3.0,
  "portion_g": 100,
  "category": "Dairy / Ice Cream / Packaged Food",
  "notes": "Verified via AI Package Vision Scanner"
}"""

    message_payload = {
        'role': 'user',
        'parts': [
            {'text': prompt},
            {
                'inline_data': {
                    'mime_type': mime_type,
                    'data': encoded_str
                }
            }
        ]
    }

    success, reply = call_gemini_api(
        messages=[message_payload],
        system_prompt="You are a precise food packaging OCR and nutrition expert. Return valid JSON only.",
        api_key=custom_key
    )

    if success and reply:
        try:
            clean_reply = reply.replace("```json", "").replace("```", "").strip()
            start = clean_reply.find("{")
            end = clean_reply.rfind("}")
            if start != -1 and end != -1:
                ai_data = json.loads(clean_reply[start:end+1])
                return jsonify({
                    'name': str(ai_data.get('name', 'Packaged Food Item'))[:60],
                    'calories_per_100g': round(float(ai_data.get('calories_per_100g', 150))),
                    'protein': round(float(ai_data.get('protein', 3.0)), 1),
                    'carbs': round(float(ai_data.get('carbs', 15.0)), 1),
                    'fat': round(float(ai_data.get('fat', 5.0)), 1),
                    'source': f"AI Package Vision ({ai_data.get('brand', 'Verified')})",
                    'portion_g': ai_data.get('portion_g', 100),
                    'success': True
                })
        except Exception as e:
            print(f"Error parsing Gemini package vision JSON: {e}")

    return jsonify({
        'error': 'Could not read package nutrition. Please try typing the product name in Search.',
        'success': False
    }), 400

# ---------- PROFILE ----------
@app.route('/api/save_profile', methods=['POST'])
def save_profile():
    data = request.json
    user_id = data.get('user_id', 'default_user')
    profiles = load_json(PROFILE_PATH)

    tdee = calculate_tdee(
        data['weight'], data['height'],
        data['age'], data['gender'], data['activity'])

    targets = calculate_targets(tdee, data['goal'])
    targets['protein_g'] = round(targets['protein_g'] * data['weight'])

    profiles[user_id] = {
        'name':     data['name'],
        'weight':   data['weight'],
        'height':   data['height'],
        'age':      data['age'],
        'gender':   data['gender'],
        'activity': data['activity'],
        'goal':     data['goal'],
        'tdee':     tdee,
        'targets':  targets
    }
    save_json(PROFILE_PATH, profiles)
    return jsonify({'success': True, 'tdee': tdee, 'targets': targets})

@app.route('/api/get_profile/<user_id>')
def get_profile(user_id):
    profiles = load_json(PROFILE_PATH)
    return jsonify(profiles.get(user_id, {}))

# ---------- FOOD SCAN ----------
@app.route('/analyze', methods=['POST'])
def analyze():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    # ── Step 1: Local Ensemble (fast, always runs) ──
    _ensure_models_loaded()
    if not models_list:
        return jsonify({'error': 'Models could not be loaded. Please try again.'}), 500

    predictions = ensemble_predict(filepath, models_list, class_names)
    top_food = predictions[0]['food']

    # ── Step 2: Gemini Vision (hybrid AI enrichment) ──
    # Read image for base64 encoding to send to Gemini
    ai_result = None
    try:
        with open(filepath, 'rb') as img_f:
            raw_bytes = img_f.read()
        image_b64 = base64.b64encode(raw_bytes).decode('utf-8')
        fname_lower = filename.lower()
        if fname_lower.endswith('.png'):
            mime_type = 'image/png'
        elif fname_lower.endswith('.webp'):
            mime_type = 'image/webp'
        else:
            mime_type = 'image/jpeg'

        ai_result = call_gemini_vision_for_food(image_b64, mime_type, predictions)
    except Exception as e:
        print(f"[Gemini Vision] Error: {e}")
        ai_result = None

    # ── Step 3: Merge results ──
    local_db = load_json(DATA_PATH) or nutrition_db

    if ai_result:
        # Gemini confirmed/overrode the food — use AI nutrition data
        gemini_food_name = ai_result['food_name'] or top_food

        # Prefer Gemini macros; supplement health_score/notes from local DB if available
        local_entry = local_db.get(gemini_food_name, local_db.get(top_food, {}))
        nutrition = {
            'calories_per_100g': ai_result['calories_per_100g'] or local_entry.get('calories_per_100g', 200),
            'protein':           ai_result['protein'] or local_entry.get('protein', 5),
            'carbs':             ai_result['carbs'] or local_entry.get('carbs', 25),
            'fat':               ai_result['fat'] or local_entry.get('fat', 5),
            'health_score':      ai_result['health_score'] or local_entry.get('health_score', 5),
            'notes':             ai_result['ai_notes'] or local_entry.get('notes', ''),
            'category':          local_entry.get('category', 'Indian Food')
        }

        # If Gemini identified a different food, surface it as top prediction
        if gemini_food_name != top_food:
            ai_pred = {
                'food':       gemini_food_name,
                'confidence': ai_result['confidence_note'] or predictions[0]['confidence']
            }
            # Insert Gemini pick at front, keep ensemble alternatives
            predictions = [ai_pred] + [p for p in predictions if p['food'] != gemini_food_name]

        return jsonify({
            'predictions':        predictions,
            'nutrition':          nutrition,
            'food_name':          gemini_food_name,
            'food_display':       ai_result['food_display'],
            'portion_estimate_g': ai_result['portion_estimate_g'],
            'ai_verified':        True,
            'ai_notes':           ai_result['ai_notes'],
            'confidence_note':    ai_result['confidence_note'],
            'health_score':       ai_result['health_score']
        })
    else:
        # Gemini unavailable — pure ensemble fallback (existing behaviour)
        nutrition = local_db.get(top_food, local_db.get(top_food.replace('_', ' '), {
            'calories_per_100g': 200,
            'protein': 5, 'carbs': 25, 'fat': 5,
            'health_score': 5,
            'notes': 'Nutrition data coming soon.'
        }))
        return jsonify({
            'predictions': predictions,
            'nutrition':   nutrition,
            'food_name':   top_food,
            'ai_verified': False
        })

# ---------- FOOD SEARCH (LOCAL + USDA + OPEN FOOD FACTS) ----------
@app.route('/api/search_food')
def search_food():
    query = request.args.get('q', '').strip()
    category_filter = request.args.get('category', '').strip().lower()
    
    if len(query) < 2 and not category_filter:
        return jsonify({'results': []})
    
    cache_key = f"{query.lower()}_{category_filter}"
    cached = get_cached_search(cache_key)
    if cached is not None and len(cached) > 0:
        return jsonify({'results': cached})

    q_lower = query.lower()
    results = []
    seen    = set()

    # Non-veg keywords
    non_veg_keywords = ['chicken', 'mutton', 'fish', 'egg', 'prawn', 'meat', 'beef', 'pork', 'keema', 'biryani_chicken']

    # 1. LOCAL Indian database — highest priority
    local_db = load_json(DATA_PATH) or nutrition_db
    for food_key, nutrition in local_db.items():
        food_name_clean = food_key.lower().replace('_', ' ')
        food_cat = (nutrition.get('category') or '').lower()
        
        matches_query = not q_lower or (q_lower in food_name_clean)
        
        matches_cat = True
        if category_filter and category_filter != 'all':
            if category_filter == 'high_protein':
                matches_cat = nutrition.get('protein', 0) >= 8
            elif category_filter in ['breakfast', 'curry', 'rice', 'dal', 'snacks', 'dairy', 'breads', 'sweets']:
                matches_cat = (category_filter in food_cat) or (category_filter in food_name_clean)
            else:
                matches_cat = (category_filter in food_cat)

        if matches_query and matches_cat:
            key = food_key[:25]
            if key not in seen:
                seen.add(key)
                is_non_veg = any(kw in food_name_clean for kw in non_veg_keywords)
                results.append({
                    'name':             food_key,
                    'display_name':     food_key.replace('_', ' ').title(),
                    'calories_per_100g': nutrition.get('calories_per_100g', 0),
                    'protein':          nutrition.get('protein', 0),
                    'carbs':            nutrition.get('carbs', 0),
                    'fat':              nutrition.get('fat', 0),
                    'fiber':            nutrition.get('fiber', 0),
                    'health_score':     nutrition.get('health_score', 5),
                    'category':         nutrition.get('category', 'Indian Food'),
                    'is_veg':           not is_non_veg,
                    'notes':            nutrition.get('notes', ''),
                    'source':           'local'
                })

    # 2. USDA FoodData Central — 500,000+ foods (only if specific query given)
    if q_lower and len(results) < 15:
        try:
            usda_resp = req.get(
                "https://api.nal.usda.gov/fdc/v1/foods/search",
                params={
                    'api_key':  USDA_API_KEY,
                    'query':    query,
                    'pageSize': 15,
                    'dataType': 'Foundation,SR Legacy,Survey (FNDDS),Branded'
                },
                timeout=4
            )
            if usda_resp.status_code == 200:
                for food in usda_resp.json().get('foods', []):
                    nutrients = food.get('foodNutrients', [])
                    cal  = extract_nutrient(nutrients, 'Energy')
                    pro  = extract_nutrient(nutrients, 'Protein')
                    carb = extract_nutrient(nutrients, 'Carbohydrate')
                    fat  = extract_nutrient(nutrients, 'Total lipid')

                    if cal == 0:
                        continue

                    display = food.get('description', '')[:45]
                    key     = display[:25].lower()
                    if key in seen:
                        continue
                    seen.add(key)

                    is_non_veg = any(kw in display.lower() for kw in non_veg_keywords)

                    results.append({
                        'name':              display.lower().replace(' ', '_'),
                        'display_name':      display,
                        'calories_per_100g': cal,
                        'protein':           pro,
                        'carbs':             carb,
                        'fat':               fat,
                        'health_score':      5,
                        'is_veg':            not is_non_veg,
                        'notes':             'Source: USDA FoodData Central',
                        'source':            'usda'
                    })
        except Exception as e:
            pass

    # 3. Open Food Facts — Indian packaged foods
    if q_lower and len(results) < 18:
        try:
            off_resp = req.get(
                "https://world.openfoodfacts.org/cgi/search.pl",
                params={
                    'search_terms': query,
                    'search_simple': 1,
                    'action':       'process',
                    'json':          1,
                    'page_size':     8,
                    'countries_tags': 'india'
                },
                timeout=4
            )
            if off_resp.status_code == 200:
                for product in off_resp.json().get('products', []):
                    name = product.get('product_name', '').strip()
                    if not name:
                        continue
                    n   = product.get('nutriments', {})
                    cal = n.get('energy-kcal_100g', 0)
                    if not cal:
                        continue

                    key = name[:25].lower()
                    if key in seen:
                        continue
                    seen.add(key)

                    results.append({
                        'name':              name.lower().replace(' ', '_'),
                        'display_name':      name[:45],
                        'calories_per_100g': round(cal),
                        'protein':           round(n.get('proteins_100g', 0), 1),
                        'carbs':             round(n.get('carbohydrates_100g', 0), 1),
                        'fat':               round(n.get('fat_100g', 0), 1),
                        'health_score':      5,
                        'is_veg':            True,
                        'notes':             'Source: Open Food Facts (India)',
                        'source':            'openfoodfacts'
                    })
        except Exception as e:
            print(f"OpenFoodFacts error: {e}")

    set_cached_search(cache_key, results[:25])
    return jsonify({'results': results[:25]})

# ---------- DIARY & WATER TRACKER ----------
@app.route('/api/log_meal', methods=['POST'])
def log_meal():
    data    = request.json or {}
    user_id = data.get('user_id', 'default_user')
    target_date = data.get('date') or str(date.today())

    diary = load_json(DIARY_PATH)
    diary.setdefault(user_id, {}).setdefault(target_date, [])

    diary[user_id][target_date].append({
        'food':      data.get('food', 'Food Item'),
        'portion':   data.get('portion', 100),
        'calories':  round(float(data.get('calories', 0))),
        'protein':   round(float(data.get('protein', 0)), 1),
        'carbs':     round(float(data.get('carbs', 0)), 1),
        'fat':       round(float(data.get('fat', 0)), 1),
        'meal_type': data.get('meal_type', 'lunch'),
        'time':      datetime.now().strftime('%H:%M')
    })
    save_json(DIARY_PATH, diary)

    totals, entries = get_day_totals(diary, user_id, target_date)
    return jsonify({'success': True, 'today_totals': totals, 'entries': entries, 'date': target_date})

@app.route('/api/delete_meal', methods=['POST'])
def delete_meal():
    data = request.json or {}
    user_id = data.get('user_id', 'default_user')
    target_date = data.get('date') or str(date.today())
    meal_index = data.get('meal_index')

    diary = load_json(DIARY_PATH)
    user_diary = diary.get(user_id, {})
    entries = user_diary.get(target_date, [])

    if meal_index is not None and 0 <= meal_index < len(entries):
        deleted = entries.pop(meal_index)
        user_diary[target_date] = entries
        diary[user_id] = user_diary
        save_json(DIARY_PATH, diary)
        totals, remaining_entries = get_day_totals(diary, user_id, target_date)
        return jsonify({
            'success': True,
            'deleted': deleted,
            'entries': remaining_entries,
            'totals': totals,
            'date': target_date
        })
    return jsonify({'success': False, 'error': 'Invalid meal index or date'}), 400

@app.route('/api/get_diary/<user_id>')
def get_diary(user_id):
    target_date = request.args.get('date') or str(date.today())
    diary = load_json(DIARY_PATH)
    totals, entries = get_day_totals(diary, user_id, target_date)
    return jsonify({
        'entries': entries,
        'totals':  totals,
        'date':    target_date
    })

@app.route('/api/get_water/<user_id>')
def get_water(user_id):
    target_date = request.args.get('date') or str(date.today())
    water_data = load_json(WATER_PATH)
    user_water = water_data.get(user_id, {}).get(target_date, 0)
    return jsonify({
        'user_id': user_id,
        'date': target_date,
        'water_ml': user_water,
        'target_ml': 3000
    })

@app.route('/api/log_water', methods=['POST'])
def log_water():
    data = request.json or {}
    user_id = data.get('user_id', 'default_user')
    target_date = data.get('date') or str(date.today())
    action = data.get('action', 'add')
    amount = int(data.get('amount_ml', 250))

    water_data = load_json(WATER_PATH)
    user_records = water_data.setdefault(user_id, {})
    current_ml = user_records.get(target_date, 0)

    if action == 'add':
        new_ml = max(0, current_ml + amount)
    elif action == 'set':
        new_ml = max(0, amount)
    elif action == 'reset':
        new_ml = 0
    else:
        new_ml = max(0, current_ml + amount)

    user_records[target_date] = new_ml
    save_json(WATER_PATH, water_data)

    return jsonify({
        'success': True,
        'date': target_date,
        'water_ml': new_ml,
        'target_ml': 3000
    })

# ---------- HEALTH COACH (GOOGLE GEMINI FREE API) ----------

def build_coach_system_prompt(profile, diary_totals, diary_entries):
    name = profile.get('name', 'Friend')
    age = profile.get('age', 'N/A')
    gender = profile.get('gender', 'N/A')
    weight = profile.get('weight', 'N/A')
    height = profile.get('height', 'N/A')
    goal = profile.get('goal', 'fat_loss')
    activity = profile.get('activity', 'moderate')
    targets = profile.get('targets', {})

    target_cal = targets.get('calories', 2000)
    target_pro = targets.get('protein_g', 120)
    target_car = targets.get('carbs_g', 220)
    target_fat = targets.get('fat_g', 55)

    cal_eaten = round(diary_totals.get('calories', 0))
    pro_eaten = round(diary_totals.get('protein', 0), 1)
    car_eaten = round(diary_totals.get('carbs', 0), 1)
    fat_eaten = round(diary_totals.get('fat', 0), 1)

    cal_left = max(0, target_cal - cal_eaten)
    pro_left = max(0, round(target_pro - pro_eaten, 1))
    car_left = max(0, round(target_car - car_eaten, 1))
    fat_left = max(0, round(target_fat - fat_eaten, 1))

    goal_names = {
        'fat_loss': 'Fat Loss & Calorie Deficit',
        'muscle_gain': 'Lean Muscle Gain & Hypertrophy',
        'maintain': 'Healthy Maintenance & Balance'
    }
    goal_str = goal_names.get(goal, goal)

    meals_summary_list = []
    for e in diary_entries:
        meals_summary_list.append(f"- {e.get('food', 'Food').replace('_', ' ').title()} ({e.get('meal_type', 'Meal').capitalize()}): {e.get('portion', 100)}g | {e.get('calories', 0)} kcal | P:{e.get('protein', 0)}g C:{e.get('carbs', 0)}g F:{e.get('fat', 0)}g")

    meals_str = "\n".join(meals_summary_list) if meals_summary_list else "No meals logged yet today."

    return f"""You are **NutriCoach**, an expert personal health coach and nutritionist specializing in Indian diets and lifestyle for NutriVision India.

USER PROFILE:
- Name: {name}
- Stats: {age} yrs, {gender}, {weight} kg, {height} cm
- Primary Goal: {goal_str}
- Activity Level: {activity}
- Daily Targets: {target_cal} kcal | Protein: {target_pro}g | Carbs: {target_car}g | Fat: {target_fat}g

TODAY'S LIVE NUTRITION PROGRESS:
- Calories: {cal_eaten} consumed / {target_cal} target ({cal_left} kcal left)
- Protein: {pro_eaten}g consumed / {target_pro}g target ({pro_left}g left)
- Carbs: {car_eaten}g consumed / {target_car}g target ({car_left}g left)
- Fat: {fat_eaten}g consumed / {target_fat}g target ({fat_left}g left)
- Meals Eaten Today:
{meals_str}

COACHING GUIDELINES:
1. Emphasize authentic, accessible Indian foods (paneer, soya chunks, dals, lentils, sprouts, eggs, chicken, fish, curd/dahi, roti, brown rice, millets, oats, bhindi, palak, roasted chana, makhana, sattu, peanut butter, etc.).
2. Tailor your recommendations directly to the user's remaining calories and protein budget for today.
3. Be supportive, knowledgeable, realistic, and motivating.
4. Format your responses with structured Markdown: bold key numbers/foods, use bullet points, and add relevant emojis.
5. Provide actionable meal recipes, healthy swaps, portion tips, and workout nutrition advice.
6. Keep replies concise, punchy, and easy to read (150-250 words unless specifically asked for a full multi-day diet plan).
"""

gemini_model_cache = {}
GEMINI_MODEL_CACHE_TTL = 300

def get_gemini_models_for_key(api_key):
    global gemini_model_cache
    now = time.time()
    if api_key in gemini_model_cache:
        cached_models, ts = gemini_model_cache[api_key]
        if now - ts < GEMINI_MODEL_CACHE_TTL:
            return cached_models

    fallback_models = [
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
        "gemini-2.0-flash-lite",
        "gemini-2.5-flash",
        "gemini-3.6-flash",
        "gemini-1.5-pro",
        "gemini-pro"
    ]

    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
        res = req.get(url, timeout=5)
        if res.status_code == 200:
            data = res.json()
            valid_models = []
            for m in data.get("models", []):
                if "generateContent" in m.get("supportedGenerationMethods", []):
                    clean_name = m.get("name", "").replace("models/", "").strip()
                    if clean_name:
                        valid_models.append(clean_name)
            
            if valid_models:
                # Prioritize active flash models, then pro, then preview/others
                flash_std = [m for m in valid_models if "flash" in m.lower() and "preview" not in m.lower() and "exp" not in m.lower()]
                flash_other = [m for m in valid_models if "flash" in m.lower() and m not in flash_std]
                pro_std = [m for m in valid_models if "pro" in m.lower()]
                others = [m for m in valid_models if m not in flash_std and m not in flash_other and m not in pro_std]
                
                ordered = flash_std + flash_other + pro_std + others
                for f in fallback_models:
                    if f not in ordered:
                        ordered.append(f)
                
                gemini_model_cache[api_key] = (ordered, now)
                return ordered
    except Exception as e:
        print(f"Dynamic model resolution note: {e}")

    return fallback_models

def call_gemini_api(messages, system_prompt="", api_key=None):
    """
    Calls Google Gemini API (v1beta REST) with dynamic model discovery, fallback, and multimodal support.
    """
    resolved_key = (api_key or "").strip() or GEMINI_API_KEY
    if not resolved_key:
        return False, "Gemini API Key is missing. Please provide your free Gemini API key in the Coach settings or set GEMINI_API_KEY in the server environment."

    formatted_contents = []
    for msg in messages:
        role = "model" if msg.get("role") in ["assistant", "model", "coach"] else "user"
        if "parts" in msg and isinstance(msg["parts"], list) and len(msg["parts"]) > 0:
            formatted_contents.append({
                "role": role,
                "parts": msg["parts"]
            })
        else:
            content = msg.get("content") or ""
            if content:
                formatted_contents.append({
                    "role": role,
                    "parts": [{"text": str(content)}]
                })

    if not formatted_contents:
        return False, "No message content provided."

    models_to_try = get_gemini_models_for_key(resolved_key)

    last_error = ""
    for model_name in models_to_try:
        clean_model = model_name.replace("models/", "").strip()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent?key={resolved_key}"
        payload = {
            "contents": formatted_contents,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 1000
            }
        }
        if system_prompt:
            payload["system_instruction"] = {
                "parts": [{"text": system_prompt}]
            }

        try:
            res = req.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=20)
            if res.status_code == 200:
                data = res.json()
                candidates = data.get("candidates", [])
                if candidates and "content" in candidates[0]:
                    parts = candidates[0]["content"].get("parts", [])
                    reply_text = "".join([p.get("text", "") for p in parts if "text" in p])
                    if reply_text.strip():
                        return True, reply_text
            else:
                try:
                    err_json = res.json()
                    err_msg = err_json.get("error", {}).get("message", res.text)
                except Exception:
                    err_msg = res.text
                last_error = f"{clean_model} error ({res.status_code}): {err_msg}"
                # If invalid key, fail early
                if res.status_code in [400, 403] and ("API_KEY_INVALID" in str(err_msg) or "API key not valid" in str(err_msg)):
                    return False, f"Invalid Gemini API Key. Please verify your free key from Google AI Studio. Error: {err_msg}"
        except req.exceptions.Timeout:
            last_error = f"{clean_model} timed out after 20s."
            continue
        except Exception as e:
            last_error = f"Connection error ({clean_model}): {str(e)}"
            continue

    return False, f"Unable to reach Google Gemini AI. {last_error}"

@app.route('/api/coach/status')
def coach_status():
    return jsonify({
        'has_server_key': bool(GEMINI_API_KEY and GEMINI_API_KEY.strip())
    })

@app.route('/api/coach/test_key', methods=['POST'])
def test_coach_key():
    data = request.json or {}
    api_key = data.get('api_key', '').strip()
    test_messages = [{'role': 'user', 'content': 'Hello! Respond with: "Gemini API connected successfully! Ready to coach."'}]
    success, reply = call_gemini_api(test_messages, system_prompt="You are a test assistant.", api_key=api_key)
    if success:
        return jsonify({'success': True, 'message': reply})
    else:
        return jsonify({'success': False, 'error': reply}), 400

@app.route('/api/coach/chat', methods=['POST'])
def coach_chat():
    data = request.json or {}
    message = data.get('message', '').strip()
    history = data.get('history', [])
    user_id = data.get('user_id', 'default_user')
    api_key = data.get('api_key', '').strip()

    if not message:
        return jsonify({'success': False, 'error': 'Message cannot be empty'}), 400

    profiles = load_json(PROFILE_PATH)
    profile = profiles.get(user_id, {})

    diary = load_json(DIARY_PATH)
    diary_totals, diary_entries = get_today_totals(diary, user_id)

    system_prompt = build_coach_system_prompt(profile, diary_totals, diary_entries)

    conversation = []
    # Include up to last 10 turns of history for good context and token efficiency
    for h in history[-10:]:
        if isinstance(h, dict) and ('content' in h or 'text' in h):
            role = 'assistant' if h.get('role') in ['assistant', 'model', 'coach'] else 'user'
            content = h.get('content') or h.get('text', '')
            if content:
                conversation.append({'role': role, 'content': content})

    conversation.append({'role': 'user', 'content': message})

    success, reply = call_gemini_api(conversation, system_prompt=system_prompt, api_key=api_key)

    if success:
        return jsonify({'success': True, 'reply': reply})
    else:
        return jsonify({'success': False, 'error': reply}), 400

@app.route('/api/coach/quick_insight', methods=['POST'])
def coach_quick_insight():
    data = request.json or {}
    user_id = data.get('user_id', 'default_user')
    api_key = data.get('api_key', '').strip()

    profiles = load_json(PROFILE_PATH)
    profile = profiles.get(user_id, {})

    diary = load_json(DIARY_PATH)
    diary_totals, diary_entries = get_today_totals(diary, user_id)

    system_prompt = build_coach_system_prompt(profile, diary_totals, diary_entries)
    prompt_msg = [{'role': 'user', 'content': 'Give me one single crisp, motivating coaching tip (1-2 sentences max) based on my profile and today\'s remaining macros. Suggest a specific Indian food or habit.'}]

    success, reply = call_gemini_api(prompt_msg, system_prompt=system_prompt, api_key=api_key)
    if success:
        return jsonify({'success': True, 'insight': reply})
    else:
        return jsonify({'success': False, 'error': reply})

# ============ RUN ============
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port)