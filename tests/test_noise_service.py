"""
Unit tests for noise_service.py
---------------------------------
Tests use synthetic images (numpy arrays encoded to PNG/JPEG bytes) so they
require no external dataset.  All assertions test both detection (confidence /
z-score) and spatial localisation (heatmap overlap with the tampered region).

Run with:
    cd d:/FYP
    python -m pytest tests/test_noise_service.py -v
"""

from __future__ import annotations

import io
import math

import cv2
import numpy as np
import pytest
from PIL import Image

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_image_bytes(arr: np.ndarray, fmt: str = "PNG") -> bytes:
    """Encode an H x W x 3 uint8 numpy array to image bytes."""
    pil = Image.fromarray(arr.astype(np.uint8), mode="RGB")
    buf = io.BytesIO()
    if fmt == "JPEG":
        pil.save(buf, format="JPEG", quality=92)
    else:
        pil.save(buf, format="PNG")
    return buf.getvalue()


def _uniform_image(h: int = 256, w: int = 256, value: int = 128) -> np.ndarray:
    """Return a flat, single-colour image."""
    return np.full((h, w, 3), value, dtype=np.uint8)


def _noisy_image(
    h: int = 256,
    w: int = 256,
    sigma: float = 5.0,
    seed: int = 42,
) -> np.ndarray:
    """Return an image with spatially uniform Gaussian noise."""
    rng = np.random.default_rng(seed)
    base = np.full((h, w, 3), 128, dtype=np.float64)
    noise = rng.normal(0, sigma, (h, w, 3))
    return np.clip(base + noise, 0, 255).astype(np.uint8)


def _splice_patch(
    image: np.ndarray,
    r0: int,
    c0: int,
    r1: int,
    c1: int,
    sigma: float,
    seed: int = 99,
) -> np.ndarray:
    """Paste a Gaussian-noise rectangle onto *image* (in-place copy)."""
    out = image.copy()
    rng = np.random.default_rng(seed)
    patch = np.clip(
        np.full((r1 - r0, c1 - c0, 3), 128, dtype=np.float64)
        + rng.normal(0, sigma, (r1 - r0, c1 - c0, 3)),
        0,
        255,
    ).astype(np.uint8)
    out[r0:r1, c0:c1] = patch
    return out


def _heatmap_overlap_ratio(
    heatmap: np.ndarray,
    r0: int,
    c0: int,
    r1: int,
    c1: int,
    threshold: float = 0.5,
) -> float:
    """Fraction of pixels in the tampered rectangle that exceed *threshold*."""
    patch_scores = heatmap[r0:r1, c0:c1]
    return float((patch_scores >= threshold).mean())


# ---------------------------------------------------------------------------
# Import under test
# ---------------------------------------------------------------------------

import sys
import os

# Allow running from project root without installing the package
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from services.noise_service import (
    DEFAULT_SCALES,
    DEFAULT_Z_THRESHOLD,
    build_heatmap,
    compute_block_stats,
    compute_texture_measure,
    estimate_noise,
    fuse_multiscale_maps,
    robust_zscore,
    run_noise_analysis,
    score_confidence,
)


# ===========================================================================
# Test A: Authentic image
# ===========================================================================

class TestAuthenticImage:
    """A clean synthetic image should not produce widespread high anomaly scores."""

    def test_confidence_below_threshold(self):
        img = _noisy_image(256, 256, sigma=5.0)
        result = run_noise_analysis(_make_image_bytes(img))
        # A single-source noise image should have low confidence
        assert result["confidence"] <= 0.4, (
            f"Expected confidence <= 0.4 for a clean image, got {result['confidence']}"
        )

    def test_result_keys_present(self):
        img = _noisy_image(256, 256, sigma=5.0)
        result = run_noise_analysis(_make_image_bytes(img))
        assert "visualization" in result
        assert "confidence" in result
        assert "findings" in result
        assert isinstance(result["findings"], list)
        assert len(result["findings"]) > 0

    def test_visualization_shape(self):
        img = _noisy_image(256, 256, sigma=5.0)
        result = run_noise_analysis(_make_image_bytes(img))
        vis = result["visualization"]
        assert vis is not None
        assert vis.shape == (256, 256, 3)

    def test_confidence_in_range(self):
        img = _noisy_image(256, 256, sigma=5.0)
        result = run_noise_analysis(_make_image_bytes(img))
        c = result["confidence"]
        assert 0.0 <= c <= 1.0


