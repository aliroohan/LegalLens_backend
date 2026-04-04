"""
Compression Artifact Detection Service
----------------------------------------
DIP Concepts: Block-based processing (8×8 DCT grids),
frequency domain understanding, texture variation measurement.

Analyses JPEG 8×8 block boundaries to detect inconsistent
compression patterns that may indicate selective re-compression
after editing.
"""

import io
import cv2
import numpy as np
from PIL import Image


def run_compression_analysis(image_bytes: bytes) -> dict:
    """
    Detect JPEG compression artifact inconsistencies.

    Returns
    -------
    dict with keys:
        - visualization : numpy array (BGR) block artifact map
        - confidence    : float 0-1
        - findings      : list[str]
    """
    # --- 1. Decode image ---
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_rgb = np.array(original)
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)

    h, w = gray.shape

    # --- 2. Compute block boundary gradients ---
    # For each 8×8 block boundary, measure the gradient strength
    block_size = 8
    h_grad = np.zeros_like(gray)
    v_grad = np.zeros_like(gray)

    # Horizontal block boundaries (between rows)
    for y in range(block_size, h - 1, block_size):
        h_grad[y, :] = np.abs(gray[y, :] - gray[y - 1, :])

    # Vertical block boundaries (between cols)
    for x in range(block_size, w - 1, block_size):
        v_grad[:, x] = np.abs(gray[:, x] - gray[:, x - 1])

    # Combined boundary gradient
    boundary_grad = h_grad + v_grad

    # --- 3. Compute per-block compression quality measure ---
    rows = h // block_size
    cols = w // block_size
    quality_map = np.zeros((rows, cols), dtype=np.float32)

    for r in range(rows):
        for c in range(cols):
            block = gray[
                r * block_size:(r + 1) * block_size,
                c * block_size:(c + 1) * block_size
            ]
            # Measure block "smoothness" — low-quality JPEG blocks are smoother
            # Use Laplacian variance as a sharpness proxy
            laplacian_var = cv2.Laplacian(block, cv2.CV_32F).var()
            quality_map[r, c] = laplacian_var

    # --- 4. Find inconsistent blocks ---
    global_mean = float(np.mean(quality_map))
    global_std = float(np.std(quality_map))

    if global_std < 1e-5:
        z_scores = np.zeros_like(quality_map)
    else:
        z_scores = np.abs((quality_map - global_mean) / (global_std + 1e-5))

    anomaly_mask = (z_scores > 2.5).astype(np.uint8)
    anomaly_count = int(np.sum(anomaly_mask))

    # --- 5. Visualisation ---
    # Normalise boundary gradient for heatmap
    bg_max = boundary_grad.max()
    if bg_max > 0:
        boundary_norm = (boundary_grad / bg_max * 255).astype(np.uint8)
    else:
        boundary_norm = np.zeros_like(gray, dtype=np.uint8)

    heatmap = cv2.applyColorMap(boundary_norm, cv2.COLORMAP_HOT)
    vis = cv2.addWeighted(img_bgr, 0.6, heatmap, 0.4, 0)

    # Mark anomalous blocks with rectangles
    for r in range(rows):
        for c in range(cols):
            if anomaly_mask[r, c]:
                pt1 = (c * block_size, r * block_size)
                pt2 = ((c + 1) * block_size, (r + 1) * block_size)
                cv2.rectangle(vis, pt1, pt2, (0, 255, 0), 1)

    # --- 6. Confidence ---
    total_blocks = rows * cols
    anomaly_ratio = anomaly_count / max(total_blocks, 1)
    confidence = min(1.0, anomaly_ratio * 5)
    confidence = round(confidence, 2)

    # --- 7. Findings ---
    findings: list[str] = []
    findings.append(f"Analysed {total_blocks} blocks ({block_size}×{block_size} DCT grid).")

    if anomaly_count > 10:
        findings.append(
            f"{anomaly_count} blocks show inconsistent compression — "
            "possible selective re-compression after editing."
        )
    elif anomaly_count > 0:
        findings.append(f"{anomaly_count} block(s) with unusual compression patterns detected.")
    else:
        findings.append("Compression artifacts appear consistent across the image.")

    return {
        "visualization": vis,
        "confidence": confidence,
        "findings": findings,
    }
