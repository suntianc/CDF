// Phase 08.3 — E-02 / A-02 / F-03
//
// useAtMentionStore is a Zustand singleton that holds the `@` mention
// popup state. Mirrors the `useContextModalStore` template but adds the
// extra fields the popup needs (query, candidates, loading, truncated,
// cursorPos) plus the close-releases-candidates invariant (E-02 /
// RESEARCH.md pitfall #2 — a 5000-path array would otherwise sit in
// memory after the popup closes).
//
// The store is framework-agnostic (no React imports). Plan 03 wires it
// into ChatArea's `@` trigger detection + IPC call. Unit tests live in
// Plan 03's ChatArea integration tests, not here — pure-state Zustand
// stores have no meaningful unit surface to exercise.

import { create } from 'zustand';

export interface AtMentionState {
  /** Whether the popup is visible. */
  isOpen: boolean;
  /** Text after `@` (everything the user has typed since the trigger). */
  query: string;
  /** Candidate path strings. Dir paths end with `/`. */
  candidates: string[];
  /** `true` while the `project:listAtMentionCandidates` IPC call is in flight. */
  loading: boolean;
  /** `true` when main returned more than 5000 candidates (E-03 — truncated). */
  truncated: boolean;
  /** Textarea caret position when the `@` was typed (Plan 03 uses for cursor math). */
  cursorPos: number;
  /** Open the popup. Resets all state to a fresh IPC cycle. */
  open: (cursorPos: number) => void;
  /** Close the popup. Releases the candidates array (E-02). */
  close: () => void;
  /** Update the query string as the user types. */
  setQuery: (q: string) => void;
  /** Replace the candidates array + set truncated flag. Slices to ≤ 5001. */
  setCandidates: (paths: string[], truncated: boolean) => void;
  /** Toggle the loading flag explicitly (rarely needed — setCandidates clears it). */
  setLoading: (loading: boolean) => void;
}

export const useAtMentionStore = create<AtMentionState>((set) => ({
  isOpen: false,
  query: '',
  candidates: [],
  loading: false,
  truncated: false,
  cursorPos: 0,
  open: (cursorPos) =>
    set({
      isOpen: true,
      query: '',
      candidates: [],
      loading: true,
      truncated: false,
      cursorPos,
    }),
  close: () =>
    set({
      isOpen: false,
      query: '',
      candidates: [],
      loading: false,
      truncated: false,
      cursorPos: 0,
    }),
  setQuery: (q) => set({ query: q }),
  setCandidates: (paths, truncated) =>
    set({
      candidates: paths.slice(0, 5001),
      truncated,
      loading: false,
    }),
  setLoading: (loading) => set({ loading }),
}));