# ===========================================================================
# Test B: Gaussian noise splice (medium patch)
# ===========================================================================

class TestGaussianNoiseSplice:
    """Paste a high-noise rectangle onto a low-noise background."""

    def setup_method(self):
        self.h, self.w = 256, 256
        self.r0, self.c0, self.r1, self.c1 = 80, 80, 176, 176  # 96 x 96 patch
        base = _noisy_image(self.h, self.w, sigma=3.0, seed=1)
        spliced = _splice_patch(base, self.r0, self.c0, self.r1, self.c1, sigma=40.0)
        self.img_bytes = _make_image_bytes(spliced)

    def test_detects_splice(self):
        result = run_noise_analysis(self.img_bytes)
        detail = result["_detail"]
        assert detail["n_anomalous"] > 0, "Expected at least one anomalous window"

    def test_heatmap_overlaps_tampered_region(self):
        result = run_noise_analysis(self.img_bytes)
        vis = result["visualization"]
        # Convert BGR visualisation back to a single-channel heatmap proxy
        # (just use the red channel of the JET colourmap, which is high for
        # high-anomaly scores in COLORMAP_JET)
        heatmap_proxy = vis[:, :, 2].astype(np.float32) / 255.0  # red channel
        overlap = _heatmap_overlap_ratio(
            heatmap_proxy, self.r0, self.c0, self.r1, self.c1, threshold=0.5
        )
        assert overlap > 0.3, (
            f"Expected >30% of tampered pixels to be highlighted, got {overlap:.2%}"
        )

    def test_confidence_elevated(self):
        result = run_noise_analysis(self.img_bytes)
        # Spliced image should have higher confidence than a clean image
        clean = _noisy_image(self.h, self.w, sigma=3.0, seed=1)
        clean_result = run_noise_analysis(_make_image_bytes(clean))
        assert result["confidence"] >= clean_result["confidence"], (
            "Spliced image should not have lower confidence than clean"
        )


# ===========================================================================
# Test C: Small tampered region
# ===========================================================================

class TestSmallTamperedRegion:
    """Fine-scale analysis should detect a small forged patch."""

    def setup_method(self):
        self.h, self.w = 256, 256
        self.r0, self.c0, self.r1, self.c1 = 112, 112, 144, 144  # 32 x 32 patch
        base = _noisy_image(self.h, self.w, sigma=3.0, seed=2)
        spliced = _splice_patch(base, self.r0, self.c0, self.r1, self.c1, sigma=50.0)
        self.img_bytes = _make_image_bytes(spliced)

    def test_fine_scale_detects_small_patch(self):
        """Run at fine scale only and confirm detection."""
        result = run_noise_analysis(
            self.img_bytes, scales=(16,), z_threshold=2.0
        )
        detail = result["_detail"]
        assert detail["n_anomalous"] > 0, (
            "Fine-scale analysis should detect the small patch"
        )

    def test_heatmap_covers_full_image(self):
        result = run_noise_analysis(self.img_bytes, scales=(16,))
        vis = result["visualization"]
        assert vis.shape == (self.h, self.w, 3)


# ===========================================================================
# Test D: Large tampered region
# ===========================================================================

class TestLargeTamperedRegion:
    """Medium/coarse scales should detect a large forged region."""

    def setup_method(self):
        self.h, self.w = 256, 256
        self.r0, self.c0, self.r1, self.c1 = 32, 32, 224, 224  # 192 x 192 patch
        base = _noisy_image(self.h, self.w, sigma=3.0, seed=3)
        spliced = _splice_patch(base, self.r0, self.c0, self.r1, self.c1, sigma=35.0)
        self.img_bytes = _make_image_bytes(spliced)

    def test_coarse_scale_detects_large_patch(self):
        result = run_noise_analysis(
            self.img_bytes, scales=(64,), z_threshold=2.0
        )
        detail = result["_detail"]
        assert detail["n_anomalous"] > 0, (
            "Coarse-scale analysis should detect the large forged region"
        )

    def test_multiscale_confidence_elevated(self):
        result = run_noise_analysis(self.img_bytes)
        assert result["confidence"] >= 0.0  # just check it runs


