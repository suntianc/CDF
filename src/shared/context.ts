export interface MCPToolDetail {
  tool: string;
  server: string;
  tokens: number;
}

export interface SkillDetail {
  name: string;
  scope: 'global' | 'project';
  tokens: number;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  tokens: number;
}

export interface SystemToolDetail {
  name: string;
  tokens: number;
}

export interface ProjectCommandDetail {
  name: string;
  tokens: number;
}

export interface ContextBreakdown {
  conversation: number;
  skills: number;
  mcp: number;
  workflows: number;
  systemPrompt: number;
  systemTools: number;
  customAgents: number;
  memoryFiles: number;
  messages: number;
  projectCommandBodies: number;
  freeSpace: number;
  autocompactBuffer: number;
  mcpPerTool: MCPToolDetail[];
  skillsPerSkill: SkillDetail[];
  workflowsPerWorkflow: WorkflowDetail[];
  systemToolsPerTool: SystemToolDetail[];
  projectCommandsPerFile: ProjectCommandDetail[];
}

export interface ContextAggregate {
  breakdown: ContextBreakdown;
  total: number;
  modelName: string;
  contextLimit: number;
  used: number;
  usedPct: number;
  freePct: number;
  mcpPerTool: MCPToolDetail[];
}
