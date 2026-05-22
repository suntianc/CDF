import { useEffect, useState, useCallback } from 'react';
import { 
  Folder, Plus, ChevronDown, ChevronRight, FolderPlus, FolderGit2,
  MessageSquare, GitFork, Trash2 
} from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { useSessionStore } from '@/stores/sessionStore';

interface Project {
  id: string;
  name: string;
  path: string;
  isGit?: boolean;
}

interface ProjectFolderProps {
  project: Project;
  isActive: boolean;
}

function ProjectFolder({ project, isActive }: ProjectFolderProps) {
  const [expanded, setExpanded] = useState(true);
  const [sessions, setSessions] = useState<any[]>([]);
  const { currentProjectId, setCurrentProject } = useProjectStore();
  const { 
    activeSessionId, selectSession, deleteSession, createSession, sessions: activeSessions 
  } = useSessionStore();

  const loadSessions = useCallback(async () => {
    try {
      const data = await window.electronAPI.db.getSessions(project.id);
      setSessions(data);
    } catch (err) {
      console.error(`Failed to fetch sessions for project ${project.id}:`, err);
    }
  }, [project.id]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions, activeSessions, activeSessionId]);

  const handleProjectClick = () => {
    setCurrentProject(project.id);
    setExpanded(!expanded);
  };

  const handleNewChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentProject(project.id);
    selectSession(null);
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await deleteSession(sessionId);
      await loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  return (
    <div className="flex flex-col min-w-0">
      {/* Project Folder Item */}
      <div
        className={`
          group flex items-center justify-between px-3 py-1.5 rounded-md cursor-pointer transition-all border border-transparent min-w-0
          hover:bg-[var(--color-bg-surface)] hover:shadow-md
          ${isActive ? 'text-[var(--color-text-primary)] font-semibold' : 'text-[var(--color-text-secondary)]'}
        `}
        onClick={handleProjectClick}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Chevron expand/collapse toggle */}
          <button
            type="button"
            className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[var(--color-text-muted)] cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
          
          {project.isGit ? (
            <FolderGit2 className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]'}`} />
          ) : (
            <Folder className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]'}`} />
          )}
          <span className="text-xs truncate flex-1 leading-none">{project.name}</span>
        </div>

        {/* Hover action buttons */}
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-0.5">
          <button
            type="button"
            onClick={handleNewChat}
            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all cursor-pointer"
            title="新建对话"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Sessions child list with transition */}
      <div className={`folder-sessions-collapse ${expanded ? 'expanded' : ''}`}>
        <div className="folder-sessions-inner pl-6 flex flex-col gap-0.5 border-l border-[var(--color-border)]/50 ml-5 min-w-0">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`
                group/session flex items-center justify-between px-3 py-1.5 rounded-md cursor-pointer transition-all border min-w-0
                ${
                  activeSessionId === session.id
                    ? 'bg-[var(--color-bg-active)] border-[var(--color-border)] text-[var(--color-text-primary)] font-medium shadow-sm'
                    : 'bg-transparent border-transparent hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }
              `}
              onClick={() => {
                // Ensure project is also set as current project
                setCurrentProject(project.id);
                selectSession(session.id);
              }}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {session.parent_session_id ? (
                  <GitFork className="w-3.5 h-3.5 text-[var(--color-text-secondary)] shrink-0" />
                ) : (
                  <MessageSquare className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
                )}
                <span className="text-xs truncate flex-1 leading-none">{session.name}</span>
              </div>
              
              <button
                type="button"
                onClick={(e) => handleDeleteSession(e, session.id)}
                className="opacity-0 group-hover/session:opacity-100 p-1 rounded hover:bg-[var(--color-danger-dim)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-all shrink-0 ml-1.5 cursor-pointer"
                title="删除会话"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}

          {sessions.length === 0 && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--color-text-muted)] select-none italic">
              无对话
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectTree() {
  const { projects, currentProjectId, setProjects, setCurrentProject } = useProjectStore();
  const [loading, setLoading] = useState(true);
  const [listExpanded, setListExpanded] = useState(true);

  useEffect(() => {
    // Load projects from database
    window.electronAPI.db.getProjects().then((data) => {
      setProjects(data);
      setLoading(false);

      // If currentProjectId is not set, set it to the default project or first project
      if (!currentProjectId && data.length > 0) {
        const hasDefault = data.some(p => p.id === 'default-project');
        if (hasDefault) {
          setCurrentProject('default-project');
        } else {
          setCurrentProject(data[0].id);
        }
      }
    }).catch((err) => {
      console.error('Failed to load projects:', err);
      setLoading(false);
    });
  }, [setProjects, currentProjectId, setCurrentProject]);

  const handleCreateProject = async () => {
    try {
      const path = await window.electronAPI.db.selectDirectory();
      if (path) {
        const name = path.split('/').pop() || '新项目';
        const project = await window.electronAPI.db.createProject(name, path);
        setProjects([...projects, project]);
        // Auto select newly created project
        setCurrentProject(project.id);
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
      <div className="flex items-center justify-between px-3 py-1 mb-1 text-[var(--color-text-secondary)] font-medium select-none">
        <div 
          onClick={() => setListExpanded(!listExpanded)}
          className="flex items-center gap-1 cursor-pointer hover:text-[var(--color-text-primary)] flex-1"
        >
          <span className="text-xs">项目列表</span>
          {listExpanded ? (
            <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
          ) : (
            <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={handleCreateProject}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
            title="新建项目"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      
      {/* Project list collapsible content with CSS transition */}
      <div className={`folder-sessions-collapse ${listExpanded ? 'expanded' : ''}`}>
        <div className="folder-sessions-inner space-y-2 min-w-0">
          {projects.map((project) => (
            <ProjectFolder
              key={project.id}
              project={project}
              isActive={currentProjectId === project.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
