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
        'Queue video generation through connected xAI Grok OAuth or MiniMax Token Plan. ' +
        'MiniMax uses MiniMax-Hailuo-2.3. Returns a stable local Job Receipt before provider submission; ' +
        'queued work has not incurred provider cost. The Project task panel reports discrete provider ' +
        'states, tracking controls, and the final local MP4 artifact.',
      schema: z.object({
        prompt: z.string().describe('Description of the video to generate'),
        route_hint: z.enum(['auto', 'xai-oauth', 'minimax-token-plan']).optional(),
        duration: z.number().int().min(1).max(15).optional().describe('Video duration in seconds'),
        aspect_ratio: z.enum(['16:9', '9:16', '1:1']).optional(),
        resolution: z.enum(['480p', '720p', '768P', '1080P']).optional(),
      }),
    }
  );
}
