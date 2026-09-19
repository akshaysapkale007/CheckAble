# Mixed hackathon dataset

The local bundle at `data/datasets/hackathon/` contains **500 real Djinni profiles, 500 existing synthetic resumes, and 20 synthetic job descriptions**. No resumes or questions were generated and no candidates were assessed while creating it.

## Open the prepared workspace

```powershell
npm run dataset:demo
```

Open **http://127.0.0.1:3001**. The first launch initializes `data/hackathon-workspace/` from the verified template. Later launches reuse that workspace and its saved work. The normal `data/workspace.json` remains separate. Run only one server per workspace directory. If port 3001 is occupied, use `npm run dataset:demo -- --port 3002`.

Select one of the 20 roles, review its JD, then generate or manually add and approve criteria. All imported roles start with an empty active brief. Evaluation is a separate, explicit action and uses the existing Jev MCP workflow. The candidates initially have no answers or scores.

## Files to feed into the project

| File | Purpose |
| --- | --- |
| `candidates.json` | Preferred import: the app's `{ id, name, text, fictional }` JSON array, 1,000 records. |
| `candidates.csv` | Optional three-column interchange file: `id`, `name`, `text`; exact multiline text. Synthetic names are labeled, but the CSV format does not carry the JSON fictional flag. |
| `roles.json` | 20 objects validated against the app's `roleSchema`, with original JD fields and no approved criteria. |
| `jobs.txt` | Readable JDs for manual copy/paste into the existing role editor. |
| `workspace.json` | Fresh app workspace template containing all candidates, roles, and the existing question library. Used by `dataset:demo`; not a candidate-import file. |
| `sources.json` | Original selected source rows, source row indices, pinned revisions, download hashes, and sampling metadata. |
| `provenance.json` | Canonical IDs mapped to source IDs, source row indices, transformations, and text SHA-256 hashes. |
| `manifest.json` | Counts, distributions, sample method, source links, license metadata, coverage, and artifact checksums. |

To append candidates to the normal workspace instead, use **Import resumes → Choose file → candidates.json → Import candidates**. Existing records are preserved; importing again rejects duplicate IDs. The import dialog accepts candidate files, not `roles.json` or the workspace template. For all candidates and roles together, use `dataset:demo`.

## Mapping and sampling

- Djinni `CV` is copied verbatim, including whitespace. `Position` supplies a display label; no candidate names are inferred. Other original fields remain in `sources.json`.
- Synthetic resumes are structured records, not original PDF/CV documents. Role, seniority, experience years, industry, education, skills, summary, and experience bullets are formatted in a fixed order. Source field values remain unchanged. No accomplishments are added.
- Synthetic JDs similarly include title, seniority, industry, description, required/preferred skills, responsibilities, and requirements.
- Canonical IDs are `djinni_<source id>` and `synthetic_<source id>`. Source/fictional labels are metadata, not additions to resume evidence or ranking signals.
- Candidate IDs are ordered by a seeded SHA-256 key (`candidate-explorer-42-v1`); the first 500 valid unique records per source are selected. Blank, invalid, oversized, or duplicate records are skipped with reasons counted in the manifest. Short records are retained for the application's insufficient-detail handling.
- Jobs cover 20 distinct titles, including backend engineering, financial analysis, and business analysis, and rotate junior/mid/senior levels. This is a demo sample, not a representative hiring benchmark. Same-title counts indicate pool coverage, not candidate suitability.
- Source matching labels and embeddings are not downloaded or imported. Ranking still uses only Jev's native `role_relevance.score`, with candidate ID ties.

## Sources and attribution

Both dataset cards declare MIT licensing. Pinned source revisions and verified Parquet SHA-256 hashes are recorded in the manifest.

1. [Djinni English candidate profiles](https://huggingface.co/datasets/lang-uk/recruitment-dataset-candidate-profiles-english), revision `86255174c6c378a2b52cd7e81d79002c64d899a6`, 210,250 source records. Attribution: Nazarii Drushchak and Mariana Romanyshyn, *Introducing the Djinni Recruitment Dataset: A Corpus of Anonymized CVs and Job Postings*, UNLP 2024, [paper](https://aclanthology.org/2024.unlp-1.2/). Public platform profiles are described as anonymized by the publisher; this pipeline does not independently certify anonymity or authorship.
2. [Michael Ozon's Candidate Matching Synthetic Dataset](https://huggingface.co/datasets/michaelozon/candidate-matching-synthetic), revision `178ab864dcad9910c5670d43e4bdbbb901a11f18`. The downloaded `resumes/train-00000-of-00001.parquet` and `jobs/train-00000-of-00001.parquet` contain 10,000 and 2,500 rows. Its card reports Qwen 2.5 generation with deterministic fallbacks, so synthetic provenance does not mean every record is model-written. Many work bullets are generic: preserve that limitation when demonstrating evidence assessment.

The bundle stays under ignored `data/`, outside `public/`. Its size is below the app's 20 MB upload limit. Evaluation transmits resume text to Jev only when explicitly started; opening or building the dataset makes no model calls.

## Reproduce and validate

Requires Node dependencies (`npm install`), Python 3.10+, and PyArrow (`python -m pip install pyarrow`). No Hugging Face token is needed. Set `PYTHON` to a different Python executable if necessary.

```powershell
npm run dataset:build
npm run dataset:check
npm run typecheck
npm test
npm run build
```

The first build caches about 240 MB of pinned Parquet sources in `data/dataset-cache/`; it publishes only the complete validated small sample bundle. Downloads are checked against Hugging Face LFS SHA-256 metadata, including cached files. A second build verifies and reuses the existing bundle, without overwriting saved work. On a new checkout, the pinned revisions and fixed sampling seed reproduce the candidate and role files; the retrieval timestamp can differ.

`dataset:check` verifies artifact hashes, exact source-to-text mappings, unique IDs/content, expected counts, JSON/CSV import compatibility, role schema, and the unassessed workspace template. Automated adapter tests remain separate from real dataset validation. No live Jev/OpenRouter test is part of this workflow.
