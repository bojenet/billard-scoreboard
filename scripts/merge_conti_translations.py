#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--positions', required=True)
    parser.add_argument('--review', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()

    positions_path = Path(args.positions)
    review_path = Path(args.review)
    report_path = Path(args.report)

    positions = json.loads(positions_path.read_text())
    review = json.loads(review_path.read_text())
    by_id = {item['id']: item for item in positions}

    merged = []
    skipped = []

    for item in review.get('items', []):
        pos = by_id.get(item.get('id'))
        comments = [x.strip() for x in item.get('translatedComments', []) if str(x).strip()]
        if not pos:
            skipped.append({'id': item.get('id'), 'number': item.get('number'), 'reason': 'position_missing'})
            continue
        if item.get('reviewStatus') not in ('done', 'approved'):
            skipped.append({'id': item.get('id'), 'number': item.get('number'), 'reason': 'review_not_done'})
            continue
        if not comments:
            skipped.append({'id': item.get('id'), 'number': item.get('number'), 'reason': 'no_translated_comments'})
            continue
        pos['comments'] = comments
        merged.append({'id': item.get('id'), 'number': item.get('number'), 'comments_count': len(comments)})

    positions_path.write_text(json.dumps(positions, ensure_ascii=False, indent=2) + '\n')
    report = {
        'positionsFile': str(positions_path),
        'reviewFile': str(review_path),
        'mergedCount': len(merged),
        'skippedCount': len(skipped),
        'merged': merged,
        'skipped': skipped,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'merged={len(merged)} skipped={len(skipped)} report={report_path}')


if __name__ == '__main__':
    main()
