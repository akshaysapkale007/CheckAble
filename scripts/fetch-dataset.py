"""Fetch pinned public Parquet files and select the demo pool. No model calls."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/dataset-cache"
SEED = "candidate-explorer-42-v1"
SOURCES = {
    "djinni": {
        "dataset": "lang-uk/recruitment-dataset-candidate-profiles-english",
        "revision": "86255174c6c378a2b52cd7e81d79002c64d899a6",
        "file": "data/train-00000-of-00001.parquet",
        "id_field": "id",
    },
    "synthetic_resumes": {
        "dataset": "michaelozon/candidate-matching-synthetic",
        "revision": "178ab864dcad9910c5670d43e4bdbbb901a11f18",
        "file": "resumes/train-00000-of-00001.parquet",
        "id_field": "resume_id",
    },
    "synthetic_jobs": {
        "dataset": "michaelozon/candidate-matching-synthetic",
        "revision": "178ab864dcad9910c5670d43e4bdbbb901a11f18",
        "file": "jobs/train-00000-of-00001.parquet",
        "id_field": "job_id",
    },
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def order(label, identity):
    return digest(f"{SEED}:{label}:{identity}".encode("utf-8"))


def download(label, spec):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / f"{label}-{spec['revision']}.parquet"
    url = f"https://huggingface.co/datasets/{spec['dataset']}/resolve/{spec['revision']}/{spec['file']}"
    # Validate even cached downloads against Hugging Face's content-addressed file metadata.
    api = f"https://huggingface.co/api/datasets/{spec['dataset']}/tree/{spec['revision']}/{spec['file'].rsplit('/', 1)[0]}"
    with urllib.request.urlopen(api, timeout=60) as response:
        metadata = json.load(response)
    info = next(entry for entry in metadata if entry['path'] == spec['file'])
    expected = info['lfs']['oid']
    if not target.exists():
        print(f"Downloading {label} ({info['size']:,} bytes)", flush=True)
        temporary = target.with_suffix('.part')
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as stream:
            while chunk := response.read(1024 * 1024):
                stream.write(chunk)
        if digest(temporary.read_bytes()) != expected:
            raise ValueError(f"Checksum mismatch for {label}; incomplete download retained as .part")
        os.replace(temporary, target)
    actual = digest(target.read_bytes())
    if actual != expected:
        raise ValueError(f"Cached {label} checksum mismatch; remove that cache file and retry")
    parquet = pq.ParquetFile(target)
    rows = []
    for batch in parquet.iter_batches(batch_size=4096):
        rows.extend(batch.to_pylist())
    print(f"Read {label}: {len(rows):,} records", flush=True)
    return rows, {**spec, "url": url, "sha256": actual, "bytes": target.stat().st_size,
                  "row_count": len(rows), "license": "mit"}


def select_candidates(label, rows, id_field):
    selected, seen_ids, seen_text, skipped = [], set(), set(), Counter()
    indexed = sorted(enumerate(rows), key=lambda pair: (order(label, str(pair[1].get(id_field))), pair[0]))
    for index, row in indexed:
        identity = row.get(id_field)
        if not isinstance(identity, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identity):
            skipped['invalid_id'] += 1
            continue
        if identity in seen_ids:
            skipped['duplicate_id'] += 1
            continue
        if label == 'djinni':
            text = row.get('CV')
            if row.get('CV_lang') != 'en':
                skipped['non_english_source_label'] += 1
                continue
            if not isinstance(text, str) or not text.strip():
                skipped['empty_text'] += 1
                continue
            if len(text.encode('utf-16-le')) // 2 > 100000:
                skipped['over_import_limit'] += 1
                continue
            content_hash = digest(text.encode('utf-8'))
        else:
            # Ignore the ID when detecting identical structured resumes.
            content_hash = digest(json.dumps({k: v for k, v in row.items() if k != id_field},
                                             sort_keys=True, ensure_ascii=False).encode('utf-8'))
        if content_hash in seen_text:
            skipped['duplicate_content'] += 1
            continue
        seen_ids.add(identity)
        seen_text.add(content_hash)
        selected.append({"row_index": index, "row": row})
        if len(selected) == 500:
            break
    if len(selected) != 500:
        raise ValueError(f"Only {len(selected)} usable {label} records")
    return selected, dict(skipped)


def select_jobs(rows):
    # Cover 20 distinct job titles; include the app's backend/finance/business use cases.
    titles = sorted({row['job_title'] for row in rows}, key=lambda title: order('job-title', title))
    preferred = ['Backend Engineer', 'Financial Analyst', 'Business Analyst']
    titles = preferred + [title for title in titles if title not in preferred]
    selected = []
    for number, title in enumerate(titles[:20]):
        seniority = ['Junior', 'Mid', 'Senior'][number % 3]
        options = [(i, row) for i, row in enumerate(rows) if row['job_title'] == title and row['seniority'] == seniority]
        if not options:
            options = [(i, row) for i, row in enumerate(rows) if row['job_title'] == title]
        index, row = min(options, key=lambda pair: order('job', pair[1]['job_id']))
        selected.append({"row_index": index, "row": row})
    if len(selected) != 20:
        raise ValueError('Expected 20 distinct job titles')
    return selected


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python scripts/fetch-dataset.py OUTPUT_JSON')
    tables, sources = {}, {}
    for label, spec in SOURCES.items():
        tables[label], sources[label] = download(label, spec)
    real, real_skipped = select_candidates('djinni', tables['djinni'], 'id')
    synthetic, synthetic_skipped = select_candidates('synthetic_resumes', tables['synthetic_resumes'], 'resume_id')
    jobs = select_jobs(tables['synthetic_jobs'])
    output = {
        "schema_version": 1, "seed": SEED, "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "sources": sources, "djinni": real, "synthetic_resumes": synthetic, "synthetic_jobs": jobs,
        "sampling": {"candidates": "SHA-256 seeded ordering of source IDs; first 500 valid, unique records per source",
                     "jobs": "20 distinct titles, including backend/finance/business; rotate Junior/Mid/Senior",
                     "skipped_before_quota": {"djinni": real_skipped, "synthetic_resumes": synthetic_skipped}},
    }
    target = Path(sys.argv[1])
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(output, ensure_ascii=False, allow_nan=False, indent=2), encoding='utf-8')
    os.replace(temporary, target)
    print('Selected 500 Djinni resumes, 500 synthetic resumes, and 20 synthetic jobs.', flush=True)


if __name__ == '__main__':
    main()
