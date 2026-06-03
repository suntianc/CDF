/**
 * Anthropic v1 path — video block passthrough regression guard.
 *
 * Quick task 260603-vht: completes the 260601-nzn partial patch by mirroring
 * the `standard.js:267` video passthrough hunk into `standard.cjs:267`.
 *
 * Background (the bug, the patch, the rationale):
 * - MiniMax M3 supports video input via the Anthropic-compatible Messages API.
 *   A client builds an AIMessage with content blocks such as
 *   `{ type: "video", source: { type: "base64", data, media_type: "video/mp4" } }`
 *   (or a URL / fileId source) and deepagents / LangChain transport must forward
 *   the block to the upstream API unchanged.
 * - On the v1 dispatch path (`AIMessage` with
 *   `response_metadata.output_version === "v1"`), `_convertMessagesToAnthropicPayload`
 *   (in `message_inputs.{js,cjs}`) routes to `_formatStandardContent`
 *   (in `standard.{js,cjs}`) which iterates `message.contentBlocks` and pushes
 *   recognized types onto a result array.
 * - 260601-nzn patched `standard.js:267` so the `else if (block.type === "video")`
 *   branch passes the block through (`{ result.push(block); continue; }`).
 *   The fix is symmetric with how LangChain handles the `image` and `text-plain`
 *   branches immediately below it.
 * - The 260601-nzn patch only modified `standard.js`. The parallel
 *   `standard.cjs` was left with an empty branch body
 *   `} else if (block.type === "video") {}`, so production Electron main
 *   (CJS bundle, `@langchain/anthropic#exports.require` routes to `.cjs`)
 *   still silently drops the video block on the v1 path. User-visible
 *   symptom: M3 multimodal video inputs appear to send but the model
 *   receives no video content.
 * - This test pins the v1 path video passthrough by calling
 *   `_formatStandardContent` directly (via `createRequire` on `standard.cjs`).
 *   It is the same dispatch path the production code takes; the test only
 *   bypasses the surrounding `_convertMessagesToAnthropicPayload` wrapper
 *   (which is already covered by `anthropic-roundtrip.test.ts` tests 1.2 / 1.5).
 *
 * Patch history (this file is the regression test for the .cjs parity hunk):
 * - 260601-nzn — `standard.js:267` video passthrough hunk (partial, missed .cjs)
 * - 260603-tiy — `_formatContentBlocks` reasoning roundtrip (fallthrough path)
 * - 260603-u6w — `_formatStandardContent` isAnthropicMessage guard removal (v1 path)
 * - 260603-vht — `standard.cjs:267` video passthrough hunk (this fix, completes parity)
 *
 * When upgrading `@langchain/anthropic` past 1.4.0:
 * - Re-run this test against the new version.
 * - If upstream now handles `block.type === "video"` in
 *   `_formatStandardContent` (i.e. `standard.cjs` no longer has the empty
 *   branch), drop the new hunk from `patches/@langchain+anthropic+1.4.0.patch`
 *   and delete this test file. The upstream library covers it.
 * - If upstream still has the empty branch, keep the hunk + this test.
 *
 * References:
 * - node_modules/@langchain/anthropic/dist/utils/standard.cjs:267 (target)
 * - node_modules/@langchain/anthropic/dist/utils/standard.js:267 (already fixed in 260601-nzn)
 * - node_modules/@langchain/anthropic/dist/utils/message_inputs.cjs:215-218
 *   (the v1 dispatch: `if (AIMessage.isInstance(message) && message.response_metadata?.output_version === "v1") return ...;`)
 * - patches/@langchain+anthropic+1.4.0.patch (5 hunks currently; 6 after this fix)
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const standardCjsPath = path.join(
  process.cwd(),
  'node_modules/@langchain/anthropic/dist/utils/standard.cjs'
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _formatStandardContent } = require(standardCjsPath) as {
  _formatStandardContent: (message: {
    contentBlocks: Array<Record<string, unknown>>;
    response_metadata?: Record<string, unknown>;
  }) => Array<Record<string, unknown>>;
};

describe('@langchain/anthropic v1 path — video block passthrough (260601-nzn .cjs parity)', () => {
  it('video block survives _formatStandardContent (would be silently dropped without standard.cjs:267 patch)', () => {
    // Construct a plain object mimicking the AIMessage shape that
    // `_convertMessagesToAnthropicPayload` v1 dispatch (message_inputs.cjs:215-218)
    // would feed to `_formatStandardContent`:
    //   - `contentBlocks` array containing one video block
    //   - `response_metadata.output_version === "v1"` (this is the trigger
    //     that takes the v1 path; without it, the message would be routed
    //     through `_formatContentBlocks` instead — a different code path
    //     already covered by `anthropic-roundtrip.test.ts` test 1.4)
    //
    // The video block shape uses `type: "video"` (NOT `type: "video_url"` or
    // any other variant) because that is the discriminator `_formatStandardContent`
    // branches on at line 267. The `source` sub-object follows the Anthropic
    // SDK `VideoBlockParam` shape — base64 form is the most common, so it is
    // what this test asserts. URL / fileId sources are forwarded unchanged
    // by the `{ result.push(block); continue; }` fix regardless of source
    // type, so this single-source assertion is sufficient to pin the fix.
    const message = {
      contentBlocks: [
        {
          type: 'video',
          source: {
            type: 'base64',
            data: 'AAAA',
            media_type: 'video/mp4',
          },
        },
      ],
      response_metadata: { output_version: 'v1' },
    } as unknown as Parameters<typeof _formatStandardContent>[0];

    const blocks = _formatStandardContent(message);

    // Assertion 1: at least one block survived. Without the standard.cjs:267
    // patch, the empty `else if (block.type === "video") {}` branch does
    // not push the block onto `result`, so `_formatStandardContent` returns
    // `[]`. The test will fail here with `Received: 0`.
    expect(blocks.length).toBeGreaterThanOrEqual(1);

    // Assertion 2: the surviving block is the video block (not some
    // unrelated block that was pushed from a different branch).
    expect(blocks[0].type).toBe('video');

    // Assertion 3: the source sub-object is preserved verbatim. The fix
    // is `result.push(block); continue;` — the entire block, including
    // its `source` sub-structure, is forwarded unchanged. If the
    // implementation ever strips the source (e.g. by mapping it through
    // a transformer), this assertion will fail and signal the regression.
    expect(blocks[0].source).toEqual({
      type: 'base64',
      data: 'AAAA',
      media_type: 'video/mp4',
    });
  });
});
