# Obscura Browser Tool owns rendered page access

CDF will split URL reading into two Agent Tools: the Fetch Tool handles lightweight URL content retrieval, and the Obscura Browser Tool handles pages that need a browser environment before content can be extracted. This keeps Agent tool choice explicit and avoids preserving the current ambiguity where `fetch` internally uses a hidden Electron browser despite the product plan reserving browser rendering for bundled Obscura.
