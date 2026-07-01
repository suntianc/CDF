# PDF parse diagnostics use stable codes

CDF's PDF parsing contract will expose diagnostics as structured entries with `severity`, stable `code`, human-readable `message`, and optional page information instead of returning parser stderr as untyped text. The first code set should cover Marker availability, cold start, timeout, exit errors, slow parses, OCR artifacts, missing table structure, figure-only content, and weak source location so Agents and tests can make consistent decisions from known parser failure modes.
