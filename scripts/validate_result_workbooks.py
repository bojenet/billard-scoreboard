"""Check the XML structure of Excel result templates before publishing them."""

import re
import sys
from collections import Counter
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ORDER = (
    "sheetPr", "dimension", "sheetViews", "sheetFormatPr", "cols", "sheetData",
    "sheetCalcPr", "sheetProtection", "protectedRanges", "scenarios", "autoFilter",
    "sortState", "dataConsolidate", "customSheetViews", "mergeCells",
    "phoneticPr", "conditionalFormatting", "dataValidations", "hyperlinks",
    "printOptions", "pageMargins", "pageSetup", "headerFooter", "rowBreaks",
    "colBreaks", "customProperties", "cellWatches", "ignoredErrors", "smartTags",
    "drawing", "legacyDrawing", "legacyDrawingHF", "picture", "oleObjects",
    "controls", "webPublishItems", "tableParts", "extLst",
)


def validate(path):
    with ZipFile(path) as archive:
        assert archive.testzip() is None, f"{path}: invalid ZIP data"
        for name in archive.namelist():
            if not name.endswith(".xml"):
                continue
            root = ET.fromstring(archive.read(name))
            if not re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name):
                continue
            tags = [child.tag.removeprefix(NS) for child in root]
            counts = Counter(tags)
            for tag, count in counts.items():
                if tag != "conditionalFormatting":
                    assert count == 1, f"{path}/{name}: duplicate {tag}"
            positions = [ORDER.index(tag) for tag in tags if tag in ORDER]
            assert positions == sorted(positions), f"{path}/{name}: invalid element order"
            cells = [c.attrib["r"] for c in root.iter(NS + "c")]
            assert len(cells) == len(set(cells)), f"{path}/{name}: duplicate cells"
    print(f"Validated: {path}")


if __name__ == "__main__":
    paths = sys.argv[1:] or [
        str(Path(__file__).resolve().parents[1] / "nbv_turniermodi_excel" /
            "T16a_9-Spieler-Kalender-Vorlage.xlsx")
    ]
    for path in paths:
        validate(path)
