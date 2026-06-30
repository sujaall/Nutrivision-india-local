from flask import Flask, render_template, request, jsonify
from ensemble_predict import load_all_models, ensemble_predict
from tdee import calculate_tdee, calculate_targets
from werkzeug.utils import secure_filename
import json, os, requests as req
import time

search_cache = {}
CACHE_DURATION = 300

def get_cached_search(query):
    if query in search_cache:
        result, timestamp = search_cache[query]
        if time.time() - timestamp < CACHE_DURATION:
            return result
    return None

def set_cached_search(query, results):
    search_cache[query] = (results, time.time())
from datetime import datetime, date

# ============ CONFIG ============
USDA_API_KEY = "GGEnPm3hmMjnPmtnLtMF6st8W05L7X4IkMDohzoQ"

app = Flask(__name__,
    template_folder='../templates',
    static_folder='../static')
app.secret_key = 'nutrivision2025secretkey'

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads')
DIARY_PATH    = os.path.join(BASE_DIR, 'data', 'food_diary.json')
PROFILE_PATH  = os.path.join(BASE_DIR, 'data', 'user_profiles.json')
DATA_PATH     = os.path.join(BASE_DIR, 'data', 'indian_nutrition.json')
MODEL_PATH    = os.path.join(BASE_DIR, 'models', 'nutrivision_model.pth')

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ============ LOAD MODEL & DATA ============
print("Loading ensemble models...")
MODELS_DIR = os.path.join(BASE_DIR, 'models')
models_list, class_names = load_all_models(MODELS_DIR)
print(f"Ready! {len(models_list)} models loaded")
with open(DATA_PATH) as f:
    nutrition_db = json.load(f)
print(f"Nutrition DB loaded: {len(nutrition_db)} foods")

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

def get_today_totals(diary, user_id):
    today = str(date.today())
    entries = diary.get(user_id, {}).get(today, [])
    totals = {'calories': 0, 'protein': 0, 'carbs': 0, 'fat': 0}
    for e in entries:
        totals['calories'] += e.get('calories', 0)
        totals['protein']  += e.get('protein', 0)
        totals['carbs']    += e.get('carbs', 0)
        totals['fat']      += e.get('fat', 0)
    return totals, entries

# ============ ROUTES ============

@app.route('/')
def index():
    return render_template('index.html')
@app.route('/ping')
def ping():
    return jsonify({'status': 'alive'})

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

    predictions = ensemble_predict(
    filepath, models_list, class_names)
    top_food    = predictions[0]['food']
    nutrition   = nutrition_db.get(top_food, {
        'calories_per_100g': 200,
        'protein': 5, 'carbs': 25, 'fat': 5,
        'health_score': 5,
        'notes': 'Nutrition data coming soon.'
    })

    return jsonify({
        'predictions': predictions,
        'nutrition':   nutrition,
        'food_name':   top_food
    })

# ---------- FOOD SEARCH (LOCAL + USDA + OPEN FOOD FACTS) ----------
@app.route('/api/search_food')
def search_food():
    query = request.args.get('q', '').strip()
    if len(query) < 2:
        return jsonify({'results': []})
    cached = get_cached_search(query.lower())
    if cached is not None:
        return jsonify({'results': cached})

    q_lower = query.lower()
    results = []
    seen    = set()

    # 1. LOCAL Indian database — highest priority
    for food_key, nutrition in nutrition_db.items():
        if q_lower in food_key.lower().replace('_', ' '):
            key = food_key[:25]
            if key not in seen:
                seen.add(key)
                results.append({
                    'name':             food_key,
                    'display_name':     food_key.replace('_', ' ').title(),
                    'calories_per_100g': nutrition.get('calories_per_100g', 0),
                    'protein':          nutrition.get('protein', 0),
                    'carbs':            nutrition.get('carbs', 0),
                    'fat':              nutrition.get('fat', 0),
                    'health_score':     nutrition.get('health_score', 5),
                    'notes':            nutrition.get('notes', ''),
                    'source':           'local'
                })

    # 2. USDA FoodData Central — 500,000+ foods
    try:
        usda_resp = req.get(
            "https://api.nal.usda.gov/fdc/v1/foods/search",
            params={
                'api_key':  USDA_API_KEY,
                'query':    query,
                'pageSize': 20,
                'dataType': 'Foundation,SR Legacy,Survey (FNDDS),Branded'
            },
            timeout=5
        )
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

            results.append({
                'name':              display.lower().replace(' ', '_'),
                'display_name':      display,
                'calories_per_100g': cal,
                'protein':           pro,
                'carbs':             carb,
                'fat':               fat,
                'health_score':      5,
                'notes':             'Source: USDA FoodData Central',
                'source':            'usda'
            })
    except Exception as e:
        print(f"USDA error: {e}")

    # 3. Open Food Facts — Indian packaged foods
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
            timeout=5
        )
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
                'notes':             'Source: Open Food Facts (India)',
                'source':            'openfoodfacts'
            })
    except Exception as e:
        print(f"OpenFoodFacts error: {e}")

    set_cached_search(query.lower(), results[:20])
    return jsonify({'results': results[:20]})

# ---------- DIARY ----------
@app.route('/api/log_meal', methods=['POST'])
def log_meal():
    data    = request.json
    user_id = data.get('user_id', 'default_user')
    today   = str(date.today())

    diary = load_json(DIARY_PATH)
    diary.setdefault(user_id, {}).setdefault(today, [])

    diary[user_id][today].append({
        'food':      data['food'],
        'portion':   data['portion'],
        'calories':  data['calories'],
        'protein':   data['protein'],
        'carbs':     data['carbs'],
        'fat':       data['fat'],
        'meal_type': data['meal_type'],
        'time':      datetime.now().strftime('%H:%M')
    })
    save_json(DIARY_PATH, diary)

    totals, _ = get_today_totals(diary, user_id)
    return jsonify({'success': True, 'today_totals': totals})

@app.route('/api/get_diary/<user_id>')
def get_diary(user_id):
    diary          = load_json(DIARY_PATH)
    totals, entries = get_today_totals(diary, user_id)
    return jsonify({
        'entries': entries,
        'totals':  totals,
        'date':    str(date.today())
    })

# ============ RUN ============
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    app.run(host='0.0.0.0', port=port)