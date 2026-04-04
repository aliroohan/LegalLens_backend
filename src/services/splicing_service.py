"""
Image Splicing Detection Service
---------------------------------
DIP Concepts: Edge detection (Canny), colour space conversion
(RGB → HSV), gradient magnitude analysis.

Detects regions where parts from different images may have been
combined by analysing edge discontinuities, colour inconsistencies,
and gradient magnitude variations.
"""

import io
import cv2
import numpy as np
from PIL import Image


def run_splicing_detection(image_bytes: bytes) -> dict:
    """
    Detect potential image splicing (composite) regions.

    Returns
    -------
    dict with keys:
        - visualization : numpy array (BGR) splicing detection map
        - confidence    : float 0-1
        - findings      : list[str]
    """
    # --- 1. Decode image ---
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_rgb = np.array(original)
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    h, w = gray.shape

    # --- 2. Edge detection (Canny) ---
    edges = cv2.Canny(gray, 50, 150)

    # Dilate edges to connect nearby edge segments
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges_dilated = cv2.dilate(edges, kernel, iterations=1)

    # --- 3. HSV colour consistency analysis ---
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    h_channel = hsv[:, :, 0]
    s_channel = hsv[:, :, 1]

    # Compute local colour statistics in grid blocks
    block_size = 32
    rows = h // block_size
    cols = w // block_size

    hue_var_map = np.zeros((rows, cols), dtype=np.float32)
    sat_var_map = np.zeros((rows, cols), dtype=np.float32)

    for r in range(rows):
        for c in range(cols):
            h_block = h_channel[r * block_size:(r + 1) * block_size,
                                c * block_size:(c + 1) * block_size]
            s_block = s_channel[r * block_size:(r + 1) * block_size,
                                c * block_size:(c + 1) * block_size]
            hue_var_map[r, c] = np.var(h_block)
            sat_var_map[r, c] = np.var(s_block)

    # --- 4. Gradient magnitude analysis ---
    sobel_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    gradient_mag = np.sqrt(sobel_x ** 2 + sobel_y ** 2)

    # Normalise gradient magnitude
    grad_max = gradient_mag.max()
    if grad_max > 0:
        gradient_norm = (gradient_mag / grad_max * 255).astype(np.uint8)
    else:
        gradient_norm = np.zeros_like(gray, dtype=np.uint8)

    # --- 5. Combine signals ---
    # Edge density per block
    edge_density = np.zeros((rows, cols), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            edge_block = edges_dilated[r * block_size:(r + 1) * block_size,
                                       c * block_size:(c + 1) * block_size]
            edge_density[r, c] = np.mean(edge_block)

    # Normalise all signals to 0-1
    def _norm(arr):
        mn, mx = arr.min(), arr.max()
        if mx - mn < 1e-5:
            return np.zeros_like(arr)
        return (arr - mn) / (mx - mn)

    combined = (_norm(hue_var_map) * 0.3 +
                _norm(sat_var_map) * 0.3 +
                _norm(edge_density) * 0.4)

    # Threshold to find suspicious regions
    threshold = 0.6
    suspicious = (combined > threshold).astype(np.uint8) * 255
    suspicious_full = cv2.resize(suspicious, (w, h), interpolation=cv2.INTER_NEAREST)

    # --- 6. Visualisation ---
    # Gradient magnitude heatmap blended with edges
    grad_heatmap = cv2.applyColorMap(gradient_norm, cv2.COLORMAP_MAGMA)
    vis = cv2.addWeighted(img_bgr, 0.5, grad_heatmap, 0.5, 0)

    # Contour suspicious regions
    contours, _ = cv2.findContours(suspicious_full, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(vis, contours, -1, (0, 255, 255), 2)

    # --- 7. Confidence ---
    suspicious_ratio = float(np.sum(suspicious > 0)) / suspicious.size
    confidence = min(1.0, suspicious_ratio * 4)
    confidence = round(confidence, 2)

    # --- 8. Findings ---
    findings: list[str] = []
    n_suspicious = len(contours)

    if n_suspicious > 3:
        findings.append(f"Detected {n_suspicious} regions with boundary/colour discontinuities.")
    elif n_suspicious > 0:
        findings.append(f"Found {n_suspicious} region(s) with potential splicing artefacts.")
    else:
        findings.append("No significant splicing indicators detected.")

    # Edge density insight
    mean_edge = float(np.mean(edge_density))
    if mean_edge > 50:
        findings.append("High edge density — image has complex textures (may affect detection).")

    return {
        "visualization": vis,
        "confidence": confidence,
        "findings": findings,
    }
