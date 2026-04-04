"""
Error Level Analysis (ELA) Service
-----------------------------------
DIP Concepts: Image subtraction, pixel-wise intensity difference,
contrast stretching, histogram scaling.

Re-saves the image at a known JPEG quality level and computes the
pixel-wise difference between the original and the recompressed version.
Edited regions typically show different compression error levels.
"""

import io
import cv2
import numpy as np
from PIL import Image


def run_ela(image_bytes: bytes, quality: int = 95) -> dict:
    """
    Perform Error Level Analysis on the given image bytes.

    Returns
    -------
    dict with keys:
        - visualization : numpy array (BGR, uint8) of the ELA heatmap
        - confidence    : float 0-1 indicating forgery likelihood
        - findings      : list[str] of human-readable observations
    """
    # --- 1. Decode original image ---
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    # --- 2. Re-save at known JPEG quality ---
    buffer = io.BytesIO()
    original.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    recompressed = Image.open(buffer).convert("RGB")

    # --- 3. Pixel-wise absolute difference ---
    orig_arr = np.array(original, dtype=np.float32)
    recomp_arr = np.array(recompressed, dtype=np.float32)
    diff = np.abs(orig_arr - recomp_arr)

    # --- 4. Contrast stretching / enhancement ---
    scale_factor = 20
    ela_image = np.clip(diff * scale_factor, 0, 255).astype(np.uint8)

    # --- 5. Convert to BGR for OpenCV compatibility ---
    ela_bgr = cv2.cvtColor(ela_image, cv2.COLOR_RGB2BGR)

    # --- 6. Generate colour heatmap ---
    ela_gray = cv2.cvtColor(ela_bgr, cv2.COLOR_BGR2GRAY)
    heatmap = cv2.applyColorMap(ela_gray, cv2.COLORMAP_JET)

    # --- 7. Compute confidence score ---
    mean_diff = float(np.mean(ela_gray))
    max_diff = float(np.max(ela_gray))
    std_diff = float(np.std(ela_gray))

    # Normalised score: higher std relative to mean suggests localised edits
    confidence = min(1.0, std_diff / (mean_diff + 1e-5) * 0.3)
    confidence = round(confidence, 2)

    # --- 8. Findings ---
    findings: list[str] = []
    if confidence > 0.6:
        findings.append("High ELA variance detected — likely localised editing.")
    elif confidence > 0.3:
        findings.append("Moderate ELA variance — some regions may be edited.")
    else:
        findings.append("Low ELA variance — image appears relatively uniform.")

    if max_diff > 200:
        findings.append(f"Peak difference of {max_diff:.0f} found — suspicious region present.")

    return {
        "visualization": heatmap,
        "confidence": confidence,
        "findings": findings,
    }
