"""Hazard-portfolio PDF: cover + summary, exposure-ranked table, one detail
page per property, methodology + disclaimer.

reportlab Platypus, Letter portrait, restrained navy/white palette — same
approach as portfolio_pdf.py, purpose-built for the flattened hazard schema
that /portfolio/analyze produces (both perils + NSI provenance + gaps).
"""
from __future__ import annotations

import io
from datetime import datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle)

NAVY = colors.HexColor("#0f172a")
ACCENT = colors.HexColor("#2563eb")
GREY = colors.HexColor("#64748b")
TIER = {"HIGH": colors.HexColor("#c62828"),
        "MODERATE": colors.HexColor("#f9a825"),
        "LOW": colors.HexColor("#2e7d32"),
        "CANNOT ASSESS": colors.HexColor("#9e9e9e")}

S = {
    "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=24,
                         textColor=NAVY, spaceAfter=6),
    "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=14,
                         textColor=NAVY, spaceBefore=14, spaceAfter=6),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.5,
                           leading=13, textColor=colors.HexColor("#1e293b")),
    "dim": ParagraphStyle("dim", fontName="Helvetica", fontSize=8,
                          leading=11, textColor=GREY),
    "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=8.5,
                           leading=11),
}


def _usd_or_dash(p: dict, key: str) -> str:
    v = p.get(key)
    return v if isinstance(v, str) and v not in ("", None) else "\u2014"


def _combined(p: dict) -> float:
    return ((p.get("wildfire_annual_loss_usd") or 0)
            + (p.get("flood_annual_loss_usd") or 0))


def _kv_table(pairs: list[tuple[str, str]], width: float) -> Table:
    t = Table([[Paragraph(k, S["dim"]), Paragraph(v, S["cell"])]
               for k, v in pairs], colWidths=[width * 0.42, width * 0.58])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]))
    return t


