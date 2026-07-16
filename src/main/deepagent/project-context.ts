import type Database from 'better-sqlite3';
import type { ProjectScene } from '../../shared/types';

export interface ProjectContext {
  id: string;
  name: string;
  path: string;
  scene: ProjectScene;
}

export function buildProjectContext(project: Pick<ProjectContext, 'name' | 'path'>): string {
  return `\n\n[项目上下文]\n当前选中项目名称: ${project.name}\n项目根目录: ${project.path}\n所有文件工具（ls、read_file、write_file、edit_file、glob、grep、delete_file）请使用绝对路径，例如 \`${project.path}/src/main.ts\`。\nbash 工具也使用绝对路径，当前工作目录为项目根目录。\n\n## Skills 创建规范\n- 创建项目级 Skill 时，请写入 \`${project.path}/.cdf/skills/{skill名称}/SKILL.md\`（项目级 skills 对该项目所有 Agent 自动可见）\n- SKILL.md 格式：以 \`---\` 开头的前置元数据，包含 \`name\` 和 \`description\` 字段，随后是 Markdown 正文\n- 全局 Skill 写入 \`~/.cdf/skills/{skill名称}/SKILL.md\`（对所有项目默认可见）\n- Agent 选择 Skill 只表示预加载或强调，不表示访问授权\n当你需要查看、确认、搜索或继续分析项目时，必须在当前轮次继续调用合适的文件工具；不要只回复"我先看看/我再确认/继续搜索"就结束。`;
}

/** Resolves the Project-owned context supplied to root and delegated execution. */
export function resolveProjectContext(
  db: Database.Database,
  projectId: string,
): ProjectContext {
  const project = db.prepare(
    'SELECT id, name, path, scene FROM projects WHERE id = ?',
  ).get(projectId) as ProjectContext | undefined;
  if (!project) throw new Error(`Project with ID ${projectId} not found.`);
  return project;
}