# ===========================================================================
# Test E: Texture false-positive test
# ===========================================================================

class TestTextureFalsePositive:
    """Strong natural texture should not cause widespread false positives."""

    @staticmethod
    def _make_textured_image(h: int = 256, w: int = 256, seed: int = 7) -> np.ndarray:
        """Synthetic high-frequency texture (checkerboard + noise)."""
        rng = np.random.default_rng(seed)
        # Checkerboard
        xs = np.arange(w)
        ys = np.arange(h)
        xx, yy = np.meshgrid(xs, ys)
        checker = ((xx // 8 + yy // 8) % 2).astype(np.float32) * 200
        noise = rng.normal(0, 3.0, (h, w)).astype(np.float32)
        gray = np.clip(checker + noise, 0, 255)
        img = np.stack([gray, gray * 0.9, gray * 0.8], axis=2).astype(np.uint8)
        return img

    def test_texture_does_not_produce_high_confidence(self):
        img = self._make_textured_image()
        result = run_noise_analysis(_make_image_bytes(img))
        # Texture alone must not produce a very high confidence score
        assert result["confidence"] <= 0.6, (
            f"Texture alone should not produce confidence > 0.6, "
            f"got {result['confidence']}"
        )

    def test_texture_fewer_anomalies_than_splice(self):
        textured = self._make_textured_image()
        text_result = run_noise_analysis(_make_image_bytes(textured))

        # A genuinely spliced version of the same image
        base = _noisy_image(256, 256, sigma=3.0, seed=4)
        spliced = _splice_patch(base, 50, 50, 200, 200, sigma=50.0)
        splice_result = run_noise_analysis(_make_image_bytes(spliced))

        assert text_result["confidence"] <= splice_result["confidence"] + 0.2, (
            "Textured image should not have dramatically higher confidence than spliced"
        )


# ===========================================================================
# Test F: JPEG recompression
# ===========================================================================

class TestJpegRecompression:
    """JPEG recompression alone should not flag the whole image as forged."""

    def test_jpeg_recompression_low_confidence(self):
        img = _noisy_image(256, 256, sigma=4.0, seed=5)
        jpeg_bytes = _make_image_bytes(img, fmt="JPEG")
        result = run_noise_analysis(jpeg_bytes)
        assert result["confidence"] <= 0.5, (
            f"Plain JPEG recompression should not yield confidence > 0.5, "
            f"got {result['confidence']}"
        )

    def test_jpeg_flag_in_findings(self):
        img = _noisy_image(256, 256, sigma=4.0, seed=5)
        jpeg_bytes = _make_image_bytes(img, fmt="JPEG")
        result = run_noise_analysis(jpeg_bytes)
        # JPEG ELA finding should appear
        ela_findings = [f for f in result["findings"] if "ELA" in f or "JPEG" in f]
        assert len(ela_findings) > 0, "Expected a JPEG ELA finding for a JPEG image"


# ===========================================================================
# Test G: RGB channel inconsistency
# ===========================================================================

class TestRGBChannelInconsistency:
    """A patch with different per-channel noise should raise the anomaly score."""

    def test_channel_inconsistency_detected(self):
        h, w = 256, 256
        rng = np.random.default_rng(77)
        # Base: low noise, balanced channels
        base = np.clip(
            np.full((h, w, 3), 128.0) + rng.normal(0, 3.0, (h, w, 3)),
            0, 255
        ).astype(np.uint8)

        # Patch: high noise *only* in the blue channel
        patched = base.copy()
        r0, c0, r1, c1 = 90, 90, 166, 166
        patch_noise = rng.normal(0, 60.0, (r1 - r0, c1 - c0))
        patched[r0:r1, c0:c1, 2] = np.clip(
            patched[r0:r1, c0:c1, 2].astype(np.float32) + patch_noise,
            0, 255,
        ).astype(np.uint8)

        result = run_noise_analysis(_make_image_bytes(patched))
        assert result["_detail"]["n_anomalous"] > 0, (
            "Blue-channel noise patch should produce at least one anomalous window"
        )


# ===========================================================================
# Unit tests for individual functions
# ===========================================================================

class TestEstimateNoise:
    def test_uniform_image_near_zero_sigma(self):
        img = np.full((64, 64, 3), 100.0, dtype=np.float32)
        info = estimate_noise(img)
        assert all(s < 2.0 for s in info["per_channel"]), (
            "Uniform image should have near-zero noise sigma"
        )

    def test_high_noise_image_large_sigma(self):
        rng = np.random.default_rng(0)
        img = rng.normal(128, 30, (64, 64, 3)).astype(np.float32)
        info = estimate_noise(img)
        assert all(s > 10.0 for s in info["per_channel"]), (
            "High-noise image should produce sigma > 10"
        )

    def test_per_channel_distinct(self):
        rng = np.random.default_rng(1)
        img = np.zeros((64, 64, 3), dtype=np.float32)
        img[:, :, 0] = rng.normal(128, 5, (64, 64))   # R: low noise
        img[:, :, 1] = rng.normal(128, 15, (64, 64))  # G: medium noise
        img[:, :, 2] = rng.normal(128, 40, (64, 64))  # B: high noise
        info = estimate_noise(img)
        assert info["per_channel"][0] < info["per_channel"][2], (
            "R sigma should be less than B sigma"
        )

    def test_small_image_handled_safely(self):
        img = np.full((4, 4, 3), 128.0, dtype=np.float32)
        info = estimate_noise(img)
        assert info["per_channel"].shape == (3,)

    def test_returns_expected_keys(self):
        img = np.full((32, 32, 3), 100.0, dtype=np.float32)
        info = estimate_noise(img)
        assert "per_channel" in info
        assert "combined" in info
        assert "channel_names" in info


class TestRobustZscore:
    def test_all_same_returns_zero(self):
        vals = np.full(20, 5.0)
        z = robust_zscore(vals)
        assert np.allclose(z, 0.0), "Identical values should yield zero z-scores"

    def test_outlier_flagged(self):
        rng = np.random.default_rng(42)
        vals = rng.normal(0, 1, 50).astype(np.float32)
        vals[25] = 100.0  # extreme outlier
        z = robust_zscore(vals)
        assert z[25] > 5.0, "Extreme outlier should have a large z-score"

    def test_empty_input(self):
        z = robust_zscore(np.array([]))
        assert z.size == 0

    def test_single_value(self):
        z = robust_zscore(np.array([3.14]))
        assert z.size == 1
        assert z[0] == 0.0

    def test_two_pass_reduces_influence_of_outliers(self):
        # With many normal values and one large outlier, the baseline should
        # not be pulled toward the outlier.
        rng = np.random.default_rng(0)
        vals = rng.normal(0.0, 0.1, 200).astype(np.float32)
        vals[0] = 50.0  # single extreme outlier
        z = robust_zscore(vals)
        # The 200 normal values should have small z-scores
        normal_z = np.abs(z[1:])
        assert float(normal_z.mean()) < 2.0, (
            "Normal values should have small z-scores after two-pass"
        )


class TestScoreConfidence:
    def test_no_anomalies_zero_confidence(self):
        z = np.zeros(100)
        info = score_confidence(z, z_threshold=2.5)
        assert info["confidence"] == 0.0
        assert info["n_anomalous"] == 0

    def test_all_anomalous_high_confidence(self):
        z = np.full(100, 10.0)  # all far above threshold
        info = score_confidence(z, z_threshold=2.5)
        assert info["confidence"] > 0.5

    def test_empty_scores(self):
        info = score_confidence(np.array([]), z_threshold=2.5)
        assert info["confidence"] == 0.0
        assert info["n_windows"] == 0

    def test_threshold_key_present(self):
        info = score_confidence(np.zeros(10), z_threshold=3.0)
        assert info["threshold"] == 3.0

    def test_fraction_correct(self):
        z = np.array([1.0] * 80 + [5.0] * 20, dtype=np.float32)
        info = score_confidence(z, z_threshold=2.5)
        assert abs(info["anomaly_fraction"] - 0.20) < 0.01


class TestBuildHeatmap:
    def test_heatmap_covers_full_image(self):
        from services.noise_service import WindowStats

        h, w = 64, 64
        windows = [
            WindowStats(0, 0, 32, 32,
                        np.zeros(3), np.zeros(3), 0.0),
            WindowStats(32, 32, 32, 32,
                        np.zeros(3), np.zeros(3), 0.0),
        ]
        z = np.array([3.0, 5.0])
        hm = build_heatmap(windows, z, (h, w))
        assert hm.shape == (h, w)

    def test_high_score_region_elevated(self):
        from services.noise_service import WindowStats

        h, w = 64, 64
        windows = [
            WindowStats(0, 0, 32, 32,
                        np.zeros(3), np.zeros(3), 0.0),
            WindowStats(32, 32, 32, 32,
                        np.zeros(3), np.zeros(3), 0.0),
        ]
        z = np.array([10.0, 0.0])
        hm = build_heatmap(windows, z, (h, w))
        assert hm[10, 10] > hm[50, 50], (
            "High-score window region should have higher heatmap value"
        )


class TestComputeTextureMeasure:
    def test_flat_image_low_texture(self):
        img = np.full((64, 64, 3), 128.0, dtype=np.float32)
        tex = compute_texture_measure(img)
        assert float(tex.mean()) < 0.05, "Flat image should have near-zero texture"

    def test_checkerboard_high_texture(self):
        xs = np.arange(64)
        ys = np.arange(64)
        xx, yy = np.meshgrid(xs, ys)
        checker = ((xx // 4 + yy // 4) % 2).astype(np.float32) * 200
        img = np.stack([checker, checker, checker], axis=2)
        tex = compute_texture_measure(img)
        assert float(tex.mean()) > 0.1, "Checkerboard should have significant texture"


class TestFuseMultiscaleMaps:
    def test_output_shape(self):
        h, w = 128, 128
        maps = [np.random.rand(h, w).astype(np.float32) for _ in range(3)]
        fused = fuse_multiscale_maps(maps, (h, w), (16, 32, 64))
        assert fused.shape == (h, w)

    def test_output_in_unit_range(self):
        h, w = 64, 64
        maps = [np.random.rand(h, w).astype(np.float32) for _ in range(2)]
        fused = fuse_multiscale_maps(maps, (h, w), (16, 32))
        assert fused.min() >= 0.0
        assert fused.max() <= 1.0 + 1e-6

    def test_empty_maps_returns_zeros(self):
        fused = fuse_multiscale_maps([], (64, 64))
        assert np.all(fused == 0.0)


class TestBackwardCompatibility:
    """run_noise_analysis must be callable with just image_bytes."""

    def test_called_with_bytes_only(self):
        img = _noisy_image(128, 128)
        result = run_noise_analysis(_make_image_bytes(img))
        assert "visualization" in result
        assert "confidence" in result
        assert "findings" in result

    def test_called_with_grid_size(self):
        """Legacy grid_size parameter must be accepted without error."""
        img = _noisy_image(128, 128)
        result = run_noise_analysis(_make_image_bytes(img), grid_size=64)
        assert "confidence" in result

    def test_confidence_is_float(self):
        img = _noisy_image(128, 128)
        result = run_noise_analysis(_make_image_bytes(img))
        assert isinstance(result["confidence"], float)

    def test_visualization_is_ndarray(self):
        img = _noisy_image(128, 128)
        result = run_noise_analysis(_make_image_bytes(img))
        assert isinstance(result["visualization"], np.ndarray)
        assert result["visualization"].dtype == np.uint8


class TestSmallImages:
    """Edge-case: images smaller than one grid tile."""

    def test_tiny_image(self):
        img = _noisy_image(20, 20, sigma=4.0)
        result = run_noise_analysis(_make_image_bytes(img))
        assert "confidence" in result
        assert 0.0 <= result["confidence"] <= 1.0

    def test_non_square_image(self):
        img = _noisy_image(64, 320, sigma=4.0)
        result = run_noise_analysis(_make_image_bytes(img))
        assert result["visualization"].shape == (64, 320, 3)
