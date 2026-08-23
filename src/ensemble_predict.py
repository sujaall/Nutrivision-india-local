import torch
import torch.nn as nn
import torchvision.transforms as transforms
from torchvision import models
from PIL import Image
import timm, os

def load_all_models(models_dir):
    configs = [
        ('model1_efficientnet.pth', 'efficientnet_b2'),
        ('model2_mobilenetv3.pth', 'mobilenetv3'),
        ('model3_resnet50.pth', 'resnet50'),
    ]

    loaded = []
    class_names = None

    for filename, arch in configs:
        path = os.path.join(models_dir, filename)
        if not os.path.exists(path):
            print(f"Not found: {filename} — skipping")
            continue

        try:
            try:
                ckpt = torch.load(path, map_location="cpu", weights_only=False)
            except TypeError:
                ckpt = torch.load(path, map_location="cpu")
            
            if not class_names and "class_names" in ckpt:
                class_names = ckpt["class_names"]
            
            n = len(class_names) if class_names else len(ckpt.get("class_names", []))

            if arch == "efficientnet_b2":
                m = timm.create_model(
                    "efficientnet_b2",
                    pretrained=False,
                    num_classes=n
                )
            elif arch == "mobilenetv3":
                m = models.mobilenet_v3_large(weights=None)
                m.classifier[3] = nn.Linear(1280, n)
            elif arch == "resnet50":
                m = models.resnet50(weights=None)
                m.fc = nn.Linear(m.fc.in_features, n)
            else:
                continue

            m.load_state_dict(ckpt["model_state"])
            m.eval()
            loaded.append(m)
            print(f"Loaded: {filename} ({arch})")
        except Exception as e:
            print(f"Warning: Failed loading {filename}: {e}")

    print(f"Total ensemble models loaded: {len(loaded)}")
    return loaded, class_names

# Test Time Augmentation — 3 transforms per model
TTA_TRANSFORMS = [
    transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(
            [0.485,0.456,0.406],
            [0.229,0.224,0.225])
    ]),
    transforms.Compose([
        transforms.Resize((256, 256)),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(
            [0.485,0.456,0.406],
            [0.229,0.224,0.225])
    ]),
    transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(p=1.0),
        transforms.ToTensor(),
        transforms.Normalize(
            [0.485,0.456,0.406],
            [0.229,0.224,0.225])
    ]),
]

def ensemble_predict(image_path, models_list,
                     class_names, top_k=3):
    img       = Image.open(image_path).convert('RGB')
    all_probs = []

    with torch.no_grad():
        for model in models_list:
            for tf in TTA_TRANSFORMS:
                tensor = tf(img).unsqueeze(0)
                out    = model(tensor)
                probs  = torch.softmax(out, dim=1)
                all_probs.append(probs)

    # Average ALL 9 predictions (3 models x 3 transforms)
    avg          = torch.stack(all_probs).mean(0)
    top_p, top_i = avg.topk(top_k)

    return [
        {
            'food':       class_names[top_i[0][i]],
            'confidence': f'{top_p[0][i]*100:.1f}%'
        }
        for i in range(top_k)
    ]