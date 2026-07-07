#!/usr/bin/env python3
import argparse
import re
import textwrap
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


DEFAULT_URL = "https://www.ndbv.de/sb_meisterschaft.php?p=20-10-2026/2027-940---1-1-10-%20Alle%20Kategorien"


@dataclass
class TournamentData:
    source_url: str
    title: str = ""
    short_code: str = ""
    season: str = ""
    date: str = ""
    start_time: str = ""
    location_name: str = ""
    location_address: list[str] = field(default_factory=list)
    registration_deadline: str = ""
    section: str = ""
    discipline: str = ""
    category: str = ""
    tournament_type: str = ""
    participants: list[dict[str, str]] = field(default_factory=list)


class TableTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None
        self._in_cell = False

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._current_row = []
        elif tag in {"td", "th"} and self._current_row is not None:
            self._current_cell = []
            self._in_cell = True
        elif tag == "br" and self._in_cell and self._current_cell is not None:
            self._current_cell.append("\n")

    def handle_endtag(self, tag):
        if tag in {"td", "th"} and self._current_row is not None and self._current_cell is not None:
            text = normalize_cell_text("".join(self._current_cell))
            self._current_row.append(text)
            self._current_cell = None
            self._in_cell = False
        elif tag == "tr" and self._current_row is not None:
            if any(cell for cell in self._current_row):
                self.rows.append(self._current_row)
            self._current_row = None

    def handle_data(self, data):
        if self._in_cell and self._current_cell is not None:
            self._current_cell.append(data)


def normalize_cell_text(value: str) -> str:
    text = unescape(str(value or "")).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n+", "\n", text)
    return text.strip()


