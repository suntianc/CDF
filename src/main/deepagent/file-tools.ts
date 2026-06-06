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
      description: 'Absolute path to the file to delete, for example /Users/xxx/project/src/example.ts',
    },
  },
  required: ['file_path'],
  additionalProperties: false,
} as const;

function isProtectedPath(filePath: string): boolean {
  if (filePath.endsWith('/.env') || filePath.endsWith('/.env.local')) return true;
  return ['/.git/', '/node_modules/', '/out/', '/dist/'].some((prefix) =>
    filePath.includes(prefix)
  );
}

function resolveProjectFile(projectPath: string, filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    throw new Error(`file_path must be an absolute path: ${filePath}`);
  }

  const segments = filePath.split(path.sep).filter(Boolean);
  if (segments.includes('..') || filePath.includes('~')) {
    throw new Error(`Path traversal is not allowed: ${filePath}`);
  }

  const relative = path.relative(projectPath, filePath);
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return filePath;
  }

  const virtualPath = path.join(projectPath, filePath.replace(/^[/\\]+/, ''));
  const virtualRelative = path.relative(projectPath, virtualPath);
  if (virtualRelative === '' || virtualRelative.startsWith('..') || path.isAbsolute(virtualRelative)) {
    throw new Error(`Path is outside project: ${filePath}`);
  }
  return virtualPath;
}

export function createDeleteFileTool(projectPath: string) {
  return tool(
    async (input: DeleteFileInput) => {
      const filePath = input.file_path.trim();
      if (!filePath) {
        throw new Error('file_path must be a non-empty string');
      }

      if (isProtectedPath(filePath)) {
        throw new Error(`Deleting protected path is not allowed: ${filePath}`);
      }

      const target = resolveProjectFile(projectPath, filePath);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new Error(`Deleting symlinks is not allowed: ${filePath}`);
      }
      if (!stat.isFile()) {
        throw new Error(`delete_file only supports files: ${filePath}`);
      }

      fs.unlinkSync(target);
      return `Deleted ${filePath}`;
    },
    {
      name: 'delete_file',
      description: 'Delete a file inside the current project. Use absolute paths. Cannot delete directories, symlinks, or protected paths (.env, .git, node_modules, out, dist).',
      schema: DELETE_FILE_SCHEMA,
    }
  );
}
