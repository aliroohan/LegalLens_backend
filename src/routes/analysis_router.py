"""
Analysis Router
----------------
Provides the main API endpoints for image forensic analysis:
  POST /api/analyze  — runs all 6 techniques on an uploaded image
  POST /api/report   — generates a downloadable PDF report
"""

import io
import time
import logging
import asyncio
import base64

logger = logging.getLogger(__name__)
import cv2
import numpy as np
from PIL import Image
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse

from services.ela_service import run_ela
from services.copy_move_service import run_copy_move
from services.noise_service import run_noise_analysis
from services.compression_service import run_compression_analysis
from services.metadata_service import run_metadata_analysis
from services.splicing_service import run_splicing_detection
from services.report_service import generate_report

router = APIRouter(prefix="/api", tags=["analysis"])


def _cv2_to_b64(img: np.ndarray) -> str:
    """Encode an OpenCV BGR image to base64 PNG string."""
    _, buf = cv2.imencode(".png", img)
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def _pil_to_b64(img_bytes: bytes) -> str:
    """Encode raw image bytes to base64 PNG."""
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff"}


@router.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):
    """
    Run all forensic analysis techniques on the uploaded image.
    """
    start_time = time.time()
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. "
                   f"Allowed: {', '.join(ALLOWED_TYPES)}",
        )

    image_bytes = await file.read()

    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    # Get image dimensions
    img = Image.open(io.BytesIO(image_bytes))
    width, height = img.size

    # --- Run all analyses concurrently ---
    def safe_analyze(func, bytes_data, is_metadata=False):
        try:
            return func(bytes_data)
        except Exception as e:
            if is_metadata:
                return {"data": {}, "flags": [], "findings": [f"{func.__name__} failed: {e}"]}
            return {"visualization": None, "confidence": 0, "findings": [f"{func.__name__} failed: {e}"]}

    (
        ela_result,
        copy_move_result,
        noise_result,
        compression_result,
        metadata_result,
        splicing_result
    ) = await asyncio.gather(
        asyncio.to_thread(safe_analyze, run_ela, image_bytes),
        asyncio.to_thread(safe_analyze, run_copy_move, image_bytes),
        asyncio.to_thread(safe_analyze, run_noise_analysis, image_bytes),
        asyncio.to_thread(safe_analyze, run_compression_analysis, image_bytes),
        asyncio.to_thread(safe_analyze, run_metadata_analysis, image_bytes, True),
        asyncio.to_thread(safe_analyze, run_splicing_detection, image_bytes)
    )

    # --- Build response ---
    response = {
        "filename": file.filename,
        "dimensions": [width, height],
        "original_b64": _pil_to_b64(image_bytes),
        "analyses": {
            "ela": {
                "name": "Error Level Analysis",
                "description": "Compares the original image with a re-compressed version to reveal regions with different compression levels, indicating possible editing.",
                "confidence": ela_result["confidence"],
                "findings": ela_result["findings"],
                "visualization": _cv2_to_b64(ela_result["visualization"]) if ela_result.get("visualization") is not None else None,
            },
            "copy_move": {
                "name": "Copy-Move Detection",
                "description": "Divides the image into blocks and compares DCT features to find duplicated regions that indicate copy-paste forgery.",
                "confidence": copy_move_result["confidence"],
                "findings": copy_move_result["findings"],
                "visualization": _cv2_to_b64(copy_move_result["visualization"]) if copy_move_result.get("visualization") is not None else None,
            },
            "noise": {
                "name": "Noise Pattern Analysis",
                "description": "Extracts noise residuals and analyses local variance to detect regions where noise characteristics differ, suggesting manipulation.",
                "confidence": noise_result["confidence"],
                "findings": noise_result["findings"],
                "visualization": _cv2_to_b64(noise_result["visualization"]) if noise_result.get("visualization") is not None else None,
            },
            "compression": {
                "name": "Compression Artifact Detection",
                "description": "Analyses JPEG 8×8 block boundaries and compression patterns to detect inconsistencies from selective re-compression.",
                "confidence": compression_result["confidence"],
                "findings": compression_result["findings"],
                "visualization": _cv2_to_b64(compression_result["visualization"]) if compression_result.get("visualization") is not None else None,
            },
            "metadata": {
                "name": "EXIF Metadata Analysis",
                "description": "Extracts and examines image metadata for signs of editing software, missing fields, or date inconsistencies.",
                "confidence": None,
                "findings": metadata_result["findings"],
                "visualization": None,
                "data": metadata_result.get("data", {}),
                "flags": metadata_result.get("flags", []),
            },
            "splicing": {
                "name": "Image Splicing Detection",
                "description": "Uses edge detection, colour space analysis, and gradient magnitude to find regions where different images may have been composited.",
                "confidence": splicing_result["confidence"],
                "findings": splicing_result["findings"],
                "visualization": _cv2_to_b64(splicing_result["visualization"]) if splicing_result.get("visualization") is not None else None,
            },
        },
    }

    elapsed_time = time.time() - start_time
    logger.info(f"Analysis API for '{file.filename}' took {elapsed_time:.2f} seconds.")

    return response


@router.post("/report")
async def generate_pdf_report(results: dict):
    """
    Generate a PDF forensic report from analysis results.
    """
    try:
        pdf_bytes = generate_report(results)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {e}")

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="forensic_report.pdf"',
        },
    )
