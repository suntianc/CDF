import { create } from 'zustand';
import type { DirectoryEntry } from '../../shared/types';

interface PreviewFile {
  path: string;
  name: string;
  content: string;
}

interface FileState {
  filePanelOpen: boolean;
  filePanelMode: 'tree' | 'editor';
  filePanelWidth: number;
  rootPath: string | null;
  expandedDirs: Record<string, boolean>;
  dirContents: Record<string, DirectoryEntry[]>;
  dirErrors: Record<string, string>;
  filterQuery: string;
  loading: Record<string, boolean>;
  previewFile: PreviewFile | null;
  selectedPath: string | null;

  setFilePanelOpen: (open: boolean) => void;
  toggleFilePanel: () => void;
  setFilePanelMode: (mode: 'tree' | 'editor') => void;
  setFilePanelWidth: (width: number) => void;
  setRootPath: (path: string) => void;
  toggleDir: (path: string) => void;
  setDirContents: (path: string, entries: DirectoryEntry[]) => void;
  setDirError: (path: string, error: string) => void;
  clearDirError: (path: string) => void;
  setLoading: (path: string, loading: boolean) => void;
  setFilterQuery: (query: string) => void;
  openPreview: (file: PreviewFile) => void;
  closePreview: () => void;
  setSelectedPath: (path: string | null) => void;
}

const EDITOR_WIDTH = 600;

export const useFileStore = create<FileState>((set) => ({
  filePanelOpen: false,
  filePanelMode: 'tree',
  filePanelWidth: 280,
  rootPath: null,
  expandedDirs: {},
  dirContents: {},
  dirErrors: {},
  filterQuery: '',
  loading: {},
  previewFile: null,
  selectedPath: null,

  setFilePanelOpen: (open) => set({ filePanelOpen: open }),
  toggleFilePanel: () => set((s) => ({ filePanelOpen: !s.filePanelOpen })),
  setFilePanelMode: (mode) => set({ filePanelMode: mode }),
  setFilePanelWidth: (width) => set({ filePanelWidth: width }),
  setRootPath: (path) => set({ rootPath: path, expandedDirs: {}, dirContents: {}, dirErrors: {}, filterQuery: '', previewFile: null, filePanelMode: 'tree', filePanelWidth: 280, selectedPath: null }),

  toggleDir: (path) =>
    set((s) => ({
      expandedDirs: { ...s.expandedDirs, [path]: !s.expandedDirs[path] },
    })),

  setDirContents: (path, entries) =>
    set((s) => ({
      dirContents: { ...s.dirContents, [path]: entries },
      dirErrors: { ...s.dirErrors, [path]: undefined! },
    })),

  setDirError: (path, error) =>
    set((s) => ({
      dirErrors: { ...s.dirErrors, [path]: error },
    })),

  clearDirError: (path) =>
    set((s) => {
      const next = { ...s.dirErrors };
      delete next[path];
      return { dirErrors: next };
    }),

  setLoading: (path, loading) =>
    set((s) => ({
      loading: { ...s.loading, [path]: loading },
    })),

  setFilterQuery: (query) => set({ filterQuery: query }),

  openPreview: (file) =>
    set((s) => ({
      previewFile: file,
      filePanelMode: 'editor',
      filePanelWidth: s.filePanelMode === 'editor' ? s.filePanelWidth : EDITOR_WIDTH,
    })),

  closePreview: () =>
    set({ previewFile: null, filePanelMode: 'tree', filePanelWidth: 280 }),

  setSelectedPath: (path) => set({ selectedPath: path }),
}));
