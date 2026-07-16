import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as facade from './types';
import { DELEGATED_TASK_RESULT_SCHEMA } from './agent-runtime';
import { MAX_AT_MENTION_CANDIDATES } from './at-mention';
import { CommandConflictError } from './commands';
import { PAPER_SEARCH_CONFIG_KEYS } from './knowledge';

const sharedDirectory = path.resolve(process.cwd(), 'src/shared');
const domainModules = [
  'agent-runtime',
  'agents',
  'at-mention',
  'commands',
  'context',
  'conversations',
  'filesystem',
  'knowledge',
  'projects',
  'providers',
  'skills',
  'workflows',
] as const;
const legacyFacadeExports = [
  'Agent',
  'AgentApprovalAction',
  'AgentApprovalDecisionType',
  'AgentApprovalHistoryEntry',
  'AgentApprovalRequest',
  'AgentApprovalResolution',
  'AgentApprovalStatus',
  'AgentRun',
  'AgentRunStatus',
  'AgentCapabilityInput',
  'AgentRole',
  'AgentToolScopeConfig',
  'AgentToolCall',
  'AgentToolCallStatus',
  'ApprovalMode',
  'AtMentionCandidateList',
  'BinaryFileInfo',
  'ChatPayload',
  'CreateCustomAgentInput',
  'ChatRuntimeOverrides',
  'CommandConflictError',
  'CommandDispatchAction',
  'CommandSource',
  'ContextAggregate',
  'ContextBreakdown',
  'ConversationModelSourceType',
  'ConversationRunIdentity',
  'ConversationRunOrigin',
  'ConversationRunStreamEnvelope',
  'ConversationRunStreamSnapshot',
  'DELEGATED_TASK_RESULT_SCHEMA',
  'DelegatedAgentRun',
  'DelegatedAgentRunLaunchForm',
  'DelegatedAgentRunStatus',
  'DelegatedTaskResult',
  'DelegatedToolActionRecord',
  'DelegatedToolApprovalDecision',
  'DelegatedToolApprovalRequest',
  'DelegatedToolApprovalStatus',
  'DelegatedToolExecutionStatus',
  'DirectoryEntry',
  'ExecutionStep',
  'ExecutionStepType',
  'FileContent',
  'FileError',
  'FileInfo',
  'JournalMetricsSnapshot',
  'JudgePayload',
  'KnowledgeEntryCreateInput',
  'KnowledgeEntrySearchOptions',
  'KnowledgeEntrySummary',
  'KnowledgeEntryUpdateInput',
  'LLMProvider',
  'LLMProviderSaveInput',
  'LLMProviderSaveResult',
  'LLMStreamEvent',
  'MAX_AT_MENTION_CANDIDATES',
  'MCPServer',
  'MCPServerSaveInput',
  'MCPServerSaveResult',
  'MCPToolDetail',
  'MasterScenePrompt',
  'Message',
  'MessageSaveInput',
  'PAPER_SEARCH_CONFIG_KEYS',
  'PaperSearchConfigEntry',
  'PaperSearchConfigKey',
  'PaperSearchConfigSettings',
  'PaperSearchConfigSource',
  'ParallelTaskStepEvent',
  'ParsedFrontmatter',
  'Project',
  'ProjectCommandDetail',
  'ProjectScene',
  'SaveMasterScenePromptsInput',
  'SearchProvider',
  'SearchProviderSaveInput',
  'SearchProviderSaveResult',
  'SearchProviderType',
  'SearchResult',
  'Session',
  'Skill',
  'SkillAttribution',
  'SkillAttributionPhase',
  'SkillCommandSourceKind',
  'SkillDetail',
  'SkillSaveInput',
  'SkillShadowedEntry',
  'SlashCommand',
  'StageGateResolution',
  'SystemToolDetail',
  'TodoItem',
  'UpdateCustomAgentInput',
  'UpdateGeneralPurposeAgentInput',
  'Workflow',
  'WorkflowDetail',
  'WorkflowRun',
  'WorkflowRunProjectionEvent',
  'WorkflowRunStatus',
  'WorkflowRunTask',
  'WorkflowSaveInput',
  'WorkflowStage',
  'WorkflowStageGate',
  'WorkflowStageReport',
  'WorkflowStageRoute',
  'WorkflowTaskStatus',
] as const;

function parseSharedFile(fileName: string): ts.SourceFile {
  const filePath = path.join(sharedDirectory, fileName);
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements.flatMap((statement) => {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)) {
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

function exportedDefinitionNames(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements.flatMap((statement) => {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    const isExported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) return [];

    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : []
      );
    }

    if ((ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement))
      && statement.name) {
      return [statement.name.text];
    }

    return [];
  });
}

function facadeExportNames(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause
      || !ts.isNamedExports(statement.exportClause)) {
      return [];
    }
    return statement.exportClause.elements.map((element) => element.name.text);
  });
}

describe('shared type module architecture', () => {
  it('keeps types.ts as an explicit compatibility facade', () => {
    const sourceFile = parseSharedFile('types.ts');

    expect(sourceFile.statements.every(ts.isExportDeclaration)).toBe(true);
    expect(sourceFile.statements.every((statement) =>
      ts.isExportDeclaration(statement)
      && statement.exportClause !== undefined
      && ts.isNamedExports(statement.exportClause)
    )).toBe(true);
    expect(new Set(moduleSpecifiers(sourceFile))).toEqual(
      new Set(domainModules.map((moduleName) => `./${moduleName}`)),
    );
  });

  it('preserves every legacy export with one authoritative definition', () => {
    const definitions = domainModules.flatMap((moduleName) =>
      exportedDefinitionNames(parseSharedFile(`${moduleName}.ts`))
    );
    const facadeExports = facadeExportNames(parseSharedFile('types.ts'));

    expect(new Set(definitions).size).toBe(definitions.length);
    expect(facadeExports.sort()).toEqual([...legacyFacadeExports].sort());
    expect(definitions).toEqual(expect.arrayContaining([...legacyFacadeExports]));
  });

  it('keeps domain modules independent from the facade and IPC contract', () => {
    for (const moduleName of domainModules) {
      const specifiers = moduleSpecifiers(parseSharedFile(`${moduleName}.ts`));
      expect(specifiers, moduleName).not.toContain('./types');
      expect(specifiers, moduleName).not.toContain('./ipc-contract');
    }

    expect(moduleSpecifiers(parseSharedFile('ipc-contract.ts'))).not.toContain('./types');
  });

  it('preserves runtime export identity through the compatibility facade', () => {
    expect(facade.DELEGATED_TASK_RESULT_SCHEMA).toBe(DELEGATED_TASK_RESULT_SCHEMA);
    expect(facade.CommandConflictError).toBe(CommandConflictError);
    expect(facade.MAX_AT_MENTION_CANDIDATES).toBe(MAX_AT_MENTION_CANDIDATES);
    expect(facade.PAPER_SEARCH_CONFIG_KEYS).toBe(PAPER_SEARCH_CONFIG_KEYS);
  });
});
