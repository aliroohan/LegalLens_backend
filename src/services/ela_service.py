"""
Error Level Analysis (ELA) Service - Improved
-----------------------------------------------
DIP Concepts: Image subtraction, multi-scale re-compression,
robust (median/MAD) statistics, adaptive contrast stretching.

Improvements over baseline:
  1. Multi-quality ELA (averages error across several JPEG qualities
     instead of one arbitrary quality=95) -> less sensitive to the
     choice of resave quality, more stable signal.
  2. Adaptive percentile-based contrast stretch instead of a fixed
     *20 multiplier -> works consistently across images with very
     different natural error ranges.
  3. Robust median/MAD z-scores instead of mean/std for anomaly
     detection -> mean/std are themselves pulled by the tampered
     region, which biases the old method toward under-detecting.
  4. Border-block exclusion -> real JPEGs always show elevated ELA
     at the image border/edges independent of tampering; the old
     code counted these as anomalies.
  5. Source-format check -> ELA is only meaningful on JPEG-derived
     images; now the service tells you when that assumption is
     violated (e.g. PNG/screenshot uploads).
"""

import io
import cv2
import numpy as np
from PIL import Image


def _single_ela_diff(pil_img: Image.Image, quality: int) -> np.ndarray:
    """Re-save at a given quality and return the per-pixel RGB abs diff (H,W,3)."""
    buffer = io.BytesIO()
    pil_img.save(buffer, format="JPEG", quality=quality)
    buffer.seek(0)
    recompressed = Image.open(buffer).convert("RGB")
    orig_arr = np.array(pil_img, dtype=np.float32)
    recomp_arr = np.array(recompressed, dtype=np.float32)
    return np.abs(orig_arr - recomp_arr)


def run_ela(image_bytes: bytes, qualities=(70, 80, 90, 95), block_size: int = 16) -> dict:
    """
    Perform multi-quality Error Level Analysis on the given image bytes.

    Returns
    -------
    dict with keys:
        - visualization : numpy array (BGR, uint8) of the ELA heatmap
        - confidence    : float 0-1 indicating forgery likelihood
        - findings      : list[str] of human-readable observations
    """
    # --- 1. Decode original image ---
    original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    src_format = Image.open(io.BytesIO(image_bytes)).format

    # --- 2. Multi-quality ELA: average the error map across several
    #     recompression qualities. A single quality level can miss edits
    #     (or create false positives) depending on how close it happens to
    #     land relative to the image's true original quality. Averaging
    #     across a spread of qualities gives a much more stable signal. ---
    diffs = [_single_ela_diff(original, q) for q in qualities]
    diff_mean = np.mean(np.stack(diffs, axis=0), axis=0)
    err_gray = diff_mean.mean(axis=2)  # collapse RGB -> single error channel

    # --- 3. Adaptive contrast stretch (2nd-98th percentile) instead of a
    #     fixed *20 scale factor. A fixed multiplier saturates on some
    #     images and is invisible on others depending on their natural
    #     compression error range. ---
    p_low, p_high = np.percentile(err_gray, [2, 98])
    if p_high - p_low < 1e-3:
        p_high = p_low + 1.0
    stretched = np.clip((err_gray - p_low) / (p_high - p_low) * 255, 0, 255).astype(np.uint8)
    heatmap = cv2.applyColorMap(stretched, cv2.COLORMAP_JET)

    # --- 4. Block-wise robust anomaly detection ---
    hh, ww = err_gray.shape
    rows, cols = hh // block_size, ww // block_size
    block_means = np.zeros((rows, cols), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            blk = err_gray[r * block_size:(r + 1) * block_size, c * block_size:(c + 1) * block_size]
            block_means[r, c] = blk.mean()

    # Exclude the outermost ring of blocks: JPEG re-encoding always produces
    # elevated error near image borders (edge padding effects), which would
    # otherwise get flagged as false-positive "tampering".
    if rows > 2 and cols > 2:
        interior_mask = np.zeros((rows, cols), dtype=bool)
        interior_mask[1:-1, 1:-1] = True
    else:
        interior_mask = np.ones((rows, cols), dtype=bool)

    interior_vals = block_means[interior_mask]
    med = float(np.median(interior_vals))
    mad = float(np.median(np.abs(interior_vals - med))) + 1e-5  # robust spread, immune to outliers
    z = (block_means - med) / (1.4826 * mad)  # 1.4826 makes MAD comparable to std for normal data

    anomaly_mask = (z > 3.0) & interior_mask
    anomaly_count = int(np.sum(anomaly_mask))
    anomaly_ratio = anomaly_count / max(int(np.sum(interior_mask)), 1)

    # --- 5. Draw anomalous blocks ---
    vis = heatmap.copy()
    for r in range(rows):
        for c in range(cols):
            if anomaly_mask[r, c]:
                pt1 = (c * block_size, r * block_size)
                pt2 = ((c + 1) * block_size, (r + 1) * block_size)
                cv2.rectangle(vis, pt1, pt2, (0, 255, 0), 1)

    # --- 6. Confidence ---
    confidence = round(float(min(1.0, anomaly_ratio * 8)), 2)

    # --- 7. Findings ---
    findings: list[str] = []
    findings.append(f"Multi-quality ELA computed at qualities {list(qualities)} and averaged.")

    if confidence > 0.6:
        findings.append("High ELA variance detected across multiple recompression qualities — likely localised editing.")
    elif confidence > 0.3:
        findings.append("Moderate ELA variance — some regions show inconsistent error levels.")
    else:
        findings.append("Low ELA variance — error levels are consistent across the image.")

    if anomaly_count > 0:
        findings.append(f"{anomaly_count} block(s) show statistically anomalous error levels (robust z-score > 3, border excluded).")

    if src_format != "JPEG":
        findings.append(
            f"Warning: source image format is {src_format}, not JPEG. ELA is calibrated for JPEG "
            "recompression artifacts and is less reliable on non-JPEG sources (e.g. re-saved PNGs, screenshots)."
        )

    return {
        "visualization": vis,
        "confidence": confidence,
        "findings": findings,
    }