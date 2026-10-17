#!/usr/bin/env python3
"""Generate the EPUB cover: a typographic cover with a stylised Grafana-ish panel."""
from __future__ import annotations

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1600, 2400

BG = (16, 20, 30)
BG2 = (24, 30, 44)
ACCENT = (232, 106, 44)      # Prometheus orange
ACCENT2 = (246, 178, 43)     # Grafana yellow-orange
INK = (242, 244, 248)
MUTED = (150, 160, 178)
GRID = (38, 46, 62)

FONT_DIRS = [
    r"C:\Windows\Fonts",
    "/usr/share/fonts/truetype/dejavu",
    "/System/Library/Fonts",
]
CANDIDATES = {
    "bold": ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf", "Helvetica.ttc"],
    "regular": ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf", "Helvetica.ttc"],
    "mono": ["consola.ttf", "cour.ttf", "DejaVuSansMono.ttf", "Menlo.ttc"],
}


def find_font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    for name in CANDIDATES[kind]:
        for d in FONT_DIRS:
            p = os.path.join(d, name)
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size)
                except OSError:
                    continue
    return ImageFont.load_default()


def text_w(draw: ImageDraw.ImageDraw, s: str, font) -> int:
    return int(draw.textlength(s, font=font))


def wrap(draw, s: str, font, max_w: int) -> list[str]:
    words, lines, cur = s.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if text_w(draw, trial, font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def main(out_path: str) -> None:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # ---- subtle vertical gradient -------------------------------------
    for y in range(H):
        t = y / H
        c = tuple(int(BG[i] + (BG2[i] - BG[i]) * (t ** 1.4)) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)

    # ---- top accent rule ----------------------------------------------
    d.rectangle([0, 0, W, 22], fill=ACCENT)

    margin = 130

    # ---- eyebrow -------------------------------------------------------
    f_eyebrow = find_font("mono", 40)
    d.text((margin, 190), "A  H A N D S - O N   I N T R O D U C T I O N", font=f_eyebrow, fill=ACCENT2)

    # ---- title ---------------------------------------------------------
    f_title = find_font("bold", 152)
    title_lines = ["Observability", "with Prometheus", "and Grafana"]
    y = 300
    for line in title_lines:
        d.text((margin, y), line, font=f_title, fill=INK)
        y += 178

    # ---- subtitle ------------------------------------------------------
    f_sub = find_font("regular", 54)
    y += 30
    sub = "Instrument, query, visualize and alert — building one real stack, chapter by chapter"
    for line in wrap(d, sub, f_sub, W - 2 * margin - 40):
        d.text((margin, y), line, font=f_sub, fill=MUTED)
        y += 74

    # ---- the panel -----------------------------------------------------
    px0, py0 = margin, 1180
    px1, py1 = W - margin, 1900
    d.rounded_rectangle([px0, py0, px1, py1], radius=18, fill=(20, 25, 37), outline=GRID, width=3)

    # panel header
    f_panel = find_font("regular", 40)
    d.text((px0 + 34, py0 + 26), "checkout — request rate & p95 latency", font=f_panel, fill=MUTED)
    d.line([(px0, py0 + 92), (px1, py0 + 92)], fill=GRID, width=3)

    gx0, gy0 = px0 + 34, py0 + 140
    gx1, gy1 = px1 - 34, py1 - 90

    # grid lines
    for i in range(1, 5):
        gy = gy0 + (gy1 - gy0) * i / 5
        d.line([(gx0, gy), (gx1, gy)], fill=GRID, width=2)
    for i in range(1, 8):
        gx = gx0 + (gx1 - gx0) * i / 8
        d.line([(gx, gy0), (gx, gy1)], fill=GRID, width=1)

    # two deterministic pseudo-series
    def series(seed: float, amp: float, base: float, spike_at: float | None = None):
        pts = []
        n = 260
        for i in range(n + 1):
            x = i / n
            v = base
            v += amp * 0.45 * math.sin(x * 7.3 + seed)
            v += amp * 0.28 * math.sin(x * 17.1 + seed * 2.1)
            v += amp * 0.16 * math.sin(x * 41.7 + seed * 3.7)
            if spike_at is not None:
                v += amp * 1.5 * math.exp(-((x - spike_at) ** 2) / 0.0012)
            v = max(0.02, min(0.98, v))
            pts.append((gx0 + (gx1 - gx0) * x, gy1 - (gy1 - gy0) * v))
        return pts

    s1 = series(0.7, 0.20, 0.34)
    s2 = series(2.3, 0.16, 0.60, spike_at=0.72)

    # filled area under s1
    area = s1 + [(gx1, gy1), (gx0, gy1)]
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.polygon(area, fill=(232, 106, 44, 46))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    d = ImageDraw.Draw(img)

    d.line(s1, fill=ACCENT, width=6, joint="curve")
    d.line(s2, fill=(90, 175, 235), width=5, joint="curve")

    # threshold line + firing marker
    ty = gy1 - (gy1 - gy0) * 0.82
    for x in range(int(gx0), int(gx1), 26):
        d.line([(x, ty), (x + 13, ty)], fill=(214, 78, 78), width=3)
    spike_x = gx0 + (gx1 - gx0) * 0.72
    d.ellipse([spike_x - 13, gy1 - (gy1 - gy0) * 0.955 - 13,
               spike_x + 13, gy1 - (gy1 - gy0) * 0.955 + 13], fill=(214, 78, 78))

    # axis
    d.line([(gx0, gy1), (gx1, gy1)], fill=(70, 82, 104), width=3)

    # legend
    f_leg = find_font("mono", 32)
    ly = py1 - 62
    d.rectangle([gx0, ly + 12, gx0 + 40, ly + 18], fill=ACCENT)
    d.text((gx0 + 56, ly), "rate(http_requests_total[5m])", font=f_leg, fill=MUTED)
    lx2 = gx0 + 56 + text_w(d, "rate(http_requests_total[5m])", f_leg) + 70
    d.rectangle([lx2, ly + 12, lx2 + 40, ly + 18], fill=(90, 175, 235))
    d.text((lx2 + 56, ly), "p95", font=f_leg, fill=MUTED)

    # ---- footer --------------------------------------------------------
    f_foot = find_font("bold", 48)
    d.text((margin, H - 260), "Co-Authored with Claude", font=f_foot, fill=INK)
    f_foot2 = find_font("regular", 38)
    d.text((margin, H - 190), "Prometheus · PromQL · Grafana · Alertmanager · SLOs",
           font=f_foot2, fill=MUTED)

    d.rectangle([0, H - 22, W, H], fill=ACCENT)

    parent = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(parent, exist_ok=True)
    img.save(out_path, "PNG", optimize=True)
    print(f"wrote {out_path} ({os.path.getsize(out_path):,} bytes)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "cover.png"))
