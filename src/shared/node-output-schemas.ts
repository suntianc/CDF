/**
 * Node Output Schemas — 工作流节点输出 JSON Schema 强校验
 *
 * 为四种节点类型（task/review/loop/foreach）定义内置固定 Zod schema，
 * 供 main 层 output-validator 和 renderer 层使用。
 *
 * 决策 D-A-1: 内置固定 schema，而非 Agent 自定义 schema。
 * 决策 D-06: ReviewOutputSchema 通过 .extend() 继承 TaskOutputSchema 并追加 verdict + issues。
 * 决策 D-07: Loop/ForEach 通过 .extend() 继承 TaskOutputSchema 并追加各自特有字段。
 */

import { z } from 'zod';

// ---- 基础类型 ----

/** 产出物定义：Agent 生成的文件或成果 */
export const ArtifactSchema = z.object({
  path: z.string().min(1),
  kind: z.string().min(1),
  description: z.string().optional(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

// ---- 节点输出 Schema ----

/** 普通任务节点输出 */
export const TaskOutputSchema = z.object({
  summary: z.string().min(1),
  status: z.enum(['success', 'failure']),
  artifacts: z.array(ArtifactSchema).optional(),
});
export type TaskOutput = z.infer<typeof TaskOutputSchema>;

/** 审查节点输出：在 task 基础上增加 verdict（审查结论）和 issues（发现问题列表） */
export const ReviewOutputSchema = TaskOutputSchema.extend({
  verdict: z.enum(['pass', 'fail', 'needs_changes']),
  issues: z.array(
    z.object({
      severity: z.enum(['critical', 'major', 'minor']),
      file: z.string().optional(),
      description: z.string().min(1),
    }),
  ).optional(),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/** 单次循环迭代的输出 */
export const LoopIterationSchema = z.object({
  iteration: z.number(),
  summary: z.string().min(1),
  status: z.enum(['success', 'failure']),
  artifacts: z.array(ArtifactSchema).optional(),
});
export type LoopIteration = z.infer<typeof LoopIterationSchema>;

/** Loop 节点输出：在 task 基础上增加 iterations（历次迭代记录） */
export const LoopOutputSchema = TaskOutputSchema.extend({
  iterations: z.array(LoopIterationSchema).optional(),
});
export type LoopOutput = z.infer<typeof LoopOutputSchema>;

/** ForEach 单个 item 的处理结果 */
export const ForEachItemSchema = z.object({
  index: z.number(),
  summary: z.string().min(1),
  status: z.enum(['success', 'failure']),
  artifacts: z.array(ArtifactSchema).optional(),
});
export type ForEachItem = z.infer<typeof ForEachItemSchema>;

/** ForEach 节点输出：在 task 基础上增加 results + 统计字段 */
export const ForEachOutputSchema = TaskOutputSchema.extend({
  results: z.array(ForEachItemSchema).optional(),
  totalItems: z.number().optional(),
  successCount: z.number().optional(),
  failCount: z.number().optional(),
});
export type ForEachOutput = z.infer<typeof ForEachOutputSchema>;

// ---- 降级输出 ----

/** 校验超限降级标记：超过 MAX_RETRIES 仍校验失败时返回此结构 */
export interface DegradedOutput {
  _degraded: true;
  _validationErrors: string[];
  rawText?: string;
}

// ---- Schema 工厂 ----

/**
 * 根据节点类型返回对应的输出校验 Schema。
 * 未识别的类型默认使用 TaskOutputSchema。
 */
export function getSchemaForNodeKind(kind: string): z.ZodType<any> {
  switch (kind) {
    case 'task':
      return TaskOutputSchema;
    case 'review':
      return ReviewOutputSchema;
    case 'loop':
      return LoopOutputSchema;
    case 'foreach':
      return ForEachOutputSchema;
    default:
      return TaskOutputSchema;
  }
}
