"""
EXIF Metadata Analysis Service
-------------------------------
Extracts EXIF metadata from the image and flags suspicious fields
such as editing software presence, missing critical fields,
or date/time inconsistencies.

While not pure image processing, metadata analysis supports
forensic validation of image authenticity.
"""

import io
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS


# Known editing software keywords
EDITING_SOFTWARE = [
    "photoshop", "gimp", "lightroom", "snapseed", "pixlr",
    "affinity", "capture one", "paint", "corel", "acdsee",
    "photoscape", "fotor", "canva", "picasa", "darktable",
    "rawtherapee", "luminar", "photopea", "befunky",
]


def _decode_exif(exif_data: dict) -> dict:
    """Convert raw EXIF tag IDs to human-readable names."""
    decoded = {}
    for tag_id, value in exif_data.items():
        tag_name = TAGS.get(tag_id, str(tag_id))
        # Handle bytes values
        if isinstance(value, bytes):
            try:
                value = value.decode("utf-8", errors="replace").strip("\x00")
            except Exception:
                value = str(value)
        # Handle IFDRational and tuples
        if hasattr(value, "numerator"):
            value = float(value)
        decoded[tag_name] = value
    return decoded


def _parse_gps(gps_info: dict) -> dict:
    """Parse GPS IFD into readable format."""
    parsed = {}
    for key, val in gps_info.items():
        tag_name = GPSTAGS.get(key, str(key))
        parsed[tag_name] = str(val)
    return parsed


def run_metadata_analysis(image_bytes: bytes) -> dict:
    """
    Extract and analyse EXIF metadata.

    Returns
    -------
    dict with keys:
        - data     : dict of metadata fields
        - flags    : list[str] suspicious findings
        - findings : list[str] human-readable observations
    """
    img = Image.open(io.BytesIO(image_bytes))

    # --- 1. Extract EXIF ---
    raw_exif = img._getexif() if hasattr(img, "_getexif") else None
    exif = _decode_exif(raw_exif) if raw_exif else {}

    # Also get basic image info
    data: dict = {
        "Format": img.format or "Unknown",
        "Mode": img.mode,
        "Size": f"{img.size[0]} × {img.size[1]}",
    }

    # Key fields to extract
    key_fields = [
        "Make", "Model", "Software", "DateTime", "DateTimeOriginal",
        "DateTimeDigitized", "ExposureTime", "FNumber", "ISOSpeedRatings",
        "FocalLength", "ImageWidth", "ImageLength", "Orientation",
        "XResolution", "YResolution", "Flash",
    ]

    for field in key_fields:
        if field in exif:
            val = exif[field]
            data[field] = str(val) if not isinstance(val, (str, int, float)) else val

    # GPS info
    if "GPSInfo" in exif:
        gps = _parse_gps(exif["GPSInfo"]) if isinstance(exif["GPSInfo"], dict) else {}
        if gps:
            data["GPS"] = gps

    # --- 2. Flag suspicious fields ---
    flags: list[str] = []
    findings: list[str] = []

    # Check for editing software
    software = str(exif.get("Software", "")).lower()
    if any(sw in software for sw in EDITING_SOFTWARE):
        flags.append(f"Editing software detected: {exif.get('Software')}")

    # Check for missing critical fields
    if not raw_exif:
        flags.append("No EXIF metadata found — may have been stripped.")
        findings.append("Image contains no EXIF data. This could indicate the metadata was intentionally removed.")
    else:
        missing = [f for f in ["Make", "Model", "DateTime"] if f not in exif]
        if missing:
            flags.append(f"Missing critical fields: {', '.join(missing)}")

    # Date consistency check
    dt = exif.get("DateTime")
    dt_orig = exif.get("DateTimeOriginal")
    dt_dig = exif.get("DateTimeDigitized")
    dates = [d for d in [dt, dt_orig, dt_dig] if d]
    if len(set(str(d) for d in dates)) > 1:
        flags.append("Date/time fields are inconsistent — possible editing.")

    # Summary findings
    if flags:
        findings.append(f"Found {len(flags)} suspicious metadata indicator(s).")
    else:
        findings.append("Metadata appears consistent and complete.")

    total_fields = len(data)
    findings.append(f"Extracted {total_fields} metadata fields.")

    return {
        "data": data,
        "flags": flags,
        "findings": findings,
    }
