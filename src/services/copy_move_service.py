"""
Copy-Move (Clone) Detection Service
-------------------------------------
DIP Concepts: Block processing, DCT feature extraction,
Euclidean distance comparison, correlation.

Divides the image into overlapping blocks, extracts DCT-based
feature vectors, sorts them, and finds near-duplicate pairs
to reveal copy-move forgery.
"""

import io
import cv2
import numpy as np
from PIL import Image
from scipy.fftpack import dct


def _extract_block_features(gray: np.ndarray, block_size: int = 16, step: int = 8) -> tuple:
    """
    Divide image into overlapping blocks and extract DCT features.

    Returns (features, positions) where features is (N, D) and
    positions is (N, 2) with (row, col) of each block's top-left corner.
    """
    h, w = gray.shape
    features = []
    positions = []

    for y in range(0, h - block_size + 1, step):
        for x in range(0, w - block_size + 1, step):
            block = gray[y:y + block_size, x:x + block_size].astype(np.float32)
            # 2D DCT and take top-left coefficients as feature
            dct_block = dct(dct(block, axis=0, norm='ortho'), axis=1, norm='ortho')
            # Zig-zag-like: take first few low-frequency coefficients
            feat = dct_block[:4, :4].flatten()
            features.append(feat)
            positions.append((y, x))

    return np.array(features), np.array(positions)


def run_copy_move(image_bytes: bytes, block_size: int = 16, distance_threshold: float = 40.0,
                  min_shift: int = 32) -> dict:
    """
    Detect copy-move forgery regions.

    Returns
    -------
    dict with keys:
        - visualization : numpy array (BGR) with matched regions highlighted
        - confidence    : float 0-1
        - findings      : list[str]
    """
    # --- 1. Decode & convert to grayscale ---
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_rgb = np.array(original)
    img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

    # Resize large images for performance
    h, w = img_bgr.shape[:2]
    max_dim = 800
    scale = 1.0
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img_resized = cv2.resize(img_bgr, None, fx=scale, fy=scale)
    else:
        img_resized = img_bgr.copy()

    gray = cv2.cvtColor(img_resized, cv2.COLOR_BGR2GRAY)

    # --- 2. Extract block features ---
    features, positions = _extract_block_features(gray, block_size, step=block_size // 2)

    if len(features) == 0:
        return {
            "visualization": img_bgr,
            "confidence": 0.0,
            "findings": ["Image too small for block-based analysis."],
        }

    # --- 3. Sort features lexicographically and compare neighbours ---
    sort_idx = np.lexsort(features.T[::-1])
    sorted_feats = features[sort_idx]
    sorted_pos = positions[sort_idx]

    mask = np.zeros(gray.shape[:2], dtype=np.uint8)
    match_count = 0

    for i in range(len(sorted_feats) - 1):
        dist = np.linalg.norm(sorted_feats[i] - sorted_feats[i + 1])
        if dist < distance_threshold:
            p1 = sorted_pos[i]
            p2 = sorted_pos[i + 1]
            spatial_dist = np.linalg.norm(p1 - p2)
            if spatial_dist > min_shift:
                # Mark both blocks on the mask
                mask[p1[0]:p1[0] + block_size, p1[1]:p1[1] + block_size] = 255
                mask[p2[0]:p2[0] + block_size, p2[1]:p2[1] + block_size] = 255
                match_count += 1

    # --- 4. Dilate mask to merge nearby regions ---
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.dilate(mask, kernel, iterations=2)

    # --- 5. Scale mask back to original size ---
    if scale != 1.0:
        mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)

    # --- 6. Create visualisation ---
    vis = img_bgr.copy()
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(vis, contours, -1, (0, 0, 255), 2)

    # Overlay semi-transparent red on matched regions
    overlay = vis.copy()
    overlay[mask > 0] = [0, 0, 255]
    vis = cv2.addWeighted(vis, 0.7, overlay, 0.3, 0)

    # --- 7. Confidence ---
    coverage = float(np.sum(mask > 0)) / mask.size
    confidence = min(1.0, coverage * 10)
    confidence = round(confidence, 2)

    # --- 8. Findings ---
    findings: list[str] = []
    if match_count > 5:
        findings.append(f"Detected {match_count} matching block pairs — strong copy-move indication.")
    elif match_count > 0:
        findings.append(f"Detected {match_count} matching block pair(s) — possible copy-move region.")
    else:
        findings.append("No significant copy-move forgery detected.")

    if coverage > 0.05:
        findings.append(f"Approximately {coverage * 100:.1f}% of the image shows duplicated content.")

    return {
        "visualization": vis,
        "confidence": confidence,
        "findings": findings,
    }
