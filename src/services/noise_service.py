"""
Noise Pattern Analysis Service
-------------------------------
DIP Concepts: Spatial filtering (high-pass), variance calculation,
statistical comparison.

Extracts the noise residual (image minus its Gaussian-blurred version),
computes local variance across a grid, and flags regions whose noise
characteristics deviate significantly from the image-wide average.
"""

import io
import cv2
import numpy as np
from PIL import Image


def run_noise_analysis(image_bytes: bytes, grid_size: int = 32) -> dict:
    """
    Analyse noise patterns across the image.

    Returns
    -------
    dict with keys:
        - visualization : numpy array (BGR) noise inconsistency heatmap
        - confidence    : float 0-1
        - findings      : list[str]
    """
    # --- 1. Decode image ---
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_rgb = np.array(original)
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    h, w = gray.shape

    # --- 2. High-pass filter: noise residual ---
    blurred = cv2.GaussianBlur(gray, (5, 5), sigmaX=1.5)
    noise_residual = gray - blurred

    # --- 3. Compute local variance across grid ---
    rows = h // grid_size
    cols = w // grid_size
    variance_map = np.zeros((rows, cols), dtype=np.float32)

    for r in range(rows):
        for c in range(cols):
            block = noise_residual[
                r * grid_size:(r + 1) * grid_size,
                c * grid_size:(c + 1) * grid_size
            ]
            variance_map[r, c] = np.var(block)

    # --- 4. Flag abnormal regions ---
    global_mean_var = float(np.mean(variance_map))
    global_std_var = float(np.std(variance_map))

    if global_std_var < 1e-5:
        # Perfectly uniform noise — unlikely to be forged
        abnormal_mask = np.zeros_like(variance_map, dtype=np.uint8)
        anomaly_count = 0
    else:
        z_scores = np.abs((variance_map - global_mean_var) / (global_std_var + 1e-5))
        abnormal_mask = (z_scores > 2.0).astype(np.uint8) * 255
        anomaly_count = int(np.sum(z_scores > 2.0))

    # --- 5. Build visualisation ---
    # Normalise variance map to 0-255
    v_min, v_max = variance_map.min(), variance_map.max()
    if v_max - v_min > 1e-5:
        norm_var = ((variance_map - v_min) / (v_max - v_min) * 255).astype(np.uint8)
    else:
        norm_var = np.zeros_like(variance_map, dtype=np.uint8)

    # Up-scale to image size
    norm_var_full = cv2.resize(norm_var, (w, h), interpolation=cv2.INTER_NEAREST)
    heatmap = cv2.applyColorMap(norm_var_full, cv2.COLORMAP_JET)

    # Blend with original
    vis = cv2.addWeighted(img_bgr, 0.5, heatmap, 0.5, 0)

    # --- 6. Confidence ---
    total_blocks = rows * cols
    anomaly_ratio = anomaly_count / max(total_blocks, 1)
    confidence = min(1.0, anomaly_ratio * 3)
    confidence = round(confidence, 2)

    # --- 7. Findings ---
    findings: list[str] = []
    findings.append(f"Global noise variance: {global_mean_var:.2f} (σ = {global_std_var:.2f}).")

    if anomaly_count > 5:
        findings.append(f"{anomaly_count} regions show abnormal noise levels — possible tampering.")
    elif anomaly_count > 0:
        findings.append(f"{anomaly_count} region(s) with unusual noise detected.")
    else:
        findings.append("Noise pattern appears consistent across the image.")

    return {
        "visualization": vis,
        "confidence": confidence,
        "findings": findings,
    }
