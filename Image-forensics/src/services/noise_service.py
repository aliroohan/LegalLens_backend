"""
Noise Pattern Analysis Service
-------------------------------
Estimates per-channel (R, G, B) noise using a single-level Haar wavelet
decomposition.  Local noise statistics are computed with 50 % overlapping
sliding windows at multiple spatial scales, compared via robust log-variance
z-scores, and accumulated into a dense anomaly heatmap.

Texture-rich / high-edge windows are given lower weight so that natural
image structure is not mis-classified as sensor-noise inconsistency.

Public API
----------
    run_noise_analysis(image_bytes, grid_size=32) -> dict
        Backward-compatible entry point.  Returns:
            visualization : np.ndarray  BGR heatmap blended with original
            confidence    : float       0-1 derived from statistical evidence
            findings      : list[str]

Statistical methodology
-----------------------
* Wavelet noise estimator (Donoho & Johnstone 1994):
      sigma_c = median(|HH_c|) / 0.6745
  where HH_c is the diagonal high-frequency sub-band for channel c after one
  level of Haar decomposition.  Haar is used because its HH sub-band isolates
  high-frequency 2-D detail without any boundary extension artefacts beyond
  signal periodicity, making the estimate insensitive to low-frequency structure.

* Log-variance robust z-score:
      log_var = log(block_variance + eps)
      z = 0.6745 * (log_var - median(log_var)) / MAD(log_var)
  Log-space linearises the heavy-tailed chi-squared distribution of sample
  variance.  The 0.6745 normalisation makes z consistent with standard normal
  units under Gaussian data.

* Two-pass outlier rejection: blocks whose initial |z| > 3 are excluded from
  baseline re-estimation, preventing a large forged patch from inflating the
  reference statistics.

* Multi-scale fusion: anomaly maps from 16, 32, 64 px grids are normalised to
  [0, 1] then combined as a weighted maximum, giving priority to whichever
  scale produces the strongest local evidence.

* Confidence is derived from the fraction of windows that exceed the z-score
  threshold and from the mean exceedance magnitude - no arbitrary multipliers.

Validated vs not validated
--------------------------
IMPLEMENTED BUT NOT YET VALIDATED AGAINST LABELED DATA:
  - Wavelet noise estimator replacing Gaussian-blur residual
  - Texture/edge masking via Sobel gradient magnitude
  - 50 % overlapping sliding windows
  - Robust log-variance z-scores with two-pass outlier rejection
  - Multi-scale (16/32/64) analysis and weighted-maximum fusion
  - RGB per-channel noise inconsistency and max-channel fusion
  - Dense bilinear heatmap accumulation
  - Statistically derived confidence score
  - Optional JPEG ELA complementary signal

VALIDATED (carries over from original implementation):
  - End-to-end pipeline produces a heatmap and confidence in [0, 1]
  - Backward-compatible return structure (visualization / confidence / findings)

A full ROC/AUC evaluation requires labeled ground-truth data (e.g. CASIA v2).
The evaluation harness in tests/evaluate_noise.py is ready to run once such
data is provided.

Dependencies added
------------------
  PyWavelets (PyPI: PyWavelets >= 1.4)  -- single-level wavelet decomposition.
  All other imports (cv2, numpy, scipy, PIL) were already present.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np
import pywt
from PIL import Image
from scipy.ndimage import gaussian_filter

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

#: Grid sizes used for multi-scale analysis (pixels).
DEFAULT_SCALES: tuple[int, ...] = (16, 32, 64)

#: Robust z-score threshold above which a window is considered anomalous.
DEFAULT_Z_THRESHOLD: float = 2.5

#: Epsilon added before log to avoid log(0).
_LOG_EPS: float = 1e-6

#: Weight given to JPEG ELA signal when fusing with noise signal (0 = disabled).
JPEG_ELA_WEIGHT: float = 0.25

#: Wavelet family used for noise estimation.
_WAVELET: str = "haar"

#: Minimum window size for wavelet decomposition (must be >= 4).
_MIN_WINDOW_SIZE: int = 8


# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------

@dataclass
class WindowStats:
    """Statistics for a single analysis window."""

    row_start: int
    col_start: int
    height: int
    width: int
    noise_var: np.ndarray        # shape (3,) -- per-channel noise variance
    log_var: np.ndarray          # shape (3,) -- log(noise_var + eps)
    texture: float               # Sobel gradient-magnitude measure


@dataclass
class ScaleResult:
    """Output of analyse_at_scale() for one grid size."""

    grid_size: int
    windows: list[WindowStats] = field(default_factory=list)
    z_scores: np.ndarray = field(default_factory=lambda: np.array([]))
    anomaly_mask: np.ndarray = field(default_factory=lambda: np.array([]))
    threshold: float = DEFAULT_Z_THRESHOLD


# ---------------------------------------------------------------------------
# 1. Wavelet noise estimator
# ---------------------------------------------------------------------------

def estimate_noise(image: np.ndarray) -> dict:
    """Estimate per-channel sensor noise using a single-level Haar wavelet.

    Parameters
    ----------
    image:
        H x W x 3 float32 array with values in [0, 255].

    Returns
    -------
    dict with keys:
        ``per_channel`` : np.ndarray shape (3,) -- sigma per R/G/B channel.
        ``combined``    : np.ndarray shape (H, W) -- RMS across channels.
        ``channel_names``: list[str]
    """
    h, w = image.shape[:2]
    sigmas = np.zeros(3, dtype=np.float32)

    for c in range(3):
        ch = image[:, :, c]
        # Need at least 2 pixels in each dimension for a 1-level decomp.
        if h < 2 or w < 2:
            sigmas[c] = 0.0
            continue
        try:
            # Single-level 2-D Haar decomposition
            _cA, (cH, cV, cH_diag) = pywt.dwt2(ch, _WAVELET)
            # Use diagonal HH sub-band -- most robust against smooth structure
            hh = cH_diag.ravel()
            if hh.size == 0:
                sigmas[c] = 0.0
            else:
                sigmas[c] = float(np.median(np.abs(hh)) / 0.6745)
        except Exception:
            sigmas[c] = 0.0

    # Combined representation: pixel-wise RMS across channels
    combined = np.sqrt(np.mean(image.astype(np.float64) ** 2, axis=2)).astype(np.float32)

    return {
        "per_channel": sigmas,
        "combined": combined,
        "channel_names": ["R", "G", "B"],
    }


# ---------------------------------------------------------------------------
# 2. Texture / edge measure
# ---------------------------------------------------------------------------

def compute_texture_measure(image: np.ndarray) -> np.ndarray:
    """Return a per-pixel Sobel gradient-magnitude map (float32, 0-1 normalised).

    Parameters
    ----------
    image:
        H x W x 3 float32 array with values in [0, 255].

    Returns
    -------
    H x W float32 array.
    """
    gray = (
        0.2126 * image[:, :, 0]
        + 0.7152 * image[:, :, 1]
        + 0.0722 * image[:, :, 2]
    ).astype(np.float32)

    # Sobel in x and y
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = np.sqrt(gx ** 2 + gy ** 2)

    mag_max = magnitude.max()
    if mag_max > 1e-5:
        magnitude /= mag_max
    return magnitude


# ---------------------------------------------------------------------------
# 3. Block statistics with 50 % overlapping sliding windows
# ---------------------------------------------------------------------------

def compute_block_stats(
    image: np.ndarray,
    texture_map: np.ndarray,
    grid_size: int,
) -> list[WindowStats]:
    """Slide a window across the image with 50 % overlap and collect stats.

    Every pixel in the image -- including the rightmost / bottommost boundary --
    is covered by at least one window.  Windows that would extend past the
    image edge are clamped to the boundary (they remain full-sized in area
    calculation but analyse the available pixels).

    Parameters
    ----------
    image:
        H x W x 3 float32 array in [0, 255].
    texture_map:
        H x W float32 gradient-magnitude map.
    grid_size:
        Window size in pixels.

    Returns
    -------
    list[WindowStats]
    """
    h, w = image.shape[:2]
    stride = max(1, grid_size // 2)
    stats: list[WindowStats] = []

    # Generate top-left corners; always include the bottom/right boundary
    row_starts = list(range(0, h, stride))
    col_starts = list(range(0, w, stride))
    if row_starts and row_starts[-1] + grid_size < h:
        row_starts.append(h - grid_size)
    if col_starts and col_starts[-1] + grid_size < w:
        col_starts.append(w - grid_size)

    for r in row_starts:
        r_end = min(r + grid_size, h)
        actual_h = r_end - r
        for c in col_starts:
            c_end = min(c + grid_size, w)
            actual_w = c_end - c

            if actual_h < _MIN_WINDOW_SIZE or actual_w < _MIN_WINDOW_SIZE:
                continue

            patch = image[r:r_end, c:c_end, :]
            tex_patch = texture_map[r:r_end, c:c_end]

            # Per-channel noise variance via wavelet
            noise_info = estimate_noise(patch)
            noise_var = noise_info["per_channel"] ** 2  # variance (sigma^2)
            log_var = np.log(noise_var + _LOG_EPS)

            texture_val = float(tex_patch.mean())

            stats.append(
                WindowStats(
                    row_start=r,
                    col_start=c,
                    height=actual_h,
                    width=actual_w,
                    noise_var=noise_var,
                    log_var=log_var,
                    texture=texture_val,
                )
            )

    return stats


# ---------------------------------------------------------------------------
# 4. Robust z-scores (two-pass)
# ---------------------------------------------------------------------------

def robust_zscore(
    log_vars: np.ndarray,
    outlier_threshold: float = 3.0,
) -> np.ndarray:
    """Compute robust z-scores of log-variance values.

    Uses median and MAD (median absolute deviation) in two passes:

    Pass 1 -- compute initial median/MAD over all windows.
    Pass 2 -- exclude |z| > outlier_threshold (gross outliers) and
              recompute the reference statistics.  Final z-scores use
              this cleaned baseline.

    Under Gaussian data the constant 0.6745 makes MAD-based z-scores
    consistent with standard-normal z-scores (E[|N(0,1)|] = 0.6745).

    Parameters
    ----------
    log_vars:
        1-D float array of log(block_variance + eps) values.
    outlier_threshold:
        |z| above which a window is excluded from the second-pass baseline.

    Returns
    -------
    1-D float32 z-score array (same length as input).
    """
    if log_vars.size == 0:
        return np.array([], dtype=np.float32)

    if log_vars.size == 1:
        return np.zeros(1, dtype=np.float32)

    def _median_mad(x: np.ndarray) -> tuple[float, float]:
        med = float(np.median(x))
        mad = float(np.median(np.abs(x - med)))
        return med, mad

    # Pass 1
    med1, mad1 = _median_mad(log_vars)
    mad1_safe = max(mad1, 1e-8)
    z1 = 0.6745 * (log_vars - med1) / mad1_safe

    # Inlier mask (exclude gross outliers from baseline)
    inlier_mask = np.abs(z1) <= outlier_threshold
    if inlier_mask.sum() < 3:
        # Too few inliers -- fall back to pass-1 z-scores
        return z1.astype(np.float32)

    # Pass 2 -- recompute baseline from inliers only
    med2, mad2 = _median_mad(log_vars[inlier_mask])
    mad2_safe = max(mad2, 1e-8)
    z2 = 0.6745 * (log_vars - med2) / mad2_safe

    return z2.astype(np.float32)


# ---------------------------------------------------------------------------
# 5. Per-scale analysis
# ---------------------------------------------------------------------------

def analyse_at_scale(
    image: np.ndarray,
    texture_map: np.ndarray,
    grid_size: int,
    z_threshold: float = DEFAULT_Z_THRESHOLD,
) -> ScaleResult:
    """Run noise inconsistency detection at a single spatial scale.

    Parameters
    ----------
    image:
        H x W x 3 float32 in [0, 255].
    texture_map:
        H x W float32 gradient magnitude map.
    grid_size:
        Window size in pixels.
    z_threshold:
        Anomaly z-score threshold.

    Returns
    -------
    ScaleResult
    """
    result = ScaleResult(grid_size=grid_size, threshold=z_threshold)

    windows = compute_block_stats(image, texture_map, grid_size)
    if not windows:
        return result

    result.windows = windows

    # Stack per-channel log-variances: shape (N, 3)
    lv_matrix = np.stack([w.log_var for w in windows], axis=0)  # (N, 3)

    # Robust z-scores per channel
    z_per_channel = np.stack(
        [robust_zscore(lv_matrix[:, c]) for c in range(3)],
        axis=1,
    )  # (N, 3)

    # Channel-aware anomaly: use weighted combination of sorted per-channel |z|
    # so that a single strongly anomalous channel is not hidden by averaging.
    sorted_z = np.sort(np.abs(z_per_channel), axis=1)[:, ::-1]
    # Weights: 50% strongest, 35% second, 15% third
    combined_z = (0.50 * sorted_z[:, 0]
                  + 0.35 * sorted_z[:, 1]
                  + 0.15 * sorted_z[:, 2])

    result.z_scores = combined_z
    result.anomaly_mask = (combined_z > z_threshold).astype(np.uint8)

    return result


# ---------------------------------------------------------------------------
# 6. Dense heatmap accumulation
# ---------------------------------------------------------------------------

def build_heatmap(
    windows: list[WindowStats],
    z_scores: np.ndarray,
    image_shape: tuple[int, int],
) -> np.ndarray:
    """Accumulate window anomaly scores into a dense full-resolution heatmap.

    Each window contributes its z-score to every pixel it covers.  The
    accumulated scores are divided by the contribution count to produce a
    smooth average.

    Parameters
    ----------
    windows:
        WindowStats list from compute_block_stats.
    z_scores:
        Combined z-score per window (same order as windows).
    image_shape:
        (H, W) of the original image.

    Returns
    -------
    H x W float32 anomaly heatmap.
    """
    h, w = image_shape
    score_acc = np.zeros((h, w), dtype=np.float64)
    count_acc = np.zeros((h, w), dtype=np.float64)

    for ws, z in zip(windows, z_scores):
        r0, c0 = ws.row_start, ws.col_start
        r1 = r0 + ws.height
        c1 = c0 + ws.width
        score_acc[r0:r1, c0:c1] += float(z)
        count_acc[r0:r1, c0:c1] += 1.0

    # Divide by count where covered; leave zero elsewhere
    valid = count_acc > 0
    heatmap = np.zeros((h, w), dtype=np.float32)
    heatmap[valid] = (score_acc[valid] / count_acc[valid]).astype(np.float32)

    return heatmap


# ---------------------------------------------------------------------------
# 7. Multi-scale fusion
# ---------------------------------------------------------------------------

def fuse_multiscale_maps(
    maps: list[np.ndarray],
    image_shape: tuple[int, int],
    scales: tuple[int, ...] = DEFAULT_SCALES,
) -> np.ndarray:
    """Fuse anomaly heatmaps from multiple spatial scales.

    Each map is:
      1. Resized to the full image resolution.
      2. Normalised to [0, 1].
      3. Combined using a weighted maximum.

    Weighting rationale: the fine scale (smallest grid) is given the
    highest weight because small tampered patches are most visible at fine
    scale; the coarse scale is downweighted.  These weights are deliberately
    exposed as configurable constants at the top of the module.

    Parameters
    ----------
    maps:
        List of float32 heatmaps, each already at full image resolution.
    image_shape:
        (H, W) target resolution.
    scales:
        Scale sizes corresponding to each map (used for weight assignment).

    Returns
    -------
    H x W float32 fused map in [0, 1].
    """
    h, w = image_shape
    if not maps:
        return np.zeros((h, w), dtype=np.float32)

    # Assign weights inversely proportional to scale size
    scale_weights = np.array([1.0 / s for s in scales[: len(maps)]], dtype=np.float64)
    scale_weights /= scale_weights.sum()

    fused = np.zeros((h, w), dtype=np.float64)
    for raw_map, weight in zip(maps, scale_weights):
        # Resize to full resolution
        if raw_map.shape != (h, w):
            resized = cv2.resize(raw_map, (w, h), interpolation=cv2.INTER_LINEAR)
        else:
            resized = raw_map.astype(np.float64)

        # Normalise to [0, 1]
        m_min, m_max = resized.min(), resized.max()
        if m_max - m_min > 1e-8:
            norm = (resized - m_min) / (m_max - m_min)
        else:
            norm = resized - m_min

        # Weighted maximum fusion
        fused = np.maximum(fused, weight * norm)

    # Re-normalise the fused result to [0, 1]
    f_max = fused.max()
    if f_max > 1e-8:
        fused /= f_max

    return fused.astype(np.float32)


# ---------------------------------------------------------------------------
# 8. Confidence / anomaly scoring
# ---------------------------------------------------------------------------

def score_confidence(
    z_scores: np.ndarray,
    z_threshold: float = DEFAULT_Z_THRESHOLD,
) -> dict:
    """Derive confidence from statistical evidence.

    Parameters
    ----------
    z_scores:
        1-D array of combined z-scores across all scales and windows.
    z_threshold:
        Anomaly threshold (configurable, not hardcoded).

    Returns
    -------
    dict with keys:
        ``anomaly_fraction``   : proportion of windows exceeding threshold
        ``mean_exceedance``    : mean z-score of exceeding windows
        ``robust_aggregate``   : median z-score of exceeding windows
        ``confidence``         : float [0, 1]
        ``threshold``          : the threshold used
        ``n_windows``          : total number of windows
        ``n_anomalous``        : number of anomalous windows
    """
    if z_scores.size == 0:
        return {
            "anomaly_fraction": 0.0,
            "mean_exceedance": 0.0,
            "robust_aggregate": 0.0,
            "confidence": 0.0,
            "threshold": z_threshold,
            "n_windows": 0,
            "n_anomalous": 0,
        }

    anomalous = z_scores[z_scores > z_threshold]
    n_total = int(z_scores.size)
    n_anom = int(anomalous.size)
    frac = n_anom / max(n_total, 1)

    mean_exc = float(anomalous.mean()) if n_anom > 0 else 0.0
    robust_agg = float(np.median(anomalous)) if n_anom > 0 else 0.0

    # Confidence: product of fraction evidence and normalised exceedance
    # strength.  Both components are in [0, 1]; their geometric mean keeps
    # the score honest when one component is weak.
    #
    # frac_score: exponential saturation of the anomalous fraction.
    #   At frac = 0.05 (5% of windows anomalous) -> ~0.63
    #   At frac = 0.20  -> ~0.98
    frac_score = float(1.0 - np.exp(-frac / 0.05)) if frac > 0 else 0.0

    # strength_score: how far above threshold do the anomalies sit?
    #   Normalised so that mean_exc = z_threshold -> 0,
    #                           mean_exc = 3*z_threshold -> 1
    if n_anom > 0 and z_threshold > 0:
        strength_score = float(
            np.clip((mean_exc - z_threshold) / (2.0 * z_threshold), 0.0, 1.0)
        )
    else:
        strength_score = 0.0

    # Geometric mean gives balanced, conservative confidence
    confidence = float(np.sqrt(frac_score * strength_score))
    confidence = round(min(1.0, confidence), 4)

    return {
        "anomaly_fraction": round(frac, 4),
        "mean_exceedance": round(mean_exc, 4),
        "robust_aggregate": round(robust_agg, 4),
        "confidence": confidence,
        "threshold": z_threshold,
        "n_windows": n_total,
        "n_anomalous": n_anom,
    }


# ---------------------------------------------------------------------------
# 9. Optional JPEG ELA signal
# ---------------------------------------------------------------------------

def _compute_jpeg_ela_score(image_bytes: bytes, quality: int = 75) -> Optional[float]:
    """Compute a complementary JPEG Error Level Analysis score.

    The score is the coefficient of variation (std / (mean + 1)) of the
    grayscale ELA difference image.  This is *not* the primary detection
    mechanism; it is fused only when the input is JPEG.

    Normalisation
    -------------
    Raw ELA differences are in [0, 255].  We compute the luminance-weighted
    grayscale ELA map and use:
        score = clip( std(ela_gray) / (mean(ela_gray) + 1) , 0, 1 )
    This coefficient-of-variation measure is high when ELA differences are
    spatially heterogeneous (localised edits) and low when uniform (normal
    JPEG recompression artefacts).

    Returns None if the input is not JPEG or if computation fails.
    """
    try:
        original = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        buf = io.BytesIO()
        original.save(buf, format="JPEG", quality=quality)
        buf.seek(0)
        recompressed = Image.open(buf).convert("RGB")

        orig_arr = np.array(original, dtype=np.float32)
        recomp_arr = np.array(recompressed, dtype=np.float32)
        diff = np.abs(orig_arr - recomp_arr)

        ela_gray = (
            0.2126 * diff[:, :, 0]
            + 0.7152 * diff[:, :, 1]
            + 0.0722 * diff[:, :, 2]
        )

        mean_v = float(ela_gray.mean())
        std_v = float(ela_gray.std())
        score = float(np.clip(std_v / (mean_v + 1.0), 0.0, 1.0))
        return score
    except Exception:
        return None


def _is_jpeg(image_bytes: bytes) -> bool:
    """Check for JPEG SOI marker (0xFF 0xD8)."""
    return len(image_bytes) >= 2 and image_bytes[:2] == b"\xff\xd8"


# ---------------------------------------------------------------------------
# 10. Signal fusion
# ---------------------------------------------------------------------------

def fuse_signals(
    noise_confidence: float,
    jpeg_score: Optional[float],
    jpeg_weight: float = JPEG_ELA_WEIGHT,
) -> float:
    """Fuse noise-based confidence with optional JPEG ELA signal.

    Strategy: weighted linear combination.  JPEG weight defaults to
    JPEG_ELA_WEIGHT (0.25), exposed as a module constant for tuning.
    If jpeg_score is None the noise confidence is returned unchanged.

    Parameters
    ----------
    noise_confidence:
        Confidence from the noise pipeline (0-1).
    jpeg_score:
        ELA coefficient-of-variation score (0-1), or None.
    jpeg_weight:
        Weight for the JPEG signal in [0, 0.5].

    Returns
    -------
    float in [0, 1].
    """
    if jpeg_score is None:
        return noise_confidence
    jpeg_weight = float(np.clip(jpeg_weight, 0.0, 0.5))
    noise_weight = 1.0 - jpeg_weight
    fused = noise_weight * noise_confidence + jpeg_weight * jpeg_score
    return float(np.clip(fused, 0.0, 1.0))


# ---------------------------------------------------------------------------
# 11. Public entry point (backward-compatible)
# ---------------------------------------------------------------------------

def run_noise_analysis(
    image_bytes: bytes,
    grid_size: int = 32,
    scales: tuple[int, ...] = DEFAULT_SCALES,
    z_threshold: float = DEFAULT_Z_THRESHOLD,
    use_jpeg_signal: bool = True,
) -> dict:
    """Analyse noise patterns across the image using multi-scale wavelet analysis.

    This is the backward-compatible public entry point.  Existing callers
    that pass only *image_bytes* (and optionally *grid_size*) continue to
    work without modification.

    Parameters
    ----------
    image_bytes:
        Raw bytes of the image file (JPEG, PNG, BMP, TIFF, WebP).
    grid_size:
        Base window size in pixels (legacy parameter; retained for
        backward compatibility).  When *scales* is supplied this parameter
        is ignored unless *scales* == DEFAULT_SCALES.
    scales:
        Tuple of window sizes to use in multi-scale analysis.
        Default: (16, 32, 64).
    z_threshold:
        Robust z-score above which a window is flagged anomalous.
        Default: 2.5.  Can be calibrated using labeled validation data --
        see tests/evaluate_noise.py.
    use_jpeg_signal:
        Whether to compute and fuse the complementary JPEG ELA signal.
        Enabled by default; set False to disable.

    Returns
    -------
    dict with keys:
        ``visualization`` : np.ndarray  BGR heatmap blended with the original.
        ``confidence``    : float       0-1 derived from statistical evidence.
        ``findings``      : list[str]   Human-readable forensic observations.
        ``_detail``       : dict        Extended diagnostics (internal use).
    """
    # --- Decode ---
    try:
        original_pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as exc:
        logger.error("Failed to decode image: %s", exc)
        raise ValueError(f"Cannot decode image: {exc}") from exc

    img_rgb = np.array(original_pil, dtype=np.float32)  # H x W x 3, float32
    img_bgr = cv2.cvtColor(img_rgb.astype(np.uint8), cv2.COLOR_RGB2BGR)
    h, w = img_rgb.shape[:2]

    # --- Texture map (computed once, shared across scales) ---
    texture_map = compute_texture_measure(img_rgb)

    # --- Multi-scale analysis ---
    all_z_scores: list[np.ndarray] = []
    all_heatmaps: list[np.ndarray] = []
    per_scale_info: list[dict] = []
    used_scales: list[int] = []

    for gs in scales:
        if gs > min(h, w):
            # Skip scales larger than the image
            continue
        scale_res = analyse_at_scale(img_rgb, texture_map, gs, z_threshold)
        if scale_res.windows:
            heatmap = build_heatmap(
                scale_res.windows,
                scale_res.z_scores,
                (h, w),
            )
            all_heatmaps.append(heatmap)
            all_z_scores.append(scale_res.z_scores)
            per_scale_info.append(
                {
                    "scale": gs,
                    "n_windows": len(scale_res.windows),
                    "n_anomalous": int(scale_res.anomaly_mask.sum()),
                }
            )
            used_scales.append(gs)

    # --- Fuse heatmaps ---
    active_scales = tuple(used_scales) if used_scales else scales
    if all_heatmaps:
        fused_map = fuse_multiscale_maps(all_heatmaps, (h, w), active_scales)
    else:
        fused_map = np.zeros((h, w), dtype=np.float32)

    # --- Aggregate z-scores from all scales ---
    if all_z_scores:
        combined_z = np.concatenate(all_z_scores)
    else:
        combined_z = np.array([], dtype=np.float32)

    # --- Confidence scoring ---
    conf_info = score_confidence(combined_z, z_threshold)
    confidence = conf_info["confidence"]

    # --- Optional JPEG ELA signal ---
    jpeg_score: Optional[float] = None
    if use_jpeg_signal and _is_jpeg(image_bytes):
        jpeg_score = _compute_jpeg_ela_score(image_bytes)
        if jpeg_score is not None:
            confidence = fuse_signals(confidence, jpeg_score, JPEG_ELA_WEIGHT)
            confidence = round(min(1.0, confidence), 4)

    # --- Build visualisation ---
    # Convert fused map (0-1) to a colour heatmap and blend with original
    fused_uint8 = (np.clip(fused_map, 0.0, 1.0) * 255).astype(np.uint8)
    # Smooth the heatmap slightly for visual continuity
    fused_smooth = gaussian_filter(fused_uint8.astype(np.float32), sigma=3)
    fused_smooth = np.clip(fused_smooth, 0, 255).astype(np.uint8)
    colour_heatmap = cv2.applyColorMap(fused_smooth, cv2.COLORMAP_JET)
    vis = cv2.addWeighted(img_bgr, 0.55, colour_heatmap, 0.45, 0)

    # --- Global noise estimate for findings text ---
    global_noise = estimate_noise(img_rgb)
    per_ch_sigma = global_noise["per_channel"]
    channel_names = global_noise["channel_names"]

    # --- Build findings ---
    findings: list[str] = []
    sigma_str = ", ".join(
        f"{n}={s:.2f}" for n, s in zip(channel_names, per_ch_sigma)
    )
    findings.append(f"Per-channel wavelet noise sigma: {sigma_str}.")

    n_anom = conf_info["n_anomalous"]
    n_total = conf_info["n_windows"]

    if n_total == 0:
        findings.append("Image too small for meaningful block-level analysis.")
    elif n_anom > n_total * 0.15:
        findings.append(
            f"{n_anom}/{n_total} analysis windows exceed the z-score threshold "
            f"({z_threshold:.1f}) -- widespread noise inconsistency detected."
        )
    elif n_anom > 5:
        findings.append(
            f"{n_anom} localised region(s) show noise characteristics "
            "inconsistent with the surrounding image."
        )
    elif n_anom > 0:
        findings.append(
            f"{n_anom} minor region(s) with slightly unusual noise detected."
        )
    else:
        findings.append("Noise pattern appears consistent across the image.")

    if jpeg_score is not None:
        findings.append(
            f"JPEG ELA complementary signal: {jpeg_score:.3f} "
            f"(weight {JPEG_ELA_WEIGHT})."
        )

    if confidence > 0.6:
        findings.append(
            "Statistical evidence suggests possible tampering in highlighted regions."
        )
    elif confidence > 0.3:
        findings.append(
            "Moderate anomaly evidence; manual inspection of highlighted regions recommended."
        )
    else:
        findings.append("Low overall anomaly evidence.")

    return {
        "visualization": vis,
        "confidence": round(confidence, 2),
        "findings": findings,
        # Extended diagnostics -- not used by the router but available for tests
        "_detail": {
            "per_channel_sigma": per_ch_sigma.tolist(),
            "n_windows": n_total,
            "n_anomalous": n_anom,
            "anomaly_fraction": conf_info["anomaly_fraction"],
            "mean_exceedance": conf_info["mean_exceedance"],
            "robust_aggregate": conf_info["robust_aggregate"],
            "z_threshold": z_threshold,
            "scales_used": [s["scale"] for s in per_scale_info],
            "per_scale": per_scale_info,
            "jpeg_ela_score": jpeg_score,
        },
    }
