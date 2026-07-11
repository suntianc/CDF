import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BackgroundGenerateVideoInput } from './background-capability-jobs';
import { backgroundCapabilityJobs } from './background-capability-runtime';

export function createGenerateVideoJobTool(projectPath: string, sourceSessionId?: string) {
  return tool(
    async (input: BackgroundGenerateVideoInput) =>
      JSON.stringify(await backgroundCapabilityJobs.submitVideo(input, projectPath, sourceSessionId)),
    {
      name: 'generate_video',
      description:
        'Queue explicit text-to-video or first-frame image-to-video generation through connected providers. ' +
        'A first-frame request accepts exactly one provider-neutral first-frame image from a local path or public URL. ' +
        'CDF freezes that input into Project-local Job storage before returning a stable Job Receipt. ' +
        'Queued work has not incurred provider cost; the Project task panel reports the frozen route, mode, ' +
        'safe input summary, discrete provider states, tracking controls, and final local MP4 artifact.',
      schema: z.object({
        mode: z.enum(['text', 'first-frame']).describe('Explicit video generation mode'),
        prompt: z.string().describe('Description of the video to generate'),
        images: z.array(z.object({
          role: z.literal('first-frame'),
          source: z.string().min(1).describe('Local image path or public http(s) URL'),
        })).max(1).optional(),
        route_hint: z.enum(['auto', 'xai-oauth', 'minimax-token-plan']).optional(),
        duration: z.number().int().min(1).max(15).optional().describe('Video duration in seconds'),
        aspect_ratio: z.enum(['16:9', '9:16', '1:1']).optional(),
        resolution: z.enum(['480p', '720p', '768P', '1080P']).optional(),
      }),
    }
  );
}
