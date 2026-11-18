"""
Lighting & Shadow Consistency Analysis
--------------------------------------
Pipeline: preprocess (copy only) -> object/region detection -> per-region light
direction (shading gradients) -> shadow detection + orientation -> consistency
checks -> documented 0-1 score.

Score (documented):
  light_score  = weighted fraction of reliable regions whose light direction deviates
                 >60 deg from the consensus, scaled so 50% outliers = 1.0
  shadow_score = fraction of elongated shadows whose axis deviates >35 deg from the
                 shadow consensus axis, scaled so 50% = 1.0
  cross_score  = fraction of shadows whose axis deviates >45 deg from the light axis
                 estimated from shading
  score = 0.4*light + 0.3*shadow + 0.3*cross   (if shadows are available)
        = 0.6*light                            (shading evidence only, capped)
Brightness alone is never used: only gradient DIRECTIONS and shadow ORIENTATIONS.
Inconclusive if < 3 reliable regions AND < 2 elongated shadows.
"""

import io
import cv2
import numpy as np
from PIL import Image

from pathlib import Path
_MODEL_PATH = Path(__file__).resolve().parent.parent / "yolov8n.pt"  # src/yolov8n.pt

_YOLO = None
_YOLO_TRIED = False


def _get_yolo():
    """Lazy-load YOLOv8n (optional). Falls back to grid regions if unavailable."""
    global _YOLO, _YOLO_TRIED
    if not _YOLO_TRIED:
        _YOLO_TRIED = True
        try:
            from ultralytics import YOLO
            _YOLO = YOLO(str(_MODEL_PATH))
        except Exception:
            _YOLO = None
    return _YOLO


def _axis_diff(a, b):  # undirected angles (mod 180)
    return abs((a - b + 90) % 180 - 90)


def _dir_diff(a, b):  # directed angles (mod 360)
    return abs((a - b + 180) % 360 - 180)


