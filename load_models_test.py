"""
Quick script to activate / verify all 3 ensemble models in the terminal.
Run from the project root:  python load_models_test.py
"""
import sys, os

# Make sure src/ is on the path
SRC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src')
sys.path.insert(0, SRC_DIR)

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')

print("=" * 60)
print("  NutriVision - Ensemble Model Activation Test")
print("=" * 60)
print(f"\nModels directory : {MODELS_DIR}")
print(f"Python           : {sys.version}\n")

from ensemble_predict import load_all_models

print("Loading all 3 models...\n")
models_list, class_names = load_all_models(MODELS_DIR)

print()
print("=" * 60)
if len(models_list) == 3:
    print(f"  ALL 3 MODELS LOADED SUCCESSFULLY!")
elif len(models_list) > 0:
    print(f"  {len(models_list)}/3 models loaded (check warnings above)")
else:
    print(f"  NO MODELS LOADED - check that .pth files exist in models/")

print(f"\n  Classes : {len(class_names) if class_names else 'N/A'}")
if class_names:
    sample = class_names[:10]
    print(f"  Sample  : {sample}")

print()
print("  Model breakdown:")
model_names = [
    "EfficientNet-B2   (model1_efficientnet.pth)",
    "MobileNetV3-Large (model2_mobilenetv3.pth)",
    "ResNet-50         (model3_resnet50.pth)",
]
for i, name in enumerate(model_names):
    status = "ACTIVE" if i < len(models_list) else "MISSING"
    print(f"    [{i+1}] {name}  ->  {status}")

print()
print("  Ensemble config : 3 models x 5 TTA transforms = 15 predictions")
print("=" * 60)
