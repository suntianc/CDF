import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Folder, Plus, ChevronDown, ChevronRight, FolderPlus, FolderGit2,
  MessageSquare, GitFork, Trash2, MoreHorizontal, FlaskConical
} from 'lucide-react';
import type { Project } from '@shared/types';
import { useProjectStore } from '@/stores/projectStore';
import { useSessionStore } from '@/stores/sessionStore';
import { CreateProjectDialog } from './CreateProjectDialog';
import { normalizeProjectScene } from '@/scenes/sceneRouting';

interface ProjectFolderProps {
  project: Project;
}

function ProjectFolder({ project }: ProjectFolderProps) {
  const { t } = useTranslation();
  const projectScene = normalizeProjectScene(project.scene);
  const isSceneProject = projectScene !== 'general';
  const ProjectIcon = projectScene === 'research' ? FlaskConical : project.isGit ? FolderGit2 : Folder;
  const projectSceneTitle = isSceneProject ? t(`projectTree.scene.${projectScene}`, projectScene) : undefined;
  const projectIconClassName = `w-4 h-4 shrink-0 transition-colors ${
    projectScene === 'research'
      ? 'text-[color-mix(in_srgb,var(--color-info)_72%,white)] group-hover:text-[color-mix(in_srgb,var(--color-info)_86%,white)]'
      : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]'
  }`;
  const [expanded, setExpanded] = useState(true);
  const [sessions, setSessions] = useState<any[]>([]);
  const { currentProjectId, setCurrentProject, setProjects } = useProjectStore();
  const { 
    activeSessionId, selectSession, deleteSession, sessions: activeSessions 
  } = useSessionStore();

  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);

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

  // Keep local editName state in sync when project name changes externally
  useEffect(() => {
    setEditName(project.name);
  }, [project.name]);

  const handleRenameProject = async (name: string) => {
    if (!name.trim()) return;
    try {
      await window.electronAPI.db.renameProject(project.id, name.trim());
      const data = await window.electronAPI.db.getProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to rename project:', err);
    }
  };

  const handleDeleteProject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (project.id === 'default-project') {
      return; // Safeguard
    }
    try {
      await window.electronAPI.db.deleteProject(project.id);
      const data = await window.electronAPI.db.getProjects();
      setProjects(data);
      if (currentProjectId === project.id) {
        setCurrentProject('');
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const handleProjectClick = () => {
    if (isEditing) return;
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
          group flex min-h-8 items-center justify-between px-3 py-1.5 rounded-[var(--radius-sm)] cursor-pointer transition-[background-color,color] border border-transparent min-w-0
          text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]
        `}
        onClick={handleProjectClick}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Chevron expand/collapse toggle */}
          <button
            type="button"
            className="p-0.5 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] cursor-pointer"
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
          
          <span title={projectSceneTitle} className="shrink-0">
            <ProjectIcon className={projectIconClassName} aria-hidden="true" />
          </span>
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => {
                setIsEditing(false);
                handleRenameProject(editName);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setIsEditing(false);
                  handleRenameProject(editName);
                } else if (e.key === 'Escape') {
                  setIsEditing(false);
                  setEditName(project.name);
                }
              }}
              className="text-xs flex-1 bg-[var(--color-bg-input)] border border-[var(--color-border)] rounded px-1 py-0.5 outline-none font-normal"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-xs truncate flex-1 leading-none">{project.name}</span>
          )}
        </div>

        {/* Hover action buttons */}
        <div className="flex items-center gap-0.5 relative opacity-60 hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            title={t('projectTree.projectActions')}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
            title={t('projectTree.newChat')}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <>
              {/* Overlay for closing popover */}
              <div
                className="fixed inset-0 z-40 cursor-default"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                }}
              />
              {/* Popover content */}
              <div 
                className="absolute right-0 top-full mt-1 bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md shadow-lg py-1 z-50 min-w-[100px] text-xs font-normal"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setIsEditing(true);
                    setEditName(project.name);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] cursor-pointer"
                >
                  {t('projectTree.renameProject')}
                </button>
                {project.id !== 'default-project' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      setMenuOpen(false);
                      handleDeleteProject(e);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-danger-dim)] text-[var(--color-danger)] cursor-pointer border-t border-[var(--color-border)]/50"
                  >
                    {t('projectTree.removeProject')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sessions child list with transition */}
      <div className={`folder-sessions-collapse ${expanded ? 'expanded' : ''}`}>
        <div className="folder-sessions-inner pl-6 flex flex-col gap-0.5 border-l border-[var(--color-border)]/50 ml-5 min-w-0">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`
                group/session flex min-h-[30px] items-center justify-between px-3 py-1.5 rounded-[var(--radius-sm)] cursor-pointer transition-colors border min-w-0
                ${
                  activeSessionId === session.id
                    ? 'bg-[var(--color-bg-active)] border-transparent text-[var(--color-text-primary)] font-medium'
                    : 'bg-transparent border-transparent hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }
              `}
              onClick={() => {
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
                className="opacity-40 group-hover/session:opacity-100 focus-visible:opacity-100 p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-danger-dim)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-[opacity,background-color,color] shrink-0 ml-1.5 cursor-pointer"
                title={t('projectTree.deleteSession')}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}

          {sessions.length === 0 && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--color-text-muted)] select-none italic">
              {t('projectTree.noProjectSessions')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ProjectTree() {
  const { t } = useTranslation();
  const { projects, currentProjectId, setProjects, setCurrentProject } = useProjectStore();
  const { activeSessionId, selectSession, deleteSession, sessions: activeSessions } = useSessionStore();
  
  const [loading, setLoading] = useState(true);
  const [listExpanded, setListExpanded] = useState(true);
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [defaultSessions, setDefaultSessions] = useState<any[]>([]);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  const loadDefaultSessions = useCallback(async () => {
    try {
      const data = await window.electronAPI.db.getSessions('default-project');
      setDefaultSessions(data);
    } catch (err) {
      console.error('Failed to load default sessions:', err);
    }
  }, []);

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

  useEffect(() => {
    loadDefaultSessions();
  }, [loadDefaultSessions, activeSessions, activeSessionId]);

  const handleProjectCreated = (project: Project) => {
    setProjects([...projects, project]);
    setCurrentProject(project.id);
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await deleteSession(sessionId);
      await loadDefaultSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleNewChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentProject('default-project');
    selectSession(null);
  };

  if (loading) {
    return (
      <div className="p-4 text-center">
        <p className="text-[var(--color-text-muted)] text-sm">加载中...</p>
      </div>
    );
  }

  const customProjects = projects.filter(p => p.id !== 'default-project');

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Category 1: Projects */}
      <div>
        <div className="flex items-center justify-between px-3 py-1 mb-0 text-[var(--color-text-secondary)] font-medium select-none">
          <div 
            onClick={() => setListExpanded(!listExpanded)}
            className="flex items-center gap-1 cursor-pointer hover:text-[var(--color-text-primary)] flex-1"
          >
            <span className="text-xs">{t('projectTree.projectList')}</span>
            {listExpanded ? (
              <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
            )}
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setCreateProjectOpen(true)}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
              title={t('projectTree.newProjectBtn')}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        
        {/* Project list collapsible content */}
        <div className={`folder-sessions-collapse ${listExpanded ? 'expanded' : ''}`}>
          <div className="folder-sessions-inner space-y-0.5 min-w-0">
            {customProjects.map((project) => (
              <ProjectFolder
                key={project.id}
                project={project}
              />
            ))}

            {customProjects.length === 0 && (
              <div className="p-4 text-center">
                <p className="text-[var(--color-text-muted)] text-[11px] italic">{t('projectTree.noCustomProjects')}</p>
                <button
                  onClick={() => setCreateProjectOpen(true)}
                  className="mt-2 px-2 py-1 text-xs border border-[var(--color-border)] rounded hover:bg-[var(--color-bg-hover)] transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3 inline mr-1" />
                  {t('projectTree.newProjectBtn')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category 2: Conversations (Dialogs) */}
      <div>
        <div className="flex items-center justify-between px-3 py-1 mb-0 text-[var(--color-text-secondary)] font-medium select-none">
          <div 
            onClick={() => setSessionsExpanded(!sessionsExpanded)}
            className="flex items-center gap-1 cursor-pointer hover:text-[var(--color-text-primary)] flex-1"
          >
            <span className="text-xs">{t('projectTree.tempSessions')}</span>
            {sessionsExpanded ? (
              <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)]" />
            ) : (
              <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)]" />
            )}
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={handleNewChat}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
              title={t('projectTree.newTempSession')}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Sessions list collapsible content */}
        <div className={`folder-sessions-collapse ${sessionsExpanded ? 'expanded' : ''}`}>
          <div className="folder-sessions-inner space-y-0.5 min-w-0">
            {defaultSessions.map((session) => (
              <div
                key={session.id}
                className={`
                  group/session flex items-center justify-between px-3 py-1.5 rounded-md cursor-pointer transition-[background-color,border-color,color] duration-150 border min-w-0 focus-within:ring-2 focus-within:ring-[var(--color-accent)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--color-bg-sidebar)]
                  ${
                    activeSessionId === session.id
                      ? 'bg-[var(--color-bg-active)] border-transparent text-[var(--color-text-primary)] font-medium'
                      : 'bg-transparent border-transparent hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                  }
                `}
                onClick={() => {
                  setCurrentProject('default-project');
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
                  className="opacity-60 group-hover/session:opacity-100 focus-visible:opacity-100 p-1 rounded hover:bg-[var(--color-danger-dim)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] transition-[background-color,color,opacity] duration-150 shrink-0 ml-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                  title={t('projectTree.deleteSession')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}

            {defaultSessions.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-[var(--color-text-muted)] select-none italic text-center border border-dashed border-[var(--color-border)]/50 rounded-lg">
                {t('projectTree.noHistorySessions')}
              </div>
            )}
          </div>
        </div>
      </div>
      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onProjectCreated={handleProjectCreated}
      />
    </div>
  );
}
