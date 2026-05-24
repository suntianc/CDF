import fs from 'fs';
import path from 'path';
import { tool } from '@langchain/core/tools';

interface DeleteFileInput {
  file_path: string;
}

const DELETE_FILE_SCHEMA = {
  type: 'object',
  properties: {
    file_path: {
      type: 'string',
      description: 'Virtual absolute path to the project file to delete, for example /src/example.ts',
    },
  },
  required: ['file_path'],
  additionalProperties: false,
} as const;

function normalizeVirtualPath(filePath: string): string {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('file_path must be a non-empty string');
  }

  const virtualPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
  const segments = virtualPath.split('/').filter(Boolean);
  if (segments.includes('..') || segments.some((segment) => segment.includes('~'))) {
    throw new Error(`Path traversal is not allowed: ${filePath}`);
  }

  return `/${segments.join('/')}`;
}

function isProtectedPath(virtualPath: string): boolean {
  if (virtualPath.startsWith('/.env')) return true;
  return ['/.git', '/node_modules', '/out', '/dist'].some((prefix) =>
    virtualPath === prefix || virtualPath.startsWith(`${prefix}/`)
  );
}

function resolveProjectFile(projectPath: string, virtualPath: string): string {
  const target = path.resolve(projectPath, virtualPath.slice(1));
  const relative = path.relative(projectPath, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path is outside project: ${virtualPath}`);
  }
  return target;
}

export function createDeleteFileTool(projectPath: string) {
  return tool(
    async (input: DeleteFileInput) => {
      const virtualPath = normalizeVirtualPath(input.file_path);
      if (isProtectedPath(virtualPath)) {
        throw new Error(`Deleting protected path is not allowed: ${virtualPath}`);
      }

      const target = resolveProjectFile(projectPath, virtualPath);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new Error(`Deleting symlinks is not allowed: ${virtualPath}`);
      }
      if (!stat.isFile()) {
        throw new Error(`delete_file only supports files: ${virtualPath}`);
      }

      fs.unlinkSync(target);
      return `Deleted ${virtualPath}`;
    },
    {
      name: 'delete_file',
      description: 'Delete a file inside the current project. This tool cannot delete directories, symlinks, or protected paths.',
      schema: DELETE_FILE_SCHEMA,
    }
  );
}
