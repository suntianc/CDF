export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  mtimeMs?: number;
}

export interface FileContent {
  content: string;
  encoding: string;
  size: number;
  mtimeMs: number;
}

export interface BinaryFileInfo {
  binary: true;
  size: number;
  mtimeMs: number;
}

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

export interface FileError {
  code: string;
  message: string;
}
