# pyrefly: ignore [missing-import]
import torch
import torch.nn as nn
import torchvision.transforms as transforms
from torchvision import models
from PIL import Image
import timm, os
import hashlib
import functools
from concurrent.futures import ThreadPoolExecutor, as_completed

# ─── Device Selection (GPU → MPS → CPU) ──────────────────────────────────────
def _get_device():
    if torch.cuda.is_available():
        dev = torch.device('cuda')
        print(f"[DEVICE] Using GPU: {torch.cuda.get_device_name(0)}")
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        dev = torch.device('mps')
        print("[DEVICE] Using Apple MPS")
    else:
        dev = torch.device('cpu')
        print("[DEVICE] Using CPU")
    return dev

DEVICE = _get_device()

# ─── Model weights for weighted ensemble ─────────────────────────────────────
# EfficientNet-B2 typically outperforms MobileNetV3 and ResNet50 on food tasks
MODEL_WEIGHTS = {
    'efficientnet_b2': 0.50,
    'mobilenetv3':     0.25,
    'resnet50':        0.25,
}

def load_all_models(models_dir):
    configs = [
        ('model1_efficientnet.pth', 'efficientnet_b2'),
        ('model2_mobilenetv3.pth',  'mobilenetv3'),
        ('model3_resnet50.pth',     'resnet50'),
    ]
    loaded = []          # list of (model, arch, weight)
    class_names = None

    for filename, arch in configs:
        path = os.path.join(models_dir, filename)
        if not os.path.exists(path):
            print(f"Warning: {filename} not found - skipping")
            continue

        try:
            try:
                ckpt = torch.load(path, map_location=DEVICE, weights_only=False)
            except TypeError:
                ckpt = torch.load(path, map_location=DEVICE)

            if not class_names and 'class_names' in ckpt:
                class_names = ckpt['class_names']

            n = len(class_names) if class_names else len(ckpt.get('class_names', []))

            if arch == 'efficientnet_b2':
                m = timm.create_model('efficientnet_b2', pretrained=False, num_classes=n)
            elif arch == 'mobilenetv3':
                m = models.mobilenet_v3_large(weights=None)
                m.classifier[3] = nn.Linear(1280, n)
            elif arch == 'resnet50':
                m = models.resnet50(weights=None)
                m.fc = nn.Linear(2048, n)
            else:
                continue

            m.load_state_dict(ckpt['model_state'])
            m.to(DEVICE)
            m.eval()
            # Run in eager mode (torch.compile requires MSVC on Windows, skip globally)

            weight = MODEL_WEIGHTS.get(arch, 1.0 / 3)
            loaded.append((m, arch, weight))
            print(f"[OK] Loaded: {filename} ({arch}) on {DEVICE}")
        except Exception as e:
            print(f"[FAIL] Failed to load {filename}: {e}")

    print(f"Total models loaded: {len(loaded)}")
    return loaded, class_names


# ─── TTA Transforms (6 diversified augmentations) ────────────────────────────
_NORM = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])

TTA_TRANSFORMS = [
    # 1. Standard 224 resize
    transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor(), _NORM]),
    # 2. Center crop from 256
    transforms.Compose([transforms.Resize((256, 256)), transforms.CenterCrop(224), transforms.ToTensor(), _NORM]),
    # 3. Horizontal flip
    transforms.Compose([transforms.Resize((224, 224)), transforms.RandomHorizontalFlip(p=1.0), transforms.ToTensor(), _NORM]),
    # 4. Larger crop (captures more context)
    transforms.Compose([transforms.Resize((288, 288)), transforms.CenterCrop(224), transforms.ToTensor(), _NORM]),
    # 5. Brightness / contrast shift
    transforms.Compose([transforms.Resize((224, 224)), transforms.ColorJitter(brightness=0.2, contrast=0.2), transforms.ToTensor(), _NORM]),
    # 6. Random crop from 256 (adds spatial diversity)
    transforms.Compose([transforms.Resize((256, 256)), transforms.RandomCrop(224), transforms.ToTensor(), _NORM]),
]

# ─── Image result cache (sha1-hash → predictions list) ───────────────────────
_pred_cache: dict = {}
_CACHE_MAXSIZE = 64

def _image_hash(image_path: str) -> str:
    """SHA-1 of file content — reliable even if filename changes."""
    h = hashlib.sha1()
    with open(image_path, 'rb') as f:
        for chunk in iter(functools.partial(f.read, 65536), b''):
            h.update(chunk)
    return h.hexdigest()


def _run_single_model(model_tuple, tta_tensors):
    """Run one model over all pre-computed TTA tensors, return weighted probs."""
    model, arch, weight = model_tuple
    probs_list = []
    with torch.no_grad():
        for tensor in tta_tensors:
            out = model(tensor)
            probs_list.append(torch.softmax(out, dim=1))
    if not probs_list:
        raise RuntimeError(f"All TTA inferences failed for {arch}")
    avg_probs = torch.stack(probs_list).mean(0)
    return avg_probs * weight


def ensemble_predict(image_path, models_list, class_names, top_k=3):
    """
    Weighted ensemble inference with:
    - SHA-1 image cache (skip re-inference for identical images)
    - Parallel model execution via ThreadPoolExecutor
    - GPU/MPS-accelerated if available
    - 6-transform TTA tensors computed once and shared across models
    """
    # ── Cache hit: return immediately ──
    img_hash = _image_hash(image_path)
    if img_hash in _pred_cache:
        return _pred_cache[img_hash][:top_k]

    img = Image.open(image_path).convert('RGB')

    # Pre-compute all TTA tensors ONCE (shared across all models)
    tta_tensors = [tf(img).unsqueeze(0).to(DEVICE) for tf in TTA_TRANSFORMS]

    # ── Parallel inference ──
    weighted_probs = []
    if len(models_list) > 1:
        with ThreadPoolExecutor(max_workers=len(models_list)) as executor:
            futures = {
                executor.submit(_run_single_model, m, tta_tensors): m
                for m in models_list
            }
            for future in as_completed(futures):
                try:
                    weighted_probs.append(future.result())
                except Exception as e:
                    print(f"[WARN] Model inference failed: {e}")
    else:
        for m in models_list:
            weighted_probs.append(_run_single_model(m, tta_tensors))

    if not weighted_probs:
        return [{'food': 'unknown', 'confidence': '0%', 'source': 'pytorch'}]

    # Normalise by total weight so probabilities sum correctly
    total_weight = sum(m[2] for m in models_list)
    avg = torch.stack(weighted_probs).sum(0) / total_weight
    top_p, top_i = avg.topk(min(top_k * 2, len(class_names)))

    results = [
        {
            'food':       class_names[top_i[0][i]],
            'confidence': f'{top_p[0][i] * 100:.1f}%',
            'source':     'pytorch'
        }
        for i in range(min(top_k * 2, top_i.shape[1]))
    ]

    # ── Write cache, evict oldest if full ──
    if len(_pred_cache) >= _CACHE_MAXSIZE:
        del _pred_cache[next(iter(_pred_cache))]
    _pred_cache[img_hash] = results

    return results[:top_k]