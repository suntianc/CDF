import { File, Shapes } from 'lucide-react'
import {
  TypeScriptIcon, JavaScriptIcon, ReactIcon, ReactTsIcon,
  JsonIcon, MarkdownIcon, CssIcon, SassIcon, HtmlIcon, XmlIcon,
  PythonIcon, RustIcon, GoIcon, JavaIcon, CIcon, CppIcon,
  ShellIcon, DatabaseIcon, GraphqlIcon, YamlIcon, TomlIcon,
  SvgIcon, ImageIcon, ZipIcon, GitIcon, SettingsIcon, LicenseIcon,
  DocumentIcon,
} from './file-icons'

type IconComponent = React.FC<{ className?: string }>

const ExcalidrawIcon: IconComponent = ({ className }) => (
  <Shapes className={`${className ?? ''} text-[var(--color-text-secondary)]`} />
)

const EXT_ICON: Record<string, IconComponent> = {
  ts:       TypeScriptIcon,
  tsx:      ReactTsIcon,
  js:       JavaScriptIcon,
  jsx:      ReactIcon,
  mjs:      JavaScriptIcon,
  cjs:      JavaScriptIcon,
  json:     JsonIcon,
  excalidraw: ExcalidrawIcon,
  md:       MarkdownIcon,
  mdx:      MarkdownIcon,
  css:      CssIcon,
  scss:     SassIcon,
  sass:     SassIcon,
  less:     CssIcon,
  html:     HtmlIcon,
  xml:      XmlIcon,
  svg:      SvgIcon,
  yaml:     YamlIcon,
  yml:      YamlIcon,
  toml:     TomlIcon,
  py:       PythonIcon,
  rs:       RustIcon,
  go:       GoIcon,
  java:     JavaIcon,
  c:        CIcon,
  cpp:      CppIcon,
  h:        CIcon,
  hpp:      CppIcon,
  sh:       ShellIcon,
  bash:     ShellIcon,
  zsh:      ShellIcon,
  sql:      DatabaseIcon,
  graphql:  GraphqlIcon,
  gql:      GraphqlIcon,
  env:      SettingsIcon,
  png:      ImageIcon,
  jpg:      ImageIcon,
  jpeg:     ImageIcon,
  gif:      ImageIcon,
  webp:     ImageIcon,
  ico:      ImageIcon,
  zip:      ZipIcon,
  tar:      ZipIcon,
  gz:       ZipIcon,
  '7z':     ZipIcon,
  rar:      ZipIcon,
}

const FILENAME_ICON: Record<string, IconComponent> = {
  '.gitignore':    GitIcon,
  '.gitattributes': GitIcon,
  '.gitmodules':   GitIcon,
  'license':       LicenseIcon,
  'licence':       LicenseIcon,
  'license.md':    LicenseIcon,
  'licence.md':    LicenseIcon,
  'license.txt':   LicenseIcon,
  'licence.txt':   LicenseIcon,
}

interface FileTypeIconProps {
  filename: string
  className?: string
}

export function FileTypeIcon({ filename, className = 'w-3.5 h-3.5' }: FileTypeIconProps) {
  const lower = filename.toLowerCase()
  const matched = FILENAME_ICON[lower]
  if (matched) {
    const Icon = matched
    return <Icon className={`${className} shrink-0`} />
  }

  const ext = lower.split('.').pop() || ''
  const Icon = EXT_ICON[ext]
  if (Icon) {
    return <Icon className={`${className} shrink-0`} />
  }

  return <File className={`${className} text-[var(--color-text-muted)] shrink-0`} />
}
