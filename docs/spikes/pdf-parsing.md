# PDF Parsing Spike Report

This report captures issue #25, the PDF parsing Spike for CDF. The goal is not visual Markdown fidelity; the goal is a Structured Paper Parse that Agents can retrieve, cite, and chunk for RAG while preserving semantic order and source location.

Experiment date: 2026-07-01.

## Decision

- Selected default parser: Marker.
- Default production path: run Marker locally in the main-process parsing module and map its Markdown, page anchors, images, tables, equations, and metadata into `StructuredPaperParse`.
- Optional fallback path: use a multimodal LLM parser, tested with MiniMax-M3 through the Anthropic-compatible MiniMax endpoint, only for Marker failures, scanned or visually complex pages, figure/table recovery, or explicit high-cost reparse requests.
- Recommendation rationale: Marker is offline-capable, produces useful Markdown with page-level anchors, preserves references, handles many tables and formulas, and avoids recurring network cost. MiniMax-M3 was faster per sampled page and better at visually describing charts/tables, but it is network-dependent, cost-bearing, can truncate structured output under token limits, and does not naturally produce whole-document block/source indexing without orchestration.

## Test Corpus

PDF files were downloaded into the gitignored local experiment directory `.planning/pdf-parsing/corpus/`. They are not committed. Selection was by parsing risk, not research topic.

### Corpus Manifest

| Paper | Source URL | Version/download date | SHA-256 | Risk labels | Local reproduction path | Evaluated pages |
| --- | --- | --- | --- | --- | --- | --- |
| Attention Is All You Need | https://arxiv.org/pdf/1706.03762 | downloaded 2026-07-01 | `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697` | double-column English, formulas, figures, long references | `.planning/pdf-parsing/corpus/attention-is-all-you-need.pdf` | Marker: 1, 3, 10; LLM: 3 |
| Dropout: A Simple Way to Prevent Neural Networks from Overfitting | https://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf | downloaded 2026-07-01 | `9c196ccbe6c6a595a1adba6cd030d35f7c2e548bbf5e7f1278b0109d8dd9ebaa` | single-column English, tables, appendix, formulas | `.planning/pdf-parsing/corpus/dropout-jmlr.pdf` | Marker: 1, 10, 25; LLM: 10 |
| 词义分布的空间维度: 从文本符号到词向量表征 | https://arxiv.org/pdf/1911.00845 | downloaded 2026-07-01 | `6f2928158f36409b429866ceaedcb8ba7f6af1d12c13f2383d6813d9a4ce4d14` | Chinese, bilingual abstract, code/table snippet, references | `.planning/pdf-parsing/corpus/chinese-word-embedding.pdf` | Marker: 1, 3, 10; LLM: 1 |
| 基于深度学习的代码生成方法研究进展 | https://arxiv.org/pdf/2303.01056 | downloaded 2026-07-01 | `1f9209caab32aa8f2bda9fb6deb4cdb5e86c791587ff623071274b57f7aef580` | Chinese survey, dense paragraphs, long references, code terms | `.planning/pdf-parsing/corpus/word-vector-code-generation-cn.pdf` | Marker: 1, 8, 20; LLM: 8 |
| TabFact | https://arxiv.org/pdf/1909.02164 | downloaded 2026-07-01 | `365b19479b3bae6e0f2c11a38ea8066f2df40a57e17374d33a8038a38723e5e3` | table-heavy, chart-heavy, benchmark examples | `.planning/pdf-parsing/corpus/tabfact.pdf` | Marker: 1, 4, 16; LLM: 4 |
| Deep Residual Learning for Image Recognition | https://arxiv.org/pdf/1512.03385 | downloaded 2026-07-01 | `1e0651b6810ecba34a3dbc5b5b0209226f889004607c1f203540a48d64e5a93a` | figure-heavy, architecture table, formulas, references | `.planning/pdf-parsing/corpus/deep-residual-learning.pdf` | Marker: 1, 5, 11; LLM: 5 |
| A Variational Inequality Perspective on GANs | https://arxiv.org/pdf/1802.10551 | downloaded 2026-07-01 | `5addb3f10243a2959b147349852a68cbd53d3aaad6e3ab2eee46f0eedce66597` | formula-heavy, long appendix, figure references | `.planning/pdf-parsing/corpus/papers-with-code.pdf` | Marker: 1, 16, 35; LLM: 16 |
| 语义万维网中基于符号变换的超协调表演算 | https://arxiv.org/pdf/1301.2146 | downloaded 2026-07-01 | `56c949826eb360d4f0ae2a96180e370af0ffab22b3b4afbd93143da10f45c69d` | Chinese, logic notation, references | `.planning/pdf-parsing/corpus/semantic-web-cn.pdf` | Marker: 1, 4, 10; LLM: 4 |
| Handwritten Digit Recognition with a Back-Propagation Network | https://proceedings.neurips.cc/paper_files/paper/1989/file/53c3bce66e43be4f209556518c2fcb54-Paper.pdf | downloaded 2026-07-01 | `eacef74bc911e24fc1e5fb67c2ed7a0d99a4484b403d42d73b18431718cfeded` | old low-quality scan/photocopy, figures, references | `.planning/pdf-parsing/corpus/handwritten-digit-recognition-1989.pdf` | Marker: 1, 4, 8; LLM: 4 |

