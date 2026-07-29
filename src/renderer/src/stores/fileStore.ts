import { create } from 'zustand';
import type { DirectoryEntry } from '@shared/types';
import type { FlowDiagramDocumentVersion } from '@shared/flow-diagrams';

export interface PreviewFile {
  path: string;
  name: string;
  content: string;
  documentVersion?: FlowDiagramDocumentVersion;
  loadError?: 'unreadable';
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
  openTabs: PreviewFile[];
  activeTabIndex: number;
  previewFile: PreviewFile | null;
  selectedPath: string | null;
  fileTreeCollapsed: boolean;
  dirtyTabs: Record<string, boolean>;
  setTabDirty: (path: string, dirty: boolean) => void;
  setTabContent: (
    path: string,
    content: string,
    documentVersion?: FlowDiagramDocumentVersion,
  ) => void;

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
  closeTab: (index: number) => void;
  setActiveTab: (index: number) => void;
  setSelectedPath: (path: string | null) => void;
  toggleFileTreeCollapsed: () => void;
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
  openTabs: [],
  activeTabIndex: -1,
  previewFile: null,
  selectedPath: null,
  fileTreeCollapsed: false,
  dirtyTabs: {},

  setFilePanelOpen: (open) => set({ filePanelOpen: open }),
  toggleFilePanel: () => set((s) => ({ filePanelOpen: !s.filePanelOpen })),
  setFilePanelMode: (mode) => set({ filePanelMode: mode }),
  setFilePanelWidth: (width) => set({ filePanelWidth: width }),
  setRootPath: (path) => set({ rootPath: path, expandedDirs: {}, dirContents: {}, dirErrors: {}, filterQuery: '', openTabs: [], activeTabIndex: -1, previewFile: null, filePanelMode: 'tree', filePanelWidth: 280, selectedPath: null, fileTreeCollapsed: false, dirtyTabs: {} }),
  setTabDirty: (path, dirty) => set((s) => ({ dirtyTabs: { ...s.dirtyTabs, [path]: dirty } })),
  setTabContent: (path, content, documentVersion) => set((s) => {
    const openTabs = s.openTabs.map((tab) => (
      tab.path === path
        ? { ...tab, content, documentVersion, loadError: undefined }
        : tab
    ));
    const previewFile = s.previewFile?.path === path
      ? { ...s.previewFile, content, documentVersion, loadError: undefined }
      : s.previewFile;
    return { openTabs, previewFile };
  }),

  toggleDir: (path) =>
    set((s) => ({
      expandedDirs: { ...s.expandedDirs, [path]: !s.expandedDirs[path] },
    })),

  setDirContents: (path, entries) =>
    set((s) => {
      // Loading a directory clears any prior error for it. Delete the key (matching
      // clearDirError) instead of stuffing `undefined!` into a Record<string,string>.
      const dirErrors = { ...s.dirErrors };
      delete dirErrors[path];
      return { dirContents: { ...s.dirContents, [path]: entries }, dirErrors };
    }),

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
    set((s) => {
      const existingIndex = s.openTabs.findIndex((t) => t.path === file.path);
      if (existingIndex >= 0) {
        const tabs = [...s.openTabs];
        tabs[existingIndex] = file;
        return {
          openTabs: tabs,
          activeTabIndex: existingIndex,
          previewFile: file,
          filePanelMode: 'editor',
          filePanelWidth: s.filePanelMode === 'editor' ? s.filePanelWidth : EDITOR_WIDTH,
        };
      }
      const tabs = [...s.openTabs, file];
      return {
        openTabs: tabs,
        activeTabIndex: tabs.length - 1,
        previewFile: file,
        filePanelMode: 'editor',
        filePanelWidth: s.filePanelMode === 'editor' ? s.filePanelWidth : EDITOR_WIDTH,
      };
    }),

  closeTab: (index) =>
    set((s) => {
      const tab = s.openTabs[index];
      const nextDirty = { ...s.dirtyTabs };
      if (tab) delete nextDirty[tab.path];
      const tabs = s.openTabs.filter((_, i) => i !== index);
      if (tabs.length === 0) {
        return { openTabs: [], activeTabIndex: -1, previewFile: null, filePanelMode: 'tree', filePanelWidth: 280, dirtyTabs: nextDirty };
      }
      const newIndex = index >= tabs.length ? tabs.length - 1 : index;
      return {
        openTabs: tabs,
        activeTabIndex: newIndex,
        previewFile: tabs[newIndex],
        dirtyTabs: nextDirty,
      };
    }),

  setActiveTab: (index) =>
    set((s) => {
      if (index < 0 || index >= s.openTabs.length) return s;
      return {
        activeTabIndex: index,
        previewFile: s.openTabs[index],
      };
    }),

  closePreview: () =>
    set({ openTabs: [], activeTabIndex: -1, previewFile: null, filePanelMode: 'tree', filePanelWidth: 280, dirtyTabs: {} }),

  setSelectedPath: (path) => set({ selectedPath: path }),

  toggleFileTreeCollapsed: () => set((s) => ({ fileTreeCollapsed: !s.fileTreeCollapsed })),
}));
