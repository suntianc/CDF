# PDF Parsing Spike Report

This report captures issue #25, the PDF parsing Spike for CDF. It should be filled by the Spike runner and linked from both issue #25 and the PDF parsing integration issue #30.

## Decision

- Selected parser: TBD
- Default production path: prefer offline-capable Marker when it is good enough for Structured Paper Parse quality.
- Optional fallback path: use multimodal LLM parsing for Marker failures, scanned or visually complex papers, or explicit high-cost reparse requests.
- Recommendation rationale: TBD

## Test Corpus

Choose 5-10 academic PDFs by parsing risk rather than research topic. Do not commit the PDF files to the repository. Record enough metadata to reproduce the corpus locally, including source link, version or download date, file hash, parsing risk labels, and local reproduction path.

Cover at least:

- Single-column English paper
- Double-column English paper
- Chinese paper
- Formula-heavy paper
- Table-heavy paper
- Figure and caption-heavy paper
- Long reference list
- Scanned or low-quality PDF

### Corpus Manifest

| Paper | Source URL | Version/download date | SHA-256 | Risk labels | Local reproduction path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | `local-corpus/pdf-parsing/TBD.pdf` | Do not commit PDF |

## Evaluation Matrix

Record each candidate parser's evidence-backed result per paper and criterion. Qualitative cells must use `pass`, `partial`, `fail`, or `n/a` plus one sentence of evidence. Quantitative cells such as speed and cost should include the measured value plus the same rating.

Rating meanings:

- `pass`: Good enough for the Structured Paper Parse contract without manual repair.
- `partial`: Usable with known gaps, fallback, or post-processing.
- `fail`: Not usable for that criterion and should become a failure sample or fallback condition.
- `n/a`: Criterion does not apply to this paper or parser run.

| Paper | Parser | Section order | Paragraph integrity | Formulas | Tables | Figures/captions | References | Source location | Speed | Cost | Offline availability | Integration complexity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | Marker | `pass` - TBD | `partial` - TBD | `fail` - TBD | `n/a` - TBD | TBD | TBD | TBD | `TBD ms` - TBD | `TBD` - TBD | TBD | TBD |
| TBD | Multimodal LLM | `pass` - TBD | `partial` - TBD | `fail` - TBD | `n/a` - TBD | TBD | TBD | TBD | `TBD ms` - TBD | `TBD` - TBD | TBD | TBD |

## Structured Paper Parse Contract Example

The Spike does not produce production code, but it must leave an example of the target output shape for issue #30.

```ts
interface StructuredPaperParse {
  markdown: string;
  blocks: Array<{
    type: 'heading' | 'paragraph' | 'formula' | 'table' | 'figure' | 'reference';
    text: string;
    section: string;
    pageStart: number;
    pageEnd: number;
    location?: unknown;
  }>;
}
```

## Failure Samples

Preserve useful failures from both parser families. Each sample should include original location, expected structure, actual output, and failure type.

### Sample Template

- Paper: TBD
- Parser: TBD
- Location: page TBD, section TBD
- Failure type: TBD
- Expected structure: TBD
- Actual output: TBD
- Notes for #30 regression coverage: TBD

## Handoff To #30

Before closing issue #25:

- Link this report from issue #25 with a short decision summary.
- Comment on or update issue #30 with the selected parser, default and fallback strategy, Structured Paper Parse Contract summary, and failure sample locations.
- Split a follow-up issue if multimodal LLM fallback is useful but should not ship in the first integration slice.
