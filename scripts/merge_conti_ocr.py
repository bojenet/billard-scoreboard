#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path


def score_text(text: str):
    raw = (text or '').strip()
    chars = len(raw)
    letters = sum(ch.isalpha() for ch in raw)
    digits = sum(ch.isdigit() for ch in raw)
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    words = re.findall(r"[A-Za-zÀ-ÿ]{2,}", raw)
    alpha_ratio = (letters / chars) if chars else 0.0
    normalized = {w.lower() for w in words}
    keywords = {
        'bille', 'billes', 'bande', 'bandes', 'gauche', 'droite', 'effet', 'rouge',
        'position', 'finesse', 'direct', 'jouer', 'toucher', 'point', 'attention', 'execution', 'exécution'
    }
    keyword_hits = sorted(normalized & keywords)
    return {
        'chars': chars,
        'letters': letters,
        'digits': digits,
        'lines': len(lines),
        'words': len(words),
        'alpha_ratio': alpha_ratio,
        'keyword_hits': keyword_hits,
        'keep': chars >= 260 and len(lines) >= 8 and len(words) >= 45 and alpha_ratio >= 0.55 and len(keyword_hits) >= 4,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--positions', required=True)
    parser.add_argument('--ocr', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--write-source', action='store_true')
    args = parser.parse_args()

    positions_path = Path(args.positions)
    ocr_path = Path(args.ocr)
    report_path = Path(args.report)

    positions = json.loads(positions_path.read_text())
    ocr_export = json.loads(ocr_path.read_text())
    pages = ocr_export.get('pages', [])
    by_number = {item['number']: item for item in positions}

    kept = []
    skipped = []

    for page in pages:
        number = page.get('number')
        text = page.get('sourceText', '')
        metrics = score_text(text)
        item = by_number.get(number)
        if not item:
            skipped.append({'number': number, 'reason': 'position_missing', **metrics})
            continue
        if not metrics['keep']:
            skipped.append({'number': number, 'reason': 'quality_below_threshold', **metrics})
            continue
        if args.write_source:
            item['sourceText'] = text
            if item.get('ocrStatus') in (None, '', 'idle', 'pending', 'running', 'failed'):
                item['ocrStatus'] = 'done'
        kept.append({'number': number, **metrics})

    if args.write_source:
        positions_path.write_text(json.dumps(positions, ensure_ascii=False, indent=2) + '\n')

    report = {
        'ocr_file': str(ocr_path),
        'positions_file': str(positions_path),
        'kept_count': len(kept),
        'skipped_count': len(skipped),
        'kept': kept,
        'skipped': skipped,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f"kept={len(kept)} skipped={len(skipped)} report={report_path}")


if __name__ == '__main__':
    main()
