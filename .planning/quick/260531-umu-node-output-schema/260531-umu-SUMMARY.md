---
quick_id: 260531-umu
slug: node-output-schema
status: complete
date: 2026-05-31
commits: [32a5804, 25cb024, d7bee8e]
---

# Quick Task 260531-umu: 工作流节点输出 JSON Schema 校验机制

## Summary

Implement JSON Schema output validation for workflow Agent nodes using Zod, with automatic retry (max 5 attempts) and graceful degradation.

## Files Changed

| File | Op | Description |
|------|-----|-------------|
| `src/shared/node-output-schemas.ts` | NEW | Zod schemas: Artifact, Task, Review, LoopIteration, Loop, ForEachItem, ForEach + `getSchemaForNodeKind()` + `DegradedOutput` type |
| `src/main/workflow/output-validator.ts` | NEW | `validateOutput()`, `buildRetryContext()`, `executeWithValidation()` — retry loop with MAX_RETRIES=5, degradation on exhaustion |
| `src/main/workflow/node-executor.ts` | MOD | Exported `extractJsonCandidate`, integrated `executeWithValidation` into task/review, loop, and foreach execution paths; routing extraction unchanged |
| `src/main/workflow/node-executor.test.ts` | MOD | Updated existing tests to comply with schema validation; added 7 new tests covering: validation pass, retry-on-failure, degradation after 5 failures, review verdict validation, loop structuredOutput, routing preservation during validation, routing extraction during degradation |

## Design Decisions Applied

- **A-1**: Built-in per-node-kind Zod schemas (no user configuration)
- **B-1 + B-3**: Max 5 retries with validation errors fed back to Agent; exhaustion triggers degradation with `_degraded: true` + `_validationErrors`
- **D-08**: `extractWorkflowRouting()` operates on raw text, unaffected by validation
- **artifacts.kind**: Free-text `z.string().min(1)` with soft prompt guidance

## Test Results

```
PASS (12) FAIL (0) — src/main/workflow/node-executor.test.ts
```
