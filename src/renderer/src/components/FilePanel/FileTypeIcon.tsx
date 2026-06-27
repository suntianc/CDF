import {
  FileText, FileCode, FileJson, FileType, Image, Cog,
  FileSpreadsheet, File, FileArchive,
} from 'lucide-react';

const ICON_MAP: Record<string, { icon: typeof File; color: string }> = {
  ts:       { icon: FileCode,  color: 'text-blue-500' },
  tsx:      { icon: FileCode,  color: 'text-blue-500' },
  js:       { icon: FileCode,  color: 'text-yellow-500' },
  jsx:      { icon: FileCode,  color: 'text-yellow-500' },
  mjs:      { icon: FileCode,  color: 'text-yellow-500' },
  cjs:      { icon: FileCode,  color: 'text-yellow-500' },
  json:     { icon: FileJson,  color: 'text-amber-500' },
  md:       { icon: FileText,  color: 'text-purple-400' },
  mdx:      { icon: FileText,  color: 'text-purple-400' },
  css:      { icon: FileType,  color: 'text-sky-400' },
  scss:     { icon: FileType,  color: 'text-pink-400' },
  less:     { icon: FileType,  color: 'text-indigo-400' },
  html:     { icon: FileCode,  color: 'text-orange-500' },
  xml:      { icon: FileCode,  color: 'text-orange-400' },
  svg:      { icon: Image,     color: 'text-orange-400' },
  yaml:     { icon: Cog,       color: 'text-rose-400' },
  yml:      { icon: Cog,       color: 'text-rose-400' },
  toml:     { icon: Cog,       color: 'text-gray-500' },
  py:       { icon: FileCode,  color: 'text-green-500' },
  rs:       { icon: FileCode,  color: 'text-orange-600' },
  go:       { icon: FileCode,  color: 'text-cyan-500' },
  java:     { icon: FileCode,  color: 'text-red-500' },
  c:        { icon: FileCode,  color: 'text-blue-400' },
  cpp:      { icon: FileCode,  color: 'text-blue-600' },
  h:        { icon: FileCode,  color: 'text-blue-400' },
  sh:       { icon: FileCode,  color: 'text-green-600' },
  sql:      { icon: FileSpreadsheet, color: 'text-blue-400' },
  graphql:  { icon: FileCode,  color: 'text-pink-500' },
  env:      { icon: Cog,       color: 'text-yellow-600' },
  png:      { icon: Image,     color: 'text-green-400' },
  jpg:      { icon: Image,     color: 'text-green-400' },
  jpeg:     { icon: Image,     color: 'text-green-400' },
  gif:      { icon: Image,     color: 'text-green-400' },
  webp:     { icon: Image,     color: 'text-green-400' },
  ico:      { icon: Image,     color: 'text-green-400' },
  zip:      { icon: FileArchive, color: 'text-amber-600' },
  tar:      { icon: FileArchive, color: 'text-amber-600' },
  gz:       { icon: FileArchive, color: 'text-amber-600' },
};

interface FileTypeIconProps {
  filename: string;
  className?: string;
}

export function FileTypeIcon({ filename, className = 'w-3.5 h-3.5' }: FileTypeIconProps) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const entry = ICON_MAP[ext];
  const Icon = entry?.icon ?? File;
  const color = entry?.color ?? 'text-[var(--color-text-muted)]';

  return <Icon className={`${className} ${color} shrink-0`} />;
}
