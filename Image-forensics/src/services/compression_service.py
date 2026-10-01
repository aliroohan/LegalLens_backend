"""
Compression Artifact Detection Service - Improved
------------------------------------------------------
DIP Concepts: Block-based processing, multi-quality JPEG re-compression,
frequency-domain error minimisation, robust (median/MAD) statistics.

The baseline version only measured local "smoothness" (Laplacian
variance) per 8x8 block. That is a weak, indirect proxy — it reacts to
texture as much as to compression quality, which is why it was flagging
~29 blocks even at "low" confidence.

This version adds the JPEG Ghosts method (Farid, 2009), the established
forensic technique for exactly this task: it re-compresses the image at
a sweep of qualities and finds, per block, which quality level minimises
the re-compression error. A block that was originally saved at a lower
quality elsewhere (e.g. pasted in from another JPEG) and pasted into a
higher-quality image will have its error minimised at a *different*
quality than the rest of the image — a "ghost" of its true prior
compression. Blocks are only flagged when BOTH signals (JPEG ghost
mismatch AND abnormal blockiness) agree, which sharply cuts false
positives versus relying on either heuristic alone.
"""

import io
import cv2
import numpy as np
from PIL import Image


def _resave_error_map(pil_img: Image.Image, quality: int) -> np.ndarray:
    """Re-save at `quality` and return the per-pixel mean-abs-diff map (H,W)."""
    buf = io.BytesIO()
    pil_img.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    recompressed = np.array(Image.open(buf).convert("RGB"), dtype=np.float32)
    orig = np.array(pil_img, dtype=np.float32)
    return np.mean(np.abs(orig - recompressed), axis=2)


def _jpeg_ghost_map(pil_img: Image.Image, qualities, block_size: int):
    """For each block, find the resave quality index that minimises error."""
    w, h = pil_img.size
    error_stack = np.stack([_resave_error_map(pil_img, q) for q in qualities], axis=0)  # (Q,H,W)

    q_count = len(qualities)
    rows, cols = h // block_size, w // block_size
    block_errors = np.zeros((q_count, rows, cols), dtype=np.float32)
    for qi in range(q_count):
        for r in range(rows):
            for c in range(cols):
                blk = error_stack[qi, r * block_size:(r + 1) * block_size, c * block_size:(c + 1) * block_size]
                block_errors[qi, r, c] = blk.mean()

    best_q_idx = np.argmin(block_errors, axis=0)  # (rows, cols) — index into `qualities`
    return best_q_idx, rows, cols


def run_compression_analysis(image_bytes: bytes,
                              qualities=(60, 70, 75, 80, 85, 90, 95),
                              block_size: int = 16) -> dict:
    """
    Detect JPEG compression inconsistencies via JPEG Ghosts + blockiness.

    Note: qualities sweep and per-block re-compression is more compute-
    intensive than the baseline (O(num_qualities) resaves). For very
    large images, downsample before calling this, or reduce the number
    of qualities tested (5-7 evenly spaced values is usually enough).

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

    # --- 2. JPEG Ghost analysis: which quality best matches each block? ---
    best_q_idx, rows, cols = _jpeg_ghost_map(original, qualities, block_size)

    # The majority "best-fit" quality across the whole image is treated as
    # the image's native compression quality. Blocks whose best fit differs
    # from that majority are ghost-anomalies.
    values, counts = np.unique(best_q_idx, return_counts=True)
    majority_q = int(values[np.argmax(counts)])
    ghost_anomaly = (best_q_idx != majority_q)

    # --- 3. Block boundary gradient (blockiness) visualisation source ---
    h_grad = np.zeros_like(gray)
    v_grad = np.zeros_like(gray)
    for y in range(block_size, h - 1, block_size):
        h_grad[y, :] = np.abs(gray[y, :] - gray[y - 1, :])
    for x in range(block_size, w - 1, block_size):
        v_grad[:, x] = np.abs(gray[:, x] - gray[:, x - 1])
    boundary_grad = h_grad + v_grad

    # --- 4. Robust per-block "sharpness" anomaly (replaces mean/std) ---
    quality_map = np.zeros((rows, cols), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            block = gray[r * block_size:(r + 1) * block_size, c * block_size:(c + 1) * block_size]
            quality_map[r, c] = cv2.Laplacian(block, cv2.CV_32F).var()

    interior = quality_map[1:-1, 1:-1] if rows > 2 and cols > 2 else quality_map
    med = float(np.median(interior))
    mad = float(np.median(np.abs(interior - med))) + 1e-5
    z_scores = np.abs((quality_map - med) / (1.4826 * mad))  # robust, not skewed by the tampered region itself
    blockiness_anomaly = z_scores > 3.0

    # --- 5. Combine both signals ---
    # A block is "strong evidence" only if BOTH the JPEG-ghost quality
    # mismatch and the blockiness anomaly agree; ghost-only mismatches are
    # kept as weaker, secondary evidence (shown separately).
    combined_anomaly = ghost_anomaly & blockiness_anomaly
    ghost_only = ghost_anomaly & ~blockiness_anomaly

    anomaly_count = int(np.sum(combined_anomaly))
    weak_anomaly_count = int(np.sum(ghost_only))

    # --- 6. Visualisation ---
    bg_max = boundary_grad.max()
    boundary_norm = (boundary_grad / bg_max * 255).astype(np.uint8) if bg_max > 0 else np.zeros_like(gray, dtype=np.uint8)
    heatmap = cv2.applyColorMap(boundary_norm, cv2.COLORMAP_HOT)
    vis = cv2.addWeighted(img_bgr, 0.6, heatmap, 0.4, 0)

    for r in range(rows):
        for c in range(cols):
            pt1 = (c * block_size, r * block_size)
            pt2 = ((c + 1) * block_size, (r + 1) * block_size)
            if combined_anomaly[r, c]:
                cv2.rectangle(vis, pt1, pt2, (0, 255, 0), 1)     # strong: green
            elif ghost_only[r, c]:
                cv2.rectangle(vis, pt1, pt2, (0, 200, 255), 1)   # weak: orange

    # --- 7. Confidence ---
    total_blocks = rows * cols
    strong_ratio = anomaly_count / max(total_blocks, 1)
    weak_ratio = weak_anomaly_count / max(total_blocks, 1)
    confidence = round(min(1.0, strong_ratio * 6 + weak_ratio * 1.5), 2)

    # --- 8. Findings ---
    findings: list[str] = []
    findings.append(
        f"Analysed {total_blocks} blocks ({block_size}x{block_size} grid) across "
        f"{len(qualities)} JPEG-ghost quality levels {list(qualities)}."
    )
    findings.append(f"Estimated native compression quality (majority best-fit): Q={qualities[majority_q]}.")

    if anomaly_count > 5:
        findings.append(
            f"{anomaly_count} blocks show BOTH a different best-fit JPEG quality AND abnormal "
            "blockiness — strong evidence of localized re-compression (e.g. splicing)."
        )
    elif anomaly_count > 0:
        findings.append(f"{anomaly_count} block(s) show strong dual-signal compression inconsistency.")
    else:
        findings.append("No blocks show strong dual-signal compression inconsistency.")

    if weak_anomaly_count > 0:
        findings.append(
            f"{weak_anomaly_count} additional block(s) show a JPEG-ghost quality mismatch only "
            "(weaker, single-signal evidence — shown in orange)."
        )

    return {
        "visualization": vis,
        "confidence": confidence,
        "findings": findings,
    }