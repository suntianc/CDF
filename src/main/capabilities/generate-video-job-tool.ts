import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { GenerateVideoInput } from './generate-video';
import { backgroundCapabilityJobs } from './background-capability-runtime';

export function createGenerateVideoJobTool(projectPath: string, sourceSessionId?: string) {
  return tool(
    async (input: GenerateVideoInput) =>
      JSON.stringify(await backgroundCapabilityJobs.submitVideo(input, projectPath, sourceSessionId)),
    {
      name: 'generate_video',
      description:
        'Queue video generation through connected xAI Grok OAuth using Grok Imagine. ' +
        'Returns a stable local Job Receipt before provider submission; queued work has not incurred provider cost. ' +
        'The Project task panel reports queueing, tracking controls, progress, and the final local MP4 artifact.',
      schema: z.object({
        prompt: z.string().describe('Description of the video to generate'),
        route_hint: z.enum(['auto', 'xai-oauth']).optional(),
        duration: z.number().int().min(1).max(15).optional().describe('Video duration in seconds'),
        aspect_ratio: z.enum(['16:9', '9:16', '1:1']).optional(),
        resolution: z.enum(['480p', '720p']).optional(),
      }),
    }
  );
}