def clean_inline(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip()


def fetch_html(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "billard-scoreboard-nbv-invitation/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def parse_season_from_url(url: str) -> str:
    match = re.search(r"\b(20\d{2}/20\d{2})\b", unquote(url))
    return match.group(1) if match else ""


def parse_tournament(html: str, source_url: str) -> TournamentData:
    parser = TableTextParser()
    parser.feed(html)
    data = TournamentData(source_url=source_url, season=parse_season_from_url(source_url))

    label_map = {
        "turnier": "title",
        "kürzel": "short_code",
        "kuerzel": "short_code",
        "meldeschluss": "registration_deadline",
        "sparte": "section",
        "disziplin": "discipline",
        "kategorie": "category",
        "meisterschaftstyp": "tournament_type",
    }

    for row in parser.rows:
        if len(row) < 2:
            continue
        label = clean_inline(row[0]).lower()
        value = row[1]
        attr_name = label_map.get(label)
        if attr_name:
            setattr(data, attr_name, clean_inline(value))
        elif label == "datum":
            data.date = clean_inline(value.split("\n")[0])
            time_match = re.search(r"um\s+(\d{2}:\d{2})\s+Uhr", value, re.IGNORECASE)
            if time_match:
                data.start_time = time_match.group(1)
        elif label == "location":
            lines = [clean_inline(line) for line in value.split("\n") if clean_inline(line)]
            if lines:
                data.location_name = lines[0]
                data.location_address = lines[1:]

    seen_names = set()
    for row in parser.rows:
        if len(row) < 3 or not row[0].isdigit():
            continue
        participant_cell = row[2]
        lines = [clean_inline(line) for line in participant_cell.split("\n") if clean_inline(line)]
        if len(lines) < 2 or "," not in lines[0]:
            continue
        name = lines[0]
        if name in seen_names:
            continue
        seen_names.add(name)
        data.participants.append({
            "number": row[0],
            "name": name,
            "club": lines[1],
        })

    if not data.title:
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        data.title = clean_inline(re.sub(r"<[^>]+>", " ", title_match.group(1))) if title_match else "NBV Turnier"

    return data


def format_date_long(value: str) -> str:
    try:
        parsed = datetime.strptime(value, "%d.%m.%Y")
    except ValueError:
        return value
    weekdays = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
    return f"{weekdays[parsed.weekday()]}, {parsed.strftime('%d.%m.%Y')}"


def paragraph(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(str(text or "").replace("\n", "<br/>"), style)


def build_pdf(data: TournamentData, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"Einladung {data.title}",
        author="Billard Scoreboard",
    )

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="TitleCenter",
        parent=styles["Title"],
        alignment=TA_CENTER,
        fontName="Helvetica-Bold",
        fontSize=21,
        leading=25,
        textColor=colors.HexColor("#172033"),
        spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        name="SubtitleCenter",
        parent=styles["BodyText"],
        alignment=TA_CENTER,
        fontSize=10,
        leading=13,
        textColor=colors.HexColor("#526071"),
        spaceAfter=16,
    ))
    styles.add(ParagraphStyle(
        name="Section",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=colors.HexColor("#172033"),
        spaceBefore=10,
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="BodyTight",
        parent=styles["BodyText"],
        fontSize=9.5,
        leading=12.5,
        alignment=TA_LEFT,
    ))
    styles.add(ParagraphStyle(
        name="SmallMuted",
        parent=styles["BodyText"],
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#687386"),
    ))

    story = [
        paragraph("Einladung zum Turnier", styles["TitleCenter"]),
        paragraph("Norddeutscher Billard-Verband e.V. - Karambol", styles["SubtitleCenter"]),
    ]

    facts = [
        ("Turnier", data.title),
        ("Saison", data.season),
        ("Datum", format_date_long(data.date)),
        ("Spielbeginn", f"{data.start_time} Uhr" if data.start_time else ""),
        ("Meldeschluss", data.registration_deadline),
        ("Austragungsort", "\n".join([data.location_name, *data.location_address])),
        ("Disziplin", data.discipline),
        ("Kategorie", data.category),
        ("Typ", data.tournament_type),
        ("Kürzel", data.short_code),
    ]
    fact_rows = [
        [paragraph(label, styles["BodyTight"]), paragraph(value or "-", styles["BodyTight"])]
        for label, value in facts
    ]
    table = Table(fact_rows, colWidths=[38 * mm, 120 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f6")),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#172033")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d8dee7")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(table)

    story.extend([
        Spacer(1, 8),
        paragraph("Hinweise", styles["Section"]),
        paragraph(
            "Bitte rechtzeitig vor Spielbeginn am Austragungsort eintreffen. "
            "Die endgültige Turnierdurchführung, Teilnehmerliste und Ergebnisse werden über die NBV-Seite geführt.",
            styles["BodyTight"],
        ),
    ])

    if data.participants:
        story.append(paragraph("Teilnehmerliste", styles["Section"]))
        participant_rows = [[
            paragraph("Nr.", styles["BodyTight"]),
            paragraph("Teilnehmer", styles["BodyTight"]),
            paragraph("Verein", styles["BodyTight"]),
        ]]
        for participant in data.participants:
            participant_rows.append([
                paragraph(participant["number"], styles["BodyTight"]),
                paragraph(participant["name"], styles["BodyTight"]),
                paragraph(participant["club"], styles["BodyTight"]),
            ])
        participants_table = Table(participant_rows, colWidths=[14 * mm, 83 * mm, 61 * mm], hAlign="LEFT")
        participants_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#172033")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d8dee7")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f9fb")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(participants_table)

    story.extend([
        Spacer(1, 12),
        paragraph(f"Quelle: {data.source_url}", styles["SmallMuted"]),
        paragraph(f"Erstellt am {datetime.now().strftime('%d.%m.%Y %H:%M')}", styles["SmallMuted"]),
    ])

    doc.build(story)


def output_filename(data: TournamentData) -> str:
    slug = clean_inline(data.title).lower()
    slug = (slug
        .replace("ä", "ae")
        .replace("ö", "oe")
        .replace("ü", "ue")
        .replace("ß", "ss"))
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-") or "nbv-turnier"
    date_slug = re.sub(r"[^0-9]+", "-", data.date).strip("-")
    return f"nbv-einladung-{date_slug}-{slug}.pdf"


def main() -> None:
    parser = argparse.ArgumentParser(description="NBV-Turnierseite lesen und Einladung als PDF erzeugen.")
    parser.add_argument("url", nargs="?", default=DEFAULT_URL, help="NBV sb_meisterschaft.php Detail-URL")
    parser.add_argument("--output", help="Ziel-PDF. Standard: output/pdf/<generierter-name>.pdf")
    args = parser.parse_args()

    html = fetch_html(args.url)
    data = parse_tournament(html, args.url)
    output_path = Path(args.output) if args.output else Path("output/pdf") / output_filename(data)
    build_pdf(data, output_path)

    print(f"PDF: {output_path}")
    print(f"Turnier: {data.title}")
    print(f"Datum: {data.date} {data.start_time}".strip())
    print(f"Teilnehmer: {len(data.participants)}")


if __name__ == "__main__":
    main()
