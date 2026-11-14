"""
Evaluation Harness for noise_service.py
-----------------------------------------
Evaluates the noise-based forgery detector against a labeled dataset.

Dataset structure expected
--------------------------
<dataset_root>/
    authentic/
        img001.jpg
        img002.png
        ...
    tampered/
        img001.jpg
        img002.png
        ...
    masks/           (optional -- ground-truth binary tamper masks)
        img001.png
        img002.png
        ...

Labels:
  authentic/ -> label 0
  tampered/  -> label 1

Masks (if present) should be grayscale images where 255 = tampered pixel.

Usage
-----
    # Basic image-level evaluation
    python tests/evaluate_noise.py --dataset /path/to/dataset

    # With mask-level localisation evaluation
    python tests/evaluate_noise.py --dataset /path/to/dataset --masks

    # Threshold calibration on a validation split
    python tests/evaluate_noise.py --dataset /path/to/dataset --calibrate

    # Custom threshold
    python tests/evaluate_noise.py --dataset /path/to/dataset --threshold 3.0

Note on overfitting
-------------------
If --calibrate is used, the threshold is selected on the calibration split
(20% of each class by default) and then applied to the remaining test split.
Do NOT run calibration and evaluation on exactly the same images.

Metrics reported
----------------
Image-level:
  ROC AUC, accuracy, precision, recall, F1 at the selected threshold.
Pixel-level (if masks provided):
  IoU, precision, recall of the heatmap against the ground-truth mask
  at a configurable heatmap threshold.

Dependencies
------------
  numpy, opencv-python-headless, scikit-learn (for AUC / ROC)
  Add scikit-learn to requirements.txt if not already present.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

# Allow import from src/ when running from project root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from services.noise_service import DEFAULT_Z_THRESHOLD, run_noise_analysis

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


# ---------------------------------------------------------------------------
# Dataset loading
# ---------------------------------------------------------------------------

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"}


def _collect_image_paths(directory: Path) -> list[Path]:
    """Return sorted list of image file paths in *directory*."""
    paths = [
        p
        for p in directory.iterdir()
        if p.suffix.lower() in IMAGE_EXTENSIONS and p.is_file()
    ]
    return sorted(paths)


def load_dataset(
    dataset_root: Path,
    masks_dir: Optional[Path] = None,
) -> tuple[list[dict], list[dict]]:
    """Load authentic and tampered image paths from the dataset directory.

    Returns
    -------
    authentic_items, tampered_items
        Each item is a dict:
          ``path``  : Path to image file
          ``label`` : 0 (authentic) or 1 (tampered)
          ``mask``  : Path to ground-truth mask or None
    """
    auth_dir = dataset_root / "authentic"
    tamp_dir = dataset_root / "tampered"

    if not auth_dir.is_dir():
        raise FileNotFoundError(f"authentic/ directory not found in {dataset_root}")
    if not tamp_dir.is_dir():
        raise FileNotFoundError(f"tampered/ directory not found in {dataset_root}")

    def _build_items(directory: Path, label: int) -> list[dict]:
        items = []
        for img_path in _collect_image_paths(directory):
            mask_path: Optional[Path] = None
            if masks_dir is not None and masks_dir.is_dir():
                # Try same stem with .png extension
                candidate = masks_dir / (img_path.stem + ".png")
                if candidate.exists():
                    mask_path = candidate
            items.append({"path": img_path, "label": label, "mask": mask_path})
        return items

    authentic_items = _build_items(auth_dir, 0)
    tampered_items = _build_items(tamp_dir, 1)

    logger.info(
        "Dataset: %d authentic, %d tampered images.",
        len(authentic_items),
        len(tampered_items),
    )
    return authentic_items, tampered_items


# ---------------------------------------------------------------------------
# Evaluation helpers
# ---------------------------------------------------------------------------

def run_detector(
    img_path: Path,
    z_threshold: float = DEFAULT_Z_THRESHOLD,
) -> dict:
    """Run run_noise_analysis on one image and return the result dict."""
    with open(img_path, "rb") as fh:
        image_bytes = fh.read()
    return run_noise_analysis(image_bytes, z_threshold=z_threshold)


def _heatmap_from_result(result: dict, h: int, w: int) -> np.ndarray:
    """Extract a grayscale float32 heatmap from the visualisation BGR image.

    We derive the heatmap proxy from the visualisation's red channel (high in
    COLORMAP_JET = high anomaly score).  This is a proxy; a better approach
    would be to expose the raw heatmap from run_noise_analysis, but that
    would require a signature change.
    """
    vis = result["visualization"]  # H x W x 3 BGR
    if vis is None:
        return np.zeros((h, w), dtype=np.float32)
    # Resize if needed
    if vis.shape[:2] != (h, w):
        vis = cv2.resize(vis, (w, h))
    # Red channel in BGR = vis[:,:,2]
    red_ch = vis[:, :, 2].astype(np.float32) / 255.0
    return red_ch


def evaluate_pixel_level(
    heatmap: np.ndarray,
    mask: np.ndarray,
    heatmap_threshold: float = 0.5,
) -> dict:
    """Compute pixel-level IoU, precision, and recall.

    Parameters
    ----------
    heatmap:
        H x W float32 heatmap (0-1).
    mask:
        H x W uint8 ground-truth mask (255 = tampered, 0 = authentic).
    heatmap_threshold:
        Binarisation threshold for the heatmap.

    Returns
    -------
    dict with ``iou``, ``precision``, ``recall``.
    """
    pred = (heatmap >= heatmap_threshold).astype(np.uint8)
    gt = (mask > 127).astype(np.uint8)

    tp = int(np.logical_and(pred, gt).sum())
    fp = int(np.logical_and(pred, np.logical_not(gt)).sum())
    fn = int(np.logical_and(np.logical_not(pred), gt).sum())

    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    iou = tp / max(tp + fp + fn, 1)

    return {"iou": round(iou, 4), "precision": round(precision, 4), "recall": round(recall, 4)}


def _split_stratified(
    items: list[dict], calib_fraction: float = 0.2, seed: int = 0
) -> tuple[list[dict], list[dict]]:
    """Split *items* into calibration and test subsets."""
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(items))
    n_calib = max(1, int(len(items) * calib_fraction))
    calib_idx = idx[:n_calib]
    test_idx = idx[n_calib:]
    return [items[i] for i in calib_idx], [items[i] for i in test_idx]


def calibrate_threshold(
    authentic_calib: list[dict],
    tampered_calib: list[dict],
    candidate_thresholds: Optional[list[float]] = None,
) -> float:
    """Select the z-score threshold that maximises F1 on the calibration split.

    The metric optimised is the macro-average F1 across both classes.
    The dataset split used is the calibration fraction (default 20%).
    The selected threshold is then applied to the held-out test split.

    Warning: do NOT calibrate and evaluate on the same images.

    Returns
    -------
    Best z-score threshold (float).
    """
    if candidate_thresholds is None:
        candidate_thresholds = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0]

    best_f1 = -1.0
    best_thresh = DEFAULT_Z_THRESHOLD

    for thresh in candidate_thresholds:
        scores = []
        labels = []
        for item in authentic_calib + tampered_calib:
            try:
                res = run_detector(item["path"], z_threshold=thresh)
                scores.append(res["confidence"])
                labels.append(item["label"])
            except Exception as exc:
                logger.warning("Skipping %s: %s", item["path"], exc)

        if not scores:
            continue

        scores_arr = np.array(scores)
        labels_arr = np.array(labels)

        # Binary classification: confidence > 0.5 -> tampered
        preds = (scores_arr > 0.5).astype(int)
        tp = int(np.sum((preds == 1) & (labels_arr == 1)))
        fp = int(np.sum((preds == 1) & (labels_arr == 0)))
        fn = int(np.sum((preds == 0) & (labels_arr == 1)))

        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        f1 = 2 * precision * recall / max(precision + recall, 1e-8)

        logger.info("Calibration z_thresh=%.1f: F1=%.4f", thresh, f1)

        if f1 > best_f1:
            best_f1 = f1
            best_thresh = thresh

    logger.info("Selected threshold: %.1f (calibration F1=%.4f)", best_thresh, best_f1)
    return best_thresh


# ---------------------------------------------------------------------------
# Main evaluation
# ---------------------------------------------------------------------------

def evaluate(
    dataset_root: Path,
    masks_dir: Optional[Path] = None,
    z_threshold: float = DEFAULT_Z_THRESHOLD,
    heatmap_threshold: float = 0.5,
    calibrate: bool = False,
    calib_fraction: float = 0.2,
    output_file: Optional[Path] = None,
) -> dict:
    """Run the full evaluation pipeline.

    Parameters
    ----------
    dataset_root:
        Root directory containing authentic/ and tampered/ subdirectories.
    masks_dir:
        Optional directory with ground-truth binary masks (same stem as tampered images).
    z_threshold:
        Z-score threshold (overridden by calibration if *calibrate* is True).
    heatmap_threshold:
        Pixel-level binarisation threshold for IoU computation.
    calibrate:
        If True, optimise the threshold on the calibration split before evaluating.
    calib_fraction:
        Fraction of images used for calibration (not evaluated).
    output_file:
        If provided, write a JSON summary to this path.

    Returns
    -------
    dict with evaluation metrics.
    """
    try:
        from sklearn.metrics import roc_auc_score, roc_curve
        _has_sklearn = True
    except ImportError:
        _has_sklearn = False
        logger.warning("scikit-learn not found -- ROC/AUC will be skipped.")

    authentic_items, tampered_items = load_dataset(dataset_root, masks_dir)

    if calibrate:
        auth_calib, auth_test = _split_stratified(authentic_items, calib_fraction)
        tamp_calib, tamp_test = _split_stratified(tampered_items, calib_fraction)
        logger.info(
            "Calibration split: %d authentic + %d tampered",
            len(auth_calib), len(tamp_calib),
        )
        z_threshold = calibrate_threshold(auth_calib, tamp_calib)
        test_items = auth_test + tamp_test
        logger.info(
            "Test split: %d images (threshold=%.2f)", len(test_items), z_threshold
        )
    else:
        test_items = authentic_items + tampered_items

    # --- Run detector on all test images ---
    all_scores: list[float] = []
    all_labels: list[int] = []
    pixel_metrics: list[dict] = []

    t_start = time.time()
    for i, item in enumerate(test_items):
        try:
            res = run_detector(item["path"], z_threshold=z_threshold)
            score = res["confidence"]
        except Exception as exc:
            logger.warning("Failed on %s: %s", item["path"], exc)
            score = 0.0

        all_scores.append(score)
        all_labels.append(item["label"])

        # Pixel-level evaluation (tampered images with masks only)
        if item["label"] == 1 and item.get("mask") is not None:
            try:
                mask_arr = cv2.imread(str(item["mask"]), cv2.IMREAD_GRAYSCALE)
                if mask_arr is not None:
                    with open(item["path"], "rb") as fh:
                        img_bytes = fh.read()
                    from PIL import Image
                    import io as _io
                    orig_pil = Image.open(_io.BytesIO(img_bytes))
                    h_img, w_img = orig_pil.size[1], orig_pil.size[0]

                    heatmap = _heatmap_from_result(res, h_img, w_img)
                    mask_resized = cv2.resize(
                        mask_arr, (w_img, h_img), interpolation=cv2.INTER_NEAREST
                    )
                    pm = evaluate_pixel_level(heatmap, mask_resized, heatmap_threshold)
                    pixel_metrics.append(pm)
            except Exception as exc:
                logger.warning("Pixel eval failed for %s: %s", item["path"], exc)

        if (i + 1) % 10 == 0:
            logger.info("Processed %d/%d images...", i + 1, len(test_items))

    elapsed = time.time() - t_start
    logger.info("Evaluation complete in %.1f s", elapsed)

    scores_arr = np.array(all_scores, dtype=np.float32)
    labels_arr = np.array(all_labels, dtype=np.int32)

    # --- Image-level metrics ---
    preds = (scores_arr > 0.5).astype(np.int32)
    n = len(labels_arr)
    accuracy = float(np.mean(preds == labels_arr))

    tp = int(np.sum((preds == 1) & (labels_arr == 1)))
    fp = int(np.sum((preds == 1) & (labels_arr == 0)))
    fn = int(np.sum((preds == 0) & (labels_arr == 1)))
    tn = int(np.sum((preds == 0) & (labels_arr == 0)))

    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-8)

    auc: Optional[float] = None
    roc_data: Optional[dict] = None
    if _has_sklearn and len(np.unique(labels_arr)) == 2:
        auc = float(roc_auc_score(labels_arr, scores_arr))
        fpr, tpr, roc_threshs = roc_curve(labels_arr, scores_arr)
        roc_data = {
            "fpr": fpr.tolist(),
            "tpr": tpr.tolist(),
            "thresholds": roc_threshs.tolist(),
        }

    image_metrics = {
        "n_images": n,
        "n_authentic": int(np.sum(labels_arr == 0)),
        "n_tampered": int(np.sum(labels_arr == 1)),
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "auc": round(auc, 4) if auc is not None else None,
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
    }

    # --- Pixel-level aggregate ---
    pixel_aggregate: Optional[dict] = None
    if pixel_metrics:
        pixel_aggregate = {
            "n_masks": len(pixel_metrics),
            "mean_iou": round(float(np.mean([m["iou"] for m in pixel_metrics])), 4),
            "mean_precision": round(float(np.mean([m["precision"] for m in pixel_metrics])), 4),
            "mean_recall": round(float(np.mean([m["recall"] for m in pixel_metrics])), 4),
        }

    summary = {
        "z_threshold_used": z_threshold,
        "heatmap_threshold": heatmap_threshold,
        "calibrated": calibrate,
        "image_metrics": image_metrics,
        "pixel_metrics": pixel_aggregate,
        "roc": roc_data,
        "elapsed_seconds": round(elapsed, 2),
    }

    # --- Print summary ---
    print("\n=== Image-Level Evaluation ===")
    print(f"  Threshold (z-score): {z_threshold}")
    print(f"  Images evaluated:    {n}")
    print(f"  Accuracy:            {accuracy:.4f}")
    print(f"  Precision:           {precision:.4f}")
    print(f"  Recall:              {recall:.4f}")
    print(f"  F1:                  {f1:.4f}")
    print(f"  AUC:                 {auc:.4f if auc is not None else 'N/A'}")
    print(f"  TP/FP/FN/TN:         {tp}/{fp}/{fn}/{tn}")

    if pixel_aggregate:
        print("\n=== Pixel-Level Localisation ===")
        print(f"  Masks evaluated:  {pixel_aggregate['n_masks']}")
        print(f"  Mean IoU:         {pixel_aggregate['mean_iou']:.4f}")
        print(f"  Mean Precision:   {pixel_aggregate['mean_precision']:.4f}")
        print(f"  Mean Recall:      {pixel_aggregate['mean_recall']:.4f}")

    # --- Save JSON output ---
    if output_file is not None:
        import json
        output_file = Path(output_file)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        # roc_data contains numpy arrays already converted to lists
        with open(output_file, "w") as fh:
            json.dump(summary, fh, indent=2, default=str)
        logger.info("Saved evaluation results to %s", output_file)

    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Evaluate noise_service forgery detector on a labeled dataset."
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        required=True,
        help="Root dataset directory (must contain authentic/ and tampered/).",
    )
    parser.add_argument(
        "--masks",
        type=Path,
        default=None,
        help="Directory with ground-truth binary masks (optional).",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_Z_THRESHOLD,
        help=f"Z-score anomaly threshold (default: {DEFAULT_Z_THRESHOLD}).",
    )
    parser.add_argument(
        "--heatmap-threshold",
        type=float,
        default=0.5,
        help="Heatmap binarisation threshold for pixel-level IoU (default: 0.5).",
    )
    parser.add_argument(
        "--calibrate",
        action="store_true",
        help="Optimise threshold on a calibration split before evaluating.",
    )
    parser.add_argument(
        "--calib-fraction",
        type=float,
        default=0.2,
        help="Fraction of images used for calibration (default: 0.2).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Path to save JSON evaluation results.",
    )
    args = parser.parse_args()

    masks_dir = args.masks
    if masks_dir is None:
        default_masks = args.dataset / "masks"
        if default_masks.is_dir():
            masks_dir = default_masks
            logger.info("Auto-detected masks directory: %s", masks_dir)

    evaluate(
        dataset_root=args.dataset,
        masks_dir=masks_dir,
        z_threshold=args.threshold,
        heatmap_threshold=args.heatmap_threshold,
        calibrate=args.calibrate,
        calib_fraction=args.calib_fraction,
        output_file=args.output,
    )


if __name__ == "__main__":
    main()