## Experiment Method

Marker was run with:

```bash
uvx --from marker-pdf marker_single <pdf> --page_range <pages> --output_format markdown --output_dir .planning/pdf-parsing/marker/<case> --disable_tqdm
```

The first Marker run downloaded local model assets: layout model about 1.35GB, text recognition model about 1.34GB, and OCR error detection model about 258MB. This cold-start cost is not included in the per-document conversion times below, but it matters for packaging and first-run UX.

MiniMax-M3 was called through `https://api.minimaxi.com/anthropic/v1/messages` with one rendered JPEG page per paper. The API and pricing references used for the experiment were MiniMax's Anthropic-compatible API docs and pay-as-you-go pricing docs:

- https://platform.minimax.io/docs/api-reference/text-chat-anthropic
- https://platform.minimax.io/docs/guides/pricing-paygo

Observed MiniMax-M3 usage across 9 sampled pages:

- Input tokens: 13,834
- Output tokens: 12,600
- Cache-read tokens: 1,088
- Total wall time: 196.77 seconds
- Estimated standard-tier cost at $0.30/M input, $1.20/M output, $0.06/M cache-read: about $0.0193

## Evaluation Matrix

Rating meanings:

- `pass`: Good enough for the Structured Paper Parse contract without manual repair.
- `partial`: Usable with known gaps, fallback, or post-processing.
- `fail`: Not usable for that criterion and should become a failure sample or fallback condition.
- `n/a`: Criterion does not apply to this paper or sampled page.

