// Minimal payload — renderer infers `kind` from `path.endsWith('/')`.
// `truncated: true` signals the popup should display a banner.
export interface AtMentionCandidateList {
  candidates: string[];
  truncated: boolean;
}

// The main-side BFS caps results at this number; the store's defensive slice
// and the truncated-banner string both reference it.
export const MAX_AT_MENTION_CANDIDATES = 5000;