def render_hazard_portfolio_pdf(geojson: dict, portfolio_name: str,
                                summary: dict | None = None) -> bytes:
    feats = geojson.get("features", [])
    props = sorted((f["properties"] for f in feats),
                   key=_combined, reverse=True)
    if summary is None:
        from .portfolio_flatten import portfolio_summary
        summary = portfolio_summary(feats)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.9 * inch, bottomMargin=0.75 * inch,
        title=f"Portfolio Hazard Review \u2014 {portfolio_name}")
    W = letter[0] - 1.5 * inch
    el: list[Any] = []

    # ── Cover / summary ────────────────────────────────────────────────────
    el.append(Spacer(1, 1.4 * inch))
    el.append(Paragraph("Portfolio Hazard Review", S["h1"]))
    el.append(Paragraph(portfolio_name, ParagraphStyle(
        "sub", parent=S["h2"], fontSize=16, textColor=ACCENT, spaceBefore=0)))
    el.append(Spacer(1, 0.35 * inch))
    total = summary.get("total_annual_exposure") or 0
    kpi = Table([[
        Paragraph(f"<b>{summary.get('property_count', len(props))}</b><br/>"
                  f"<font size=7 color='#64748b'>PROPERTIES</font>", S["body"]),
        Paragraph(f"<b>{summary.get('high_wildfire', 0)}</b><br/>"
                  f"<font size=7 color='#64748b'>HIGH WILDFIRE</font>", S["body"]),
        Paragraph(f"<b>{summary.get('flood_exposed', 0)}</b><br/>"
                  f"<font size=7 color='#64748b'>FLOOD-EXPOSED (SFHA)</font>",
                  S["body"]),
        Paragraph(f"<b>${total:,.0f}/yr</b><br/>"
                  f"<font size=7 color='#64748b'>COMBINED EST. ANNUAL "
                  f"EXPOSURE</font>", S["body"]),
    ]], colWidths=[W / 4] * 4)
    kpi.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#e2e8f0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ]))
    el.append(kpi)
    el.append(Spacer(1, 0.3 * inch))
    el.append(Paragraph(
        f"Generated {datetime.utcnow():%B %d, %Y} \u00b7 Abelian hazard module "
        "\u00b7 Wildfire + flood perils reported separately \u00b7 Dollar "
        "estimates anchored to USACE National Structure Inventory replacement "
        "values", S["dim"]))

    # ── Ranked table ───────────────────────────────────────────────────────
    el.append(PageBreak())
    el.append(Paragraph("Properties ranked by combined annual exposure",
                        S["h2"]))
    head = ["#", "Property", "Wildfire", "Wildfire $/yr", "Flood",
            "FEMA zone", "Combined $/yr"]
    data = [head]
    for i, p in enumerate(props, 1):
        data.append([
            str(i), Paragraph(str(p.get("property", "\u2014")), S["cell"]),
            p.get("wildfire_risk", "\u2014"),
            _usd_or_dash(p, "wildfire_annual_loss"),
            p.get("flood_risk", "\u2014"),
            p.get("flood_zone", "\u2014"),
            _usd_or_dash(p, "combined_annual_exposure"),
        ])
    t = Table(data, colWidths=[0.3 * inch, 2.0 * inch, 0.85 * inch,
                               1.0 * inch, 0.6 * inch, 0.85 * inch,
                               1.15 * inch], repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f8fafc")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for i, p in enumerate(props, 1):
        c = TIER.get(p.get("wildfire_risk"))
        if c:
            style.append(("TEXTCOLOR", (2, i), (2, i), c))
        cf = TIER.get(p.get("flood_risk"))
        if cf:
            style.append(("TEXTCOLOR", (4, i), (4, i), cf))
    t.setStyle(TableStyle(style))
    el.append(t)

    # ── Per-property pages ─────────────────────────────────────────────────
    for p in props:
        el.append(PageBreak())
        el.append(Paragraph(str(p.get("property", "Property")), S["h2"]))
        el.append(Paragraph(
            f"Assessment confidence: {p.get('confidence', '\u2014')}",
            S["dim"]))
        el.append(Spacer(1, 8))

        el.append(Paragraph(
            f"Wildfire \u2014 <font color='{TIER.get(p.get('wildfire_risk'), GREY).hexval()}'>"
            f"{p.get('wildfire_risk', '\u2014')}</font>", S["h2"]))
        fires = p.get("historical_fires_nearby") or []
        fire_str = ("; ".join(
            f"{f.get('name') or 'Unknown'} {f.get('year', '')} "
            f"({round(f.get('acres', 0)):,} ac)"
            for f in fires[:8]) or "None on record at this location") \
            if isinstance(fires, list) else "\u2014"
        el.append(_kv_table([
            ("Est. annual loss", _usd_or_dash(p, "wildfire_annual_loss")),
            ("Damage probability", str(p.get("wildfire_damage_prob", "\u2014"))),
            ("Canopy cover", f"{p.get('canopy_cover_pct', '\u2014')}%"
             if p.get("canopy_cover_pct") is not None else "\u2014"),
            ("Fire history here", fire_str),
        ], W))

        el.append(Paragraph(
            f"Flood \u2014 <font color='{TIER.get(p.get('flood_risk'), GREY).hexval()}'>"
            f"{p.get('flood_risk', '\u2014')}</font>", S["h2"]))
        el.append(_kv_table([
            ("Est. annual loss", _usd_or_dash(p, "flood_annual_loss")),
            ("FEMA zone", str(p.get("flood_zone", "\u2014"))),
            ("In Special Flood Hazard Area", str(p.get("in_sfha", "\u2014"))),
            ("Return period", str(p.get("flood_return_period", "\u2014"))),
            ("Modeled 100-yr event loss",
             _usd_or_dash(p, "flood_total_loss_100yr")),
        ], W))

        el.append(Paragraph("Valuation basis", S["h2"]))
        el.append(_kv_table([
            ("Replacement value", _usd_or_dash(p, "replacement_value")),
            ("Structure", str(p.get("building_type", "\u2014"))),
            ("Source", str(p.get("value_source", "\u2014"))),
        ], W))

        if p.get("confidence_note"):
            el.append(Spacer(1, 8))
            el.append(Paragraph(f"<b>Confidence note:</b> "
                                f"{p['confidence_note']}", S["dim"]))
        if p.get("data_gaps"):
            el.append(Paragraph(f"<b>Data gaps:</b> {p['data_gaps']}",
                                S["dim"]))

    # ── Methodology + disclaimer ───────────────────────────────────────────
    el.append(PageBreak())
    el.append(Paragraph("Methodology", S["h2"]))
    el.append(Paragraph(
        "Wildfire and flood perils are assessed independently and reported "
        "separately, never combined into a single score. Wildfire estimates "
        "use USFS FSim burn probability where pre-loaded, otherwise a proxy "
        "of NIFC historical fire frequency \u00d7 LANDFIRE fuel/canopy damage "
        "factors. Flood estimates follow the HAZUS depth-damage pipeline "
        "against FEMA NFHL zones, USGS 3DEP ground elevation, and USACE "
        "National Structure Inventory first-floor heights. All dollar "
        "figures are anchored to NSI replacement values; where no structure "
        "is matched, estimates are reported as N/A rather than defaulted. "
        "Per-criterion confidence and any data gaps are carried through to "
        "this report verbatim.", S["body"]))
    el.append(Spacer(1, 14))
    el.append(Paragraph("Disclaimer", S["h2"]))
    el.append(Paragraph(
        "This report is generated from public federal datasets for screening "
        "purposes only. It is not an insurance rating, an engineering "
        "assessment, or investment advice. Estimates carry the stated "
        "confidence levels and gaps; verify independently before relying on "
        "them for transactional decisions.", S["dim"]))

    doc.build(el)
    return buf.getvalue()