def _detect_regions(bgr):
    """Return list of (x, y, w, h, label). YOLO boxes if available, else 3x3 grid."""
    h, w = bgr.shape[:2]
    regions = []
    model = _get_yolo()
    if model is not None:
        try:
            res = model(bgr, verbose=False, conf=0.4)[0]
            for b in res.boxes:
                x1, y1, x2, y2 = map(int, b.xyxy[0].tolist())
                if (x2 - x1) * (y2 - y1) > 0.004 * h * w:
                    regions.append((x1, y1, x2 - x1, y2 - y1, res.names[int(b.cls[0])]))
            regions = sorted(regions, key=lambda r: -r[2] * r[3])[:8]
        except Exception:
            regions = []
    if len(regions) < 3:  # fallback: grid regions
        regions = []
        for gy in range(3):
            for gx in range(3):
                regions.append((gx * w // 3, gy * h // 3, w // 3, h // 3, "region"))
    return regions


def _light_direction(gx, gy, box):
    """Mean shading-gradient direction (deg, y-up), coherence, mean magnitude."""
    x, y, w, h, _ = box
    sx, sy = gx[y:y + h, x:x + w], gy[y:y + h, x:x + w]
    mag = np.hypot(sx, sy)
    total = mag.sum() + 1e-8
    mx, my = sx.sum(), sy.sum()
    coherence = np.hypot(mx, my) / total
    angle = np.degrees(np.arctan2(-my, mx)) % 360
    return angle, float(coherence), float(mag.mean())


def _detect_shadows(L, min_area_frac=0.001, max_area_frac=0.25):
    """Dark regions relative to local surroundings -> elongated shadow candidates."""
    Lf = L.astype(np.float32)
    local = cv2.GaussianBlur(Lf, (0, 0), 25)
    mask = ((Lf < local * 0.65) & (Lf < 120)).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)

    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    area_total = L.shape[0] * L.shape[1]
    shadows = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if not (min_area_frac * area_total < area < max_area_frac * area_total):
            continue
        comp = (labels == i).astype(np.uint8)
        m = cv2.moments(comp, binaryImage=True)
        mu20, mu02, mu11 = m["mu20"] / m["m00"], m["mu02"] / m["m00"], m["mu11"] / m["m00"]
        common = np.sqrt(4 * mu11 ** 2 + (mu20 - mu02) ** 2)
        l1, l2 = (mu20 + mu02 + common) / 2, (mu20 + mu02 - common) / 2
        elong = np.sqrt(l1 / (l2 + 1e-8))
        if elong < 1.8:  # round blobs have no reliable direction
            continue
        theta = 0.5 * np.arctan2(2 * mu11, mu20 - mu02)
        axis = (-np.degrees(theta)) % 180  # y-up
        shadows.append({"axis": float(axis), "elong": float(elong), "area": int(area),
                        "bbox": tuple(int(stats[i, j]) for j in range(4)), "label": i})
    return shadows, labels


def run_lighting_shadow(image_bytes: bytes) -> dict:
    # --- 1. Preprocess (works on a copy; original bytes are never modified) ---
    img = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    orig_bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    H, W = orig_bgr.shape[:2]
    scale = min(1.0, 800 / max(H, W))
    bgr = cv2.resize(orig_bgr, None, fx=scale, fy=scale) if scale != 1.0 else orig_bgr.copy()
    L = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[:, :, 0]

    # --- 2. Regions of interest ---
    regions = _detect_regions(bgr)

    # --- 3. Lighting: low-frequency shading gradients per region ---
    Ls = cv2.GaussianBlur(L.astype(np.float32), (0, 0), 7)
    gx, gy = cv2.Sobel(Ls, cv2.CV_32F, 1, 0, ksize=5), cv2.Sobel(Ls, cv2.CV_32F, 0, 1, ksize=5)
    est = []
    for box in regions:
        ang, coh, mag = _light_direction(gx, gy, box)
        est.append({"box": box, "angle": ang, "coh": coh, "mag": mag,
                    "reliable": coh > 0.35 and mag > 0.5})
    reliable = [e for e in est if e["reliable"]]

    light_score, light_axis, flagged = None, None, []
    if len(reliable) >= 3:
        wts = np.array([e["coh"] * e["mag"] for e in reliable])
        ang = np.radians([e["angle"] for e in reliable])
        mean_ang = np.degrees(np.arctan2((wts * np.sin(ang)).sum(), (wts * np.cos(ang)).sum())) % 360
        light_axis = mean_ang % 180
        bad = 0.0
        for e, wt in zip(reliable, wts):
            if _dir_diff(e["angle"], mean_ang) > 60:
                e["outlier"] = True
                flagged.append(e)
                bad += wt
        light_score = min(1.0, (bad / wts.sum()) / 0.5)

    # --- 4. Shadows ---
    shadows, labels = _detect_shadows(L)
    shadow_score, cross_score, bad_shadows = None, None, []
    if len(shadows) >= 2:
        ax = np.radians([s["axis"] * 2 for s in shadows])
        wts = np.array([np.sqrt(s["area"]) for s in shadows])
        cons = (np.degrees(np.arctan2((wts * np.sin(ax)).sum(), (wts * np.cos(ax)).sum())) / 2) % 180
        out = [s for s in shadows if _axis_diff(s["axis"], cons) > 35]
        shadow_score = min(1.0, (len(out) / len(shadows)) / 0.5)
        bad_shadows = out
    if shadows and light_axis is not None:
        mism = [s for s in shadows if _axis_diff(s["axis"], light_axis) > 45]
        cross_score = len(mism) / len(shadows)
        for s in mism:
            if s not in bad_shadows:
                bad_shadows.append(s)

    # --- 5. Inconclusive check ---
    if len(reliable) < 3 and len(shadows) < 2:
        return {"visualization": orig_bgr, "confidence": None, "inconclusive": True,
                "findings": ["Inconclusive: not enough reliable lighting regions or "
                             "elongated shadows to assess lighting consistency."]}

    # --- 6. Score ---
    if shadow_score is not None:
        score = 0.4 * (light_score or 0) + 0.3 * shadow_score + 0.3 * (cross_score or 0)
    else:
        score = 0.6 * (light_score or 0)
    score = round(float(min(1.0, score)), 2)

    # --- 7. Visualisation (drawn at analysis scale, then resized back) ---
    vis = bgr.copy()
    for e in est:
        if not e["reliable"]:
            continue
        x, y, w, h, _ = e["box"]
        c = (0, 0, 255) if e.get("outlier") else (0, 200, 0)
        cx, cy = x + w // 2, y + h // 2
        r = np.radians(e["angle"])
        cv2.rectangle(vis, (x, y), (x + w, y + h), c, 1)
        cv2.arrowedLine(vis, (cx, cy), (int(cx + 40 * np.cos(r)), int(cy - 40 * np.sin(r))), c, 2)
    for s in shadows:
        c = (0, 0, 255) if s in bad_shadows else (255, 160, 0)
        cnts, _ = cv2.findContours((labels == s["label"]).astype(np.uint8),
                                   cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(vis, cnts, -1, c, 2)
    if scale != 1.0:
        vis = cv2.resize(vis, (W, H))

    # --- 8. Findings ---
    f = [f"Analysed {len(reliable)} reliable lighting region(s) and {len(shadows)} elongated shadow(s)."]
    if flagged:
        f.append(f"{len(flagged)} region(s) show light direction deviating >60° from the dominant direction.")
    if shadow_score is not None and shadow_score > 0:
        f.append("Some shadows point in directions inconsistent with the other shadows.")
    if cross_score:
        f.append(f"{cross_score * 100:.0f}% of shadows disagree with the light direction estimated from shading.")
    if score < 0.3:
        f.append("Lighting and shadows appear broadly consistent.")
    elif score < 0.6:
        f.append("Moderate inconsistencies found; may be multiple light sources or manipulation.")
    else:
        f.append("Strong lighting/shadow inconsistencies; possible compositing.")
    f.append(f"Scores — lighting: {light_score}, shadows: {shadow_score}, cross-check: {cross_score}.")

    return {"visualization": vis, "confidence": score, "inconclusive": False, "findings": f}