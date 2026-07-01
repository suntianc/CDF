# Structured paper blocks start with semantic source grounding

CDF's first `StructuredPaperParse.blocks` mapper will produce semantic blocks for headings, paragraphs, tables, figures, formulas, and references with page and section source grounding, without requiring paragraph-level bounding boxes or visual layout reconstruction. Marker anchors, page ranges, and section context are enough for issue #30; finer coordinates, table cell geometry, and semantic figure recovery remain enhancements for later parsing or fallback work.
