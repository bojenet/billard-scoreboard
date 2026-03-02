#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--positions', required=True)
    parser.add_argument('--ocr', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    positions = json.loads(Path(args.positions).read_text())
    ocr = json.loads(Path(args.ocr).read_text())
    report = json.loads(Path(args.report).read_text())

    kept_numbers = {item['number'] for item in report.get('kept', [])}
    ocr_by_number = {item['number']: item for item in ocr.get('pages', [])}
    pos_by_number = {item['number']: item for item in positions}

    review_rows = []
    for number in sorted(kept_numbers):
        pos = pos_by_number.get(number)
        page = ocr_by_number.get(number)
        if not pos or not page:
            continue
        review_rows.append({
            'number': number,
            'id': pos['id'],
            'title': pos.get('title') or f'Fiche {number}',
            'pdfPage': pos.get('pdfPage'),
            'sourceText': page.get('sourceText', ''),
            'translatedComments': pos.get('comments', []) if pos.get('comments') else [],
            'reviewStatus': 'todo'
        })

    out = {
        'positionsFile': str(Path(args.positions)),
        'ocrFile': str(Path(args.ocr)),
        'reportFile': str(Path(args.report)),
        'count': len(review_rows),
        'items': review_rows
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
    print(f'wrote {len(review_rows)} review items to {args.out}')


if __name__ == '__main__':
    main()
