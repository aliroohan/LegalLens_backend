"""
Copy-Move (Clone) Detection Service - Improved
--------------------------------------------------
DIP Concepts: Block processing, DCT feature extraction, KD-tree
nearest-neighbour search, g2NN ratio test, shift-vector clustering.

Improvements over baseline:
  1. KD-tree nearest-neighbour search (scipy.spatial.cKDTree) replaces
     lexicographic sort + adjacent-pair comparison. Lex-sort only
     guarantees closeness along the first feature dimension; true
     near-duplicates can land far apart in the sorted list and get
     missed entirely. A KD-tree finds the actual nearest neighbours
     in full feature space.
  2. g2NN ratio test (Amerini et al., 2011) — the classic, peer-reviewed
     copy-move filter. A genuine duplicated block has a 1st-nearest-
     neighbour distance much smaller than its 2nd-nearest-neighbour
     distance. Repetitive textures (sky, grass, brick, carpet) tend to
     have many similarly-close neighbours, so the ratio stays high and
     they get filtered out. This is the single biggest false-positive
     reduction versus the baseline's fixed Euclidean threshold.
  3. Shift-vector clustering — real copy-move forgery is a single
     rigid translation of one region to another, so genuine matches
     share (approximately) the same offset vector. We now only accept
     matches that belong to a shift vector with enough supporting
     block pairs (min_cluster_size). Isolated matches from texture
     coincidence are discarded. This also lets us report the dominant
     duplication vector, useful for a legal report.
  4. Feature vectors are L2-normalised so matching is invariant to
     small local brightness/contrast differences (which JPEG
     recompression or slight editing can introduce).
"""

import io
import cv2
import numpy as np
from PIL import Image
from scipy.fftpack import dct
from scipy.spatial import cKDTree
from collections import defaultdict


def _extract_block_features(gray: np.ndarray, block_size: int = 16, step: int = 8) -> tuple:
    """
    Divide image into overlapping blocks and extract normalised DCT features.

    Returns (features, positions) where features is (N, D) and
    positions is (N, 2) with (row, col) of each block's top-left corner.
    """
    h, w = gray.shape
    features = []
    positions = []

    for y in range(0, h - block_size + 1, step):
        for x in range(0, w - block_size + 1, step):
            block = gray[y:y + block_size, x:x + block_size].astype(np.float32)
            dct_block = dct(dct(block, axis=0, norm='ortho'), axis=1, norm='ortho')
            feat = dct_block[:4, :4].flatten()
            norm = np.linalg.norm(feat) + 1e-8
            features.append(feat / norm)  # brightness/contrast-invariant
            positions.append((y, x))

    return np.array(features), np.array(positions)


def run_copy_move(image_bytes: bytes, block_size: int = 16,
                   g2nn_thresh: float = 0.5, min_shift: int = 24,
                   min_cluster_size: int = 4) -> dict:
    """
    Detect copy-move forgery regions.

    Parameters
    ----------
    g2nn_thresh : ratio threshold for the g2NN test (lower = stricter,
                  fewer but more confident matches). 0.4-0.6 is typical.
    min_shift   : minimum spatial distance (px) between two blocks for
                  a match to be considered "moved" rather than adjacent
                  overlap of the same region.
    min_cluster_size : minimum number of block pairs that must share
                  the same shift vector to be accepted as genuine.

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

    if len(features) < 5:
        return {
            "visualization": img_bgr,
            "confidence": 0.0,
            "findings": ["Image too small for block-based analysis."],
        }

    # --- 3. KD-tree nearest-neighbour search + g2NN ratio test ---
    tree = cKDTree(features)
    dists, idxs = tree.query(features, k=3)  # self, 1st NN, 2nd NN

    shift_votes = defaultdict(list)  # shift vector (quantised) -> [(p1, p2), ...]

    for i in range(len(features)):
        d1, d2 = dists[i, 1], dists[i, 2]
        if d2 < 1e-8:
            continue
        ratio = d1 / d2
        if ratio < g2nn_thresh:
            j = idxs[i, 1]
            p1, p2 = positions[i], positions[j]
            spatial_dist = np.linalg.norm(p1 - p2)
            if spatial_dist > min_shift:
                # Quantise the shift vector so near-identical offsets
                # (off by a pixel or two due to block stepping) merge
                # into the same cluster.
                shift = (int(round((p2[0] - p1[0]) / 4) * 4),
                         int(round((p2[1] - p1[1]) / 4) * 4))
                shift_votes[shift].append((tuple(p1), tuple(p2)))

    # --- 4. Shift-vector clustering: keep only well-supported translations ---
    mask = np.zeros(gray.shape[:2], dtype=np.uint8)
    match_count = 0
    strongest_shift, strongest_count = None, 0
    accepted_shifts = 0

    for shift, pairs in shift_votes.items():
        if len(pairs) >= min_cluster_size:
            accepted_shifts += 1
            match_count += len(pairs)
            if len(pairs) > strongest_count:
                strongest_count = len(pairs)
                strongest_shift = shift
            for p1, p2 in pairs:
                mask[p1[0]:p1[0] + block_size, p1[1]:p1[1] + block_size] = 255
                mask[p2[0]:p2[0] + block_size, p2[1]:p2[1] + block_size] = 255

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.dilate(mask, kernel, iterations=1)

    if scale != 1.0:
        mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)

    # --- 5. Visualisation ---
    vis = img_bgr.copy()
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(vis, contours, -1, (0, 0, 255), 2)
    overlay = vis.copy()
    overlay[mask > 0] = [0, 0, 255]
    vis = cv2.addWeighted(vis, 0.7, overlay, 0.3, 0)

    # --- 6. Confidence ---
    coverage = float(np.sum(mask > 0)) / mask.size
    confidence = round(min(1.0, coverage * 10), 2)

    # --- 7. Findings ---
    findings: list[str] = []
    if match_count > 0:
        findings.append(
            f"Detected {match_count} matching block pairs across {accepted_shifts} consistent "
            "shift vector(s) — filtered with the g2NN ratio test and shift-vector clustering."
        )
        if strongest_shift:
            findings.append(
                f"Dominant duplication shift vector: {strongest_shift} (row, col) with "
                f"{strongest_count} supporting block pairs."
            )
    else:
        findings.append("No significant copy-move forgery detected after g2NN filtering and shift-vector clustering.")

    if coverage > 0.03:
        findings.append(f"Approximately {coverage * 100:.1f}% of the image shows duplicated content.")

    return {
        "visualization": vis,
        "confidence": confidence,
        "findings": findings,
    }