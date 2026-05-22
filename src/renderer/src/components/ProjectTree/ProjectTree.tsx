import { useEffect, useState } from 'react';
import { Folder, Plus, ChevronDown, MoreHorizontal, FolderPlus, FolderGit2 } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';

export function ProjectTree() {
  const { projects, currentProjectId, setProjects, setCurrentProject } = useProjectStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load projects from database
    window.electronAPI.db.getProjects().then((data) => {
      setProjects(data);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [setProjects]);

  const handleCreateProject = async () => {
    try {
      const path = await window.electronAPI.db.selectDirectory();
      if (path) {
        const name = path.split('/').pop() || '新项目';
        const project = await window.electronAPI.db.createProject(name, path);
        setProjects([...projects, project]);
      }
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="text-[var(--color-text-muted)] text-sm">加载中...</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-[var(--color-text-muted)] text-sm">暂无项目</p>
        <p className="text-[var(--color-text-muted)] text-xs mt-1">创建项目后显示在这里</p>
        <button
          onClick={handleCreateProject}
          className="mt-3 px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-md hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 inline mr-1" />
          创建项目
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1 mb-1 text-[var(--color-text-secondary)] font-medium">
        <div className="flex items-center gap-1 cursor-pointer hover:text-[var(--color-text-primary)]">
          <span className="text-xs">项目</span>
          <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
        </div>
        <div className="flex items-center gap-1">
          <button className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCreateProject}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
            title="新建项目"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {projects.map((project) => (
          <div
            key={project.id}
            className={`
              group flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-all
              hover:bg-[var(--color-bg-hover)]
              ${currentProjectId === project.id ? 'bg-[var(--color-bg-active)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}
            `}
            onClick={() => setCurrentProject(project.id)}
          >
            {project.isGit ? (
              <FolderGit2 className={`w-4 h-4 shrink-0 ${currentProjectId === project.id ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`} />
            ) : (
              <Folder className={`w-4 h-4 shrink-0 ${currentProjectId === project.id ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`} />
            )}
            <span className="text-[13px] truncate flex-1 leading-none">{project.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