| Paper | Parser | Section order | Paragraph integrity | Formulas | Tables | Figures/captions | References | Source location | Speed | Cost | Offline availability | Integration complexity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Attention Is All You Need | Marker | `pass` - title, abstract, section 1 and reference pages preserve order | `partial` - some double-column paragraphs are line-joined but readable | `partial` - inline formulas survive; complex display math needs normalization | `n/a` - sampled pages did not include table | `partial` - figure image extracted and caption retained | `pass` - references extracted with page anchors | `pass` - outputs `<span id="page-...">` anchors | `partial` - 41.8s conversion after cold model download | `pass` - no per-call cost | `pass` | `partial` - large first-run model download |
| Attention Is All You Need | MiniMax-M3 | `pass` - section 3.1 then 3.2 preserved on sampled page | `pass` - Encoder/Decoder paragraphs complete | `partial` - `LayerNorm(x + Sublayer(x))` kept as text, not canonical LaTeX | `n/a` | `partial` - caption described but diagram internals summarized | `n/a` | `pass` - page and section included in JSON | `pass` - 18.47s for one page | `partial` - metered API, about $0.002 page share | `fail` | `partial` - needs image rendering, retry, schema limiting |
| Dropout | Marker | `pass` - section, appendix, and table page are ordered | `partial` - long appendix text is readable but may be truncated by selected pages | `partial` - inline symbols and dimensions retained | `pass` - SVHN table parsed into Markdown | `n/a` | `partial` - references not in sampled pages | `partial` - page anchors exist but table row source is page-level | `pass` - 15.2s conversion, 25.8s wall | `pass` | `pass` | `pass` - straightforward local Markdown |
| Dropout | MiniMax-M3 | `pass` - sampled table context preserved | `partial` - output hit max token budget before complete JSON | `n/a` | `pass` - table reconstructed accurately | `n/a` | `n/a` | `partial` - page noted but no stable block anchors | `pass` - 20.83s for one page | `partial` | `fail` | `partial` - max token budget must be constrained |
| Chinese word embedding | Marker | `pass` - Chinese and English title/abstract order preserved | `pass` - Chinese paragraphs are readable | `n/a` | `partial` - code/table snippet converted, but cell structure is noisy | `n/a` | `pass` - reference list retained | `pass` - page anchors retained | `pass` - 16.9s conversion, 22.5s wall | `pass` | `pass` | `pass` |
| Chinese word embedding | MiniMax-M3 | `pass` - bilingual title, abstract and keywords ordered | `partial` - Chinese OCR has small semantic substitutions | `n/a` | `n/a` | `n/a` | `partial` - footnote/funding is visible but not reference-typed | `pass` - page and section context provided | `pass` - 28.62s for one page | `partial` | `fail` | `partial` - Chinese text needs validation |
| Chinese code generation survey | Marker | `partial` - opening and later section order preserved for sampled pages | `partial` - dense Chinese paragraphs are readable but long lines merge | `n/a` | `n/a` | `n/a` | `partial` - selected reference page not fully covered | `pass` - page anchors retained | `fail` - 315.7s conversion | `pass` | `pass` | `partial` - unexpectedly slow on this PDF |
| Chinese code generation survey | MiniMax-M3 | `pass` - sampled prose follows original order | `partial` - dense page output was truncated at max tokens | `n/a` | `n/a` | `n/a` | `partial` - inline references are text only | `partial` - page known, no durable anchors | `pass` - 19.99s for one page | `partial` | `fail` | `partial` - schema must prevent overlong extraction |
| TabFact | Marker | `pass` - introduction, stats section, model/error pages ordered | `pass` - prose around dataset stats readable | `n/a` | `pass` - Table 1 converted to Markdown | `partial` - charts extracted as images with captions, not data | `n/a` | `pass` - page anchors retained | `fail` - 332.8s conversion | `pass` | `pass` | `partial` - slow on table/figure-heavy sample |
| TabFact | MiniMax-M3 | `pass` - chart then table then section order retained | `partial` - JSON truncated after long table prose | `n/a` | `pass` - table reconstructed with rows/columns | `pass` - bar chart described semantically | `n/a` | `partial` - source page only | `pass` - 18.65s for one page | `partial` | `fail` | `partial` - output length constraints required |
| ResNet | Marker | `pass` - title, intro, table, and later detection section ordered | `pass` - paragraphs readable | `partial` - formulas and table notation retained with some normalization needs | `pass` - architecture tables converted | `partial` - figures extracted with captions, charts not semantically summarized | `partial` - sampled reference citations retained, full refs not covered | `pass` - page anchors retained | `partial` - 167.2s conversion | `pass` | `pass` | `partial` - heavy vision papers are slow |
| ResNet | MiniMax-M3 | `partial` - table and figure context captured, but output truncated | `partial` - prose limited by token budget | `partial` - notation such as `7x7` and FLOPs retained | `pass` - architecture table reconstructed | `pass` - Figure 4 described | `n/a` | `partial` - page only | `pass` - 25.99s for one page | `partial` | `fail` | `partial` - good visual understanding, weak whole-doc indexing |
| GAN variational inequality paper | Marker | `pass` - abstract, formulas, appendix and figure page ordered | `pass` - paragraphs readable | `pass` - display equations 49-58 preserved in LaTeX-like Markdown | `n/a` | `partial` - figure image and caption retained | `partial` - sampled pages include inline refs, not full list | `pass` - page anchors retained | `partial` - 97.9s conversion | `pass` | `pass` | `pass` |
| GAN variational inequality paper | MiniMax-M3 | `partial` - formula sequence preserved but JSON truncated | `partial` - long equation prose exceeded budget | `pass` - formulas transcribed well on sampled page | `n/a` | `n/a` | `n/a` | `partial` - page only | `pass` - 18.27s for one page | `partial` | `fail` | `partial` - needs page chunking and token caps |
| Chinese semantic web | Marker | `pass` - bilingual metadata, section 3, and references ordered | `pass` - Chinese prose readable | `partial` - logic symbols mostly retained, some mojibake such as `ᨀ` appears | `n/a` | `n/a` | `pass` - references extracted | `pass` - page anchors retained | `pass` - 10.8s conversion, 16.0s wall | `pass` | `pass` | `pass` |
| Chinese semantic web | MiniMax-M3 | `pass` - section 3.1 and definitions ordered | `partial` - OCR substitutions in symbols and variables | `partial` - ALC/logical notation partly normalized but not exact | `n/a` | `n/a` | `n/a` | `partial` - page only | `pass` - 26.00s for one page | `partial` | `fail` | `partial` - symbolic notation requires validation |
| Handwritten Digit Recognition 1989 | Marker | `pass` - sections 1 and 6 plus references ordered | `partial` - scanned-page continuation text starts mid-sentence | `n/a` | `n/a` | `pass` - figures extracted and captions retained | `pass` - references extracted | `pass` - page anchors retained | `pass` - 11.7s conversion, 16.8s wall | `pass` | `pass` | `pass` |
| Handwritten Digit Recognition 1989 | MiniMax-M3 | `partial` - running header and continuation page captured, no section heading | `pass` - paragraph readable despite scan | `n/a` | `n/a` | `partial` - figure caption read, image internals only summarized | `n/a` | `partial` - page only | `pass` - 19.95s for one page | `partial` | `fail` | `partial` - good scan OCR, no whole-document anchors |

## Structured Paper Parse Contract Example

Issue #30 should expose a parser-independent interface. The Marker implementation can fill this contract from Markdown sections, page anchors, extracted image paths, tables, and metadata; the LLM fallback can fill it from page-scoped JSON.

```ts
interface StructuredPaperParse {
  parser: 'marker' | 'minimax-m3';
  sourceFile: string;
  markdown: string;
  blocks: Array<{
    id: string;
    type: 'heading' | 'paragraph' | 'formula' | 'table' | 'figure' | 'reference';
    text: string;
    section: string;
    pageStart: number;
    pageEnd: number;
    location: {
      pageStart: number;
      pageEnd: number;
      section: string;
      markerAnchor?: string;
      bbox?: [number, number, number, number];
      imagePath?: string;
      parserDetails?: unknown;
    };
  }>;
  diagnostics: Array<{
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    page?: number;
  }>;
}
```

Recommended first implementation shape:

- `parsePDF(filePath, options?) -> StructuredPaperParse`
- Default `options.parser = 'marker'`
- `options.pageRange` exists for tests, previews, and recovery
- `options.fallback = 'none' | 'llm-on-marker-failure' | 'llm-for-selected-pages'`
- Store parser diagnostics so Agent tools can explain source confidence instead of returning silent best-effort Markdown

## Failure Samples

### Marker: table/figure-heavy PDFs can be slow

- Paper: TabFact
- Parser: Marker
- Location: pages 1, 4, 16 sample
- Expected structure: parse dataset tables and figure captions into block-level table and figure blocks in interactive time
- Actual output: Table 1 and figure captions were usable, but conversion took 332.8 seconds after model cache was warm
- Failure type: performance risk
- Notes for #30 regression coverage: add a timeout/diagnostic path and test that the Agent tool reports slow parsing state instead of appearing hung

### Marker: dense Chinese survey can be unexpectedly slow

- Paper: 基于深度学习的代码生成方法研究进展
- Parser: Marker
- Location: pages 1, 8, 20 sample
- Expected structure: Chinese survey pages should parse similarly to other Chinese papers
- Actual output: readable Markdown, but conversion took 315.7 seconds
- Failure type: performance variance
- Notes for #30 regression coverage: page-range parse should be cancellable; full-document ingestion should run as a background job

### Marker: Chinese symbolic PDFs need post-processing

- Paper: 语义万维网中基于符号变换的超协调表演算
- Parser: Marker
- Location: page 1 and page 4
- Expected structure: Chinese prose and logic notation preserved exactly enough for retrieval and citation
- Actual output: most content was readable, but OCR/text extraction produced artifacts such as `ᨀ` in place of Chinese characters and some logic notation simplification
- Failure type: OCR/text normalization
- Notes for #30 regression coverage: flag low-confidence Unicode artifacts and keep original page reference

### MiniMax-M3: output can truncate under broad extraction prompts

- Paper: multiple sampled pages, including Dropout, TabFact, ResNet, GAN appendix, and Chinese code generation survey
- Parser: MiniMax-M3
- Location: single rendered pages
- Expected structure: strict JSON with `markdown_excerpt`, `blocks`, `ratings`, `failure_samples`, and `notes`
- Actual output: the model produced useful extraction text, but several responses hit the 1,400 output-token cap before complete strict JSON
- Failure type: schema/length control
- Notes for #30 regression coverage: production fallback must use a narrow schema, lower block count, and page-by-page retries with JSON repair

### MiniMax-M3: source location is page-scoped unless CDF adds anchors

- Paper: all sampled pages
- Parser: MiniMax-M3
- Location: rendered page images
- Expected structure: block-level Paper Source Location comparable to Marker page anchors
- Actual output: the model can report page number and section context, but it does not provide stable anchors or coordinates unless prompted and validated per block
- Failure type: source grounding gap
- Notes for #30 regression coverage: LLM fallback should attach CDF-generated page IDs and optional bbox/page crop metadata rather than trusting prose-only locations

## Recommendation

Use Marker as the default first production parser in #30.

Reasons:

- It works offline after first model setup.
- It produced durable Markdown, image files, tables, formulas, references, and page anchors suitable for CDF's `StructuredPaperParse`.
- Its output is deterministic enough for tests and background ingestion.
- It avoids routine API cost and privacy/network constraints for local Paper Library ingestion.

Do not make multimodal LLM parsing the default in #30.

Reasons:

- The MiniMax-M3 page results were strong for table reconstruction, chart description, Chinese OCR, and scanned-page recovery, but the run was inherently online and metered.
- The model returned useful page-level extraction but not reliable whole-document block/source indexing by itself.
- Several sampled pages truncated when asked for a rich JSON payload, so production use needs careful schema control.

Use MiniMax-M3 or another multimodal LLM as an explicit fallback/enhancement:

- Marker fails or times out.
- User asks to recover a specific scanned, low-quality, or visually complex page.
- Agent needs semantic figure/table description beyond Marker's extracted image and caption.
- User explicitly accepts network use and cost for a high-quality reparse.

## Handoff To #30

#30 should implement the first vertical slice around Marker:

- Integrate Marker behind `parsePDF(filePath) -> StructuredPaperParse`.
- Run parsing as a cancellable/background main-process job because warm Marker conversion ranged from 10.8s to 332.8s on selected risk pages.
- Preserve page-level source grounding from Marker anchors and parser metadata.
- Convert Markdown sections, tables, formulas, figures, and references into block-level `StructuredPaperParse.blocks`.
- Surface diagnostics for slow pages, OCR artifacts, missing table structure, and figure-only content.
- Keep the parser interface open for `llm-on-marker-failure` without shipping LLM fallback in the first integration slice.

Follow-up issue recommended:

- Title: `PDF 解析 LLM fallback 与视觉页恢复`
- Scope: add optional MiniMax-M3 or provider-agnostic multimodal fallback for selected pages, with JSON schema control, page image rendering, cost reporting, and block-level source grounding.
