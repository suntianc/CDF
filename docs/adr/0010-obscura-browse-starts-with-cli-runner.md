# Obscura Browse starts with a CLI runner

CDF will expose `obscura_browse` first as a single-URL rendered page Agent Tool backed by Obscura's CLI fetch path, while keeping the main-process Obscura execution behind a small runner boundary. CDP or MCP session automation is reserved for the later Crawler Skill work after crawler requirements are researched, so issue #23 stays focused on packaging and rendered page retrieval without making the browser integration impossible to extend.
