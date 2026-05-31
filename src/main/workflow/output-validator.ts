/**
 * Output Validator — 节点输出校验 + 自动重试 + 降级容错
 *
 * 为 Agent 节点输出提供 JSON Schema 强校验机制：
 * - validateOutput: 从输出文本提取 JSON → 按节点类型选 schema → safeParse
 * - buildRetryContext: 生成包含错误和期望 schema 的重试 prompt
 * - executeWithValidation: 包装 invokeAgent，失败自动重试（最多 5 轮），超限降级
 *
 * 决策 B-1 + B-3: MAX_RETRIES=5 硬限制，超限降级不阻塞工作流。
 */

import { z } from 'zod';
import { extractJsonCandidate } from './node-executor';
import { getSchemaForNodeKind, type DegradedOutput } from '../../shared/node-output-schemas';

/** 最大校验重试次数（硬限制） */
export const MAX_RETRIES = 5;

/** 校验成功结果 */
interface ValidationSuccess {
  valid: true;
  data: unknown;
}

/** 校验失败结果 */
interface ValidationFailure {
  valid: false;
  errors: string[];
}

type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * 校验 Agent 输出是否匹配对应节点类型的 Schema。
 *
 * 先从输出文本中提取 JSON 结构，再按 nodeKind 选择 schema 进行 safeParse。
 * 无法提取 JSON 返回明确错误信息。
 */
export function validateOutput(rawText: string, nodeKind: string): ValidationResult {
  const parsed = extractJsonCandidate(rawText);
  if (parsed === undefined || parsed === null) {
    return { valid: false, errors: ['无法从输出中提取有效的 JSON 结构'] };
  }

  const schema = getSchemaForNodeKind(nodeKind);
  const result = schema.safeParse(parsed);

  if (result.success) {
    return { valid: true, data: result.data };
  }

  const errors = result.error.issues.map((issue: any) => {
    const path = issue.path?.length ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });

  return { valid: false, errors };
}

/**
 * 生成重试上下文 prompt 片段。
 *
 * 包含：
 * - 期望的 JSON Schema（通过 z.toJSONSchema 序列化）
 * - 上一次校验的具体错误列表
 *
 * 使用中文描述以便 Agent 理解修正方向。
 */
export function buildRetryContext(errors: string[], schema: z.ZodType<any>): string {
  const jsonSchema = z.toJSONSchema(schema);
  const schemaStr = JSON.stringify(jsonSchema, null, 2);
  const errorList = errors.map((e) => `  - ${e}`).join('\n');

  return [
    '',
    '## 输出格式校验失败',
    '',
    '你的上一次输出不符合要求的 JSON Schema。请按照以下格式重新输出，',
    '确保输出是符合 JSON Schema 的有效 JSON 对象。',
    '',
    '### 期望的 JSON Schema',
    '```json',
    schemaStr,
    '```',
    '',
    '### 具体校验错误',
    errorList,
    '',
    '请修正上述错误后重新输出。',
  ].join('\n');
}

/**
 * 带校验和自动重试的 Agent 调用包装器。
 *
 * 流程：
 * 1. 调用 invokeAgent → 校验输出
 * 2. 校验失败 → 注入 retry context → 重新调用（最多 MAX_RETRIES 次）
 * 3. 成功 → 返回 { output: rawText, validated: parsedData }
 * 4. 超限 → 降级：返回 { output: rawText, degraded: { _degraded: true, ... } }
 *
 * 注意：每次 retry 使用 originalContext + buildRetryContext(...)，避免 baseContext 累积膨胀。
 */
export async function executeWithValidation(
  invokeAgent: (context: string) => Promise<string>,
  nodeKind: string,
  baseContext: string,
  onLog?: (log: string) => void,
): Promise<{ output: string; validated?: unknown; degraded?: DegradedOutput }> {
  const originalContext = baseContext;
  let lastOutput = '';
  let allErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const context = attempt === 1
      ? originalContext
      : originalContext + buildRetryContext(allErrors, getSchemaForNodeKind(nodeKind));

    const resultText = await invokeAgent(context);
    lastOutput = resultText;

    const validation = validateOutput(resultText, nodeKind);

    if (validation.valid) {
      return { output: resultText, validated: validation.data };
    }

    allErrors = validation.errors;
    onLog?.(`[校验] 第 ${attempt}/${MAX_RETRIES} 轮输出校验失败: ${allErrors.join('; ')}`);
  }

  // 超过最大重试次数，降级保留原始输出
  onLog?.(`[校验] 已达最大重试次数 (${MAX_RETRIES})，降级保留原始输出`);

  return {
    output: lastOutput,
    degraded: {
      _degraded: true,
      _validationErrors: allErrors,
      rawText: lastOutput,
    },
  };
}
