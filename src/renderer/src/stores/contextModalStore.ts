import { create } from 'zustand';

/**
 * 08.2 P4 C2-02 + C2-04: minimal open/close store for the /context modal.
 *
 * Pattern matches `themeStore.ts` / `planPopupStore.ts` (Zustand singleton,
 * no provider). The data fetch is owned by the `<ContextModal>` component
 * (useEffect on isOpen) so the store stays tiny and stale-data free.
 */
interface ContextModalState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useContextModalStore = create<ContextModalState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
