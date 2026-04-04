"""
PDF Report Generation Service
------------------------------
Generates a forensic analysis PDF report using ReportLab.
Includes image thumbnail, per-technique results with
visualisation images, and an overall summary.
"""

import io
import base64
import cv2
import numpy as np
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image as RLImage,
    Table, TableStyle, HRFlowable, PageBreak,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT


def _b64_to_rl_image(b64_string: str, width: float = 5 * inch) -> RLImage:
    """Convert a base64 PNG string to a ReportLab Image."""
    img_data = base64.b64decode(b64_string)
    buf = io.BytesIO(img_data)
    img = RLImage(buf, width=width)
    img.hAlign = "CENTER"
    # Maintain aspect ratio
    from PIL import Image as PILImage
    pil = PILImage.open(io.BytesIO(img_data))
    aspect = pil.size[1] / pil.size[0]
    img._restrictSize(width, width * aspect)
    return img


def generate_report(analysis_results: dict) -> bytes:
    """
    Generate a PDF forensic report.

    Parameters
    ----------
    analysis_results : dict
        The full analysis response from the /api/analyze endpoint.

    Returns
    -------
    bytes : PDF file content
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="ReportTitle",
        parent=styles["Title"],
        fontSize=24,
        spaceAfter=6,
        textColor=colors.HexColor("#1a1a2e"),
    ))
    styles.add(ParagraphStyle(
        name="SectionTitle",
        parent=styles["Heading2"],
        fontSize=16,
        spaceBefore=16,
        spaceAfter=8,
        textColor=colors.HexColor("#16213e"),
    ))
    styles.add(ParagraphStyle(
        name="FindingText",
        parent=styles["Normal"],
        fontSize=10,
        spaceBefore=4,
        spaceAfter=2,
        leftIndent=12,
    ))
    styles.add(ParagraphStyle(
        name="SubInfo",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.grey,
        alignment=TA_CENTER,
    ))

    elements = []

    # ---- Title Page ----
    elements.append(Spacer(1, 1.5 * inch))
    elements.append(Paragraph("Image Forensics Report", styles["ReportTitle"]))
    elements.append(Spacer(1, 0.2 * inch))
    elements.append(HRFlowable(
        width="60%", thickness=2, color=colors.HexColor("#6c63ff"),
        spaceAfter=12, hAlign="CENTER",
    ))

    filename = analysis_results.get("filename", "Unknown")
    dimensions = analysis_results.get("dimensions", [0, 0])
    elements.append(Paragraph(
        f"<b>File:</b> {filename} &nbsp;&nbsp; <b>Dimensions:</b> {dimensions[0]}×{dimensions[1]}",
        styles["Normal"],
    ))
    elements.append(Paragraph(
        f"Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        styles["SubInfo"],
    ))
    elements.append(Spacer(1, 0.3 * inch))

    # Original image thumbnail
    orig_b64 = analysis_results.get("original_b64")
    if orig_b64:
        try:
            elements.append(_b64_to_rl_image(orig_b64, width=4 * inch))
            elements.append(Spacer(1, 0.1 * inch))
            elements.append(Paragraph("Original Image", styles["SubInfo"]))
        except Exception:
            pass

    elements.append(PageBreak())

    # ---- Analysis Sections ----
    analyses = analysis_results.get("analyses", {})

    technique_order = [
        ("ela", "Error Level Analysis"),
        ("copy_move", "Copy-Move Detection"),
        ("noise", "Noise Pattern Analysis"),
        ("compression", "Compression Artifact Detection"),
        ("splicing", "Image Splicing Detection"),
        ("metadata", "EXIF Metadata Analysis"),
    ]

    for key, title in technique_order:
        if key not in analyses:
            continue

        section = analyses[key]
        elements.append(Paragraph(title, styles["SectionTitle"]))
        elements.append(HRFlowable(
            width="100%", thickness=1, color=colors.HexColor("#e0e0e0"),
            spaceAfter=8,
        ))

        # Description
        desc = section.get("description", "")
        if desc:
            elements.append(Paragraph(desc, styles["Normal"]))
            elements.append(Spacer(1, 0.1 * inch))

        # Confidence
        confidence = section.get("confidence")
        if confidence is not None:
            conf_pct = f"{confidence * 100:.0f}%"
            conf_color = "#27ae60" if confidence < 0.3 else "#f39c12" if confidence < 0.6 else "#e74c3c"
            elements.append(Paragraph(
                f'<b>Forgery Confidence:</b> <font color="{conf_color}">{conf_pct}</font>',
                styles["Normal"],
            ))
            elements.append(Spacer(1, 0.1 * inch))

        # Findings
        findings = section.get("findings", [])
        for finding in findings:
            elements.append(Paragraph(f"• {finding}", styles["FindingText"]))

        # Visualisation image
        vis_b64 = section.get("visualization")
        if vis_b64:
            try:
                elements.append(Spacer(1, 0.15 * inch))
                elements.append(_b64_to_rl_image(vis_b64, width=5 * inch))
            except Exception:
                pass

        # Metadata table
        if key == "metadata":
            meta_data = section.get("data", {})
            flags = section.get("flags", [])

            if meta_data:
                elements.append(Spacer(1, 0.15 * inch))
                table_data = [["Field", "Value"]]
                for k, v in meta_data.items():
                    if k == "GPS":
                        v = str(v)
                    table_data.append([str(k), str(v)[:80]])

                t = Table(table_data, colWidths=[2 * inch, 4 * inch])
                t.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6c63ff")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 9),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8f8f8")]),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]))
                elements.append(t)

            if flags:
                elements.append(Spacer(1, 0.1 * inch))
                elements.append(Paragraph("<b>⚠ Flags:</b>", styles["Normal"]))
                for flag in flags:
                    elements.append(Paragraph(
                        f'<font color="#e74c3c">• {flag}</font>',
                        styles["FindingText"],
                    ))

        elements.append(Spacer(1, 0.3 * inch))

    # ---- Summary ----
    elements.append(HRFlowable(
        width="100%", thickness=2, color=colors.HexColor("#6c63ff"),
        spaceAfter=12,
    ))
    elements.append(Paragraph("Summary", styles["SectionTitle"]))

    total_confidence = []
    for key, _ in technique_order:
        section = analyses.get(key, {})
        c = section.get("confidence")
        if c is not None:
            total_confidence.append(c)

    if total_confidence:
        avg_conf = sum(total_confidence) / len(total_confidence)
        max_conf = max(total_confidence)
        elements.append(Paragraph(
            f"Average forgery confidence: <b>{avg_conf * 100:.0f}%</b> | "
            f"Peak confidence: <b>{max_conf * 100:.0f}%</b>",
            styles["Normal"],
        ))

        if max_conf > 0.6:
            elements.append(Paragraph(
                '<font color="#e74c3c"><b>⚠ This image shows strong indicators of manipulation.</b></font>',
                styles["Normal"],
            ))
        elif max_conf > 0.3:
            elements.append(Paragraph(
                '<font color="#f39c12"><b>⚡ Some regions show moderate indicators of possible editing.</b></font>',
                styles["Normal"],
            ))
        else:
            elements.append(Paragraph(
                '<font color="#27ae60"><b>✓ No strong indicators of image manipulation detected.</b></font>',
                styles["Normal"],
            ))

    elements.append(Spacer(1, 0.5 * inch))
    elements.append(Paragraph(
        "This report was generated by ForensicLens using classic Digital Image Processing techniques. "
        "Results should be interpreted by a trained analyst and are not definitive proof of forgery.",
        styles["SubInfo"],
    ))

    doc.build(elements)
    return buffer.getvalue()
