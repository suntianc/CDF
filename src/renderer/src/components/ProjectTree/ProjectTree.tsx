import { useEffect, useState } from 'react';
import { Folder, Plus } from 'lucide-react';
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
          className="mt-3 px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Plus className="w-4 h-4 inline mr-1" />
          创建项目
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--color-text-muted)]">项目</span>
        <button
          onClick={handleCreateProject}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[var(--color-bg-hover)] transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
      <div className="space-y-1">
        {projects.map((project) => (
          <div
            key={project.id}
            className={`
              flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer
              hover:bg-[var(--color-bg-hover)]
              ${currentProjectId === project.id ? 'bg-[var(--color-accent-dim)]' : ''}
            `}
            onClick={() => setCurrentProject(project.id)}
          >
            <Folder className="w-4 h-4 text-[var(--color-accent)]" />
            <span className="text-sm truncate flex-1">{project.name}</span>
            {currentProjectId === project.id && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
              >
                当前项目
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
