import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import {
  analyzeVision,
  generateImage,
  ingestVoiceInput,
  synthesizeVoiceOutput,
} from '../multimodal';

const z = tool.schema;

export function createMultimodalTools(
  projectDir: string,
): Record<string, ToolDefinition> {
  const miya_generate_image = tool({
    description:
      'Generate an image asset with local multimodal pipeline and persist metadata.',
    args: {
      prompt: z.string().describe('Image prompt'),
      reference_media_ids: z
        .array(z.string())
        .optional()
        .describe('Optional reference media ids'),
      model: z.string().optional().describe('Image model id'),
      size: z.string().optional().describe('Output size (for example 1024x1024)'),
      register_as_companion_asset: z
        .boolean()
        .optional()
        .describe('Also add generated image into companion assets'),
    },
    async execute(args) {
      const result = await generateImage(projectDir, {
        prompt: String(args.prompt),
        referenceMediaIDs: Array.isArray(args.reference_media_ids)
          ? args.reference_media_ids.map(String)
          : undefined,
        model: args.model ? String(args.model) : undefined,
        size: args.size ? String(args.size) : undefined,
        registerAsCompanionAsset: Boolean(args.register_as_companion_asset),
      });
      return [
        `media_id=${result.media.id}`,
        `file=${result.media.fileName}`,
        `model=${result.model}`,
        `size=${result.size}`,
        `prompt=${result.prompt}`,
      ].join('\n');
    },
  });

  const miya_voice_input = tool({
    description:
      'Ingest voice input text/media into Miya voice state and history.',
    args: {
      text: z.string().optional().describe('Recognized text content'),
      media_id: z.string().optional().describe('Optional media id for ASR transcript'),
      source: z.enum(['wake', 'talk', 'manual', 'media']).optional(),
      language: z.string().optional().describe('Language hint, for example zh-CN'),
    },
    async execute(args) {
      const result = ingestVoiceInput(projectDir, {
        text: args.text ? String(args.text) : undefined,
        mediaID: args.media_id ? String(args.media_id) : undefined,
        source: args.source,
        language: args.language ? String(args.language) : undefined,
      });
      return [
        `source=${result.source}`,
        `media_id=${result.mediaID ?? ''}`,
        `text=${result.text}`,
      ].join('\n');
    },
  });

  const miya_voice_output = tool({
    description:
      'Generate TTS voice output asset with local multimodal pipeline and persist metadata.',
    args: {
      text: z.string().describe('Text to synthesize'),
      voice: z.string().optional().describe('Voice profile id or name'),
      model: z.string().optional().describe('TTS model id'),
      format: z.enum(['wav', 'mp3', 'ogg']).optional(),
      register_as_companion_asset: z
        .boolean()
        .optional()
        .describe('Also add generated voice into companion assets'),
    },
    async execute(args) {
      const result = await synthesizeVoiceOutput(projectDir, {
        text: String(args.text),
        voice: args.voice ? String(args.voice) : undefined,
        model: args.model ? String(args.model) : undefined,
        format: args.format,
        registerAsCompanionAsset: Boolean(args.register_as_companion_asset),
      });
      return [
        `media_id=${result.media.id}`,
        `file=${result.media.fileName}`,
        `voice=${result.voice}`,
        `model=${result.model}`,
        `format=${result.format}`,
      ].join('\n');
    },
  });

  const miya_vision_analyze = tool({
    description:
      'Analyze an image media asset and return metadata-based summary.',
    args: {
      media_id: z.string().describe('Image media id'),
      question: z.string().optional().describe('Optional analysis question'),
    },
    async execute(args) {
      const result = await analyzeVision(projectDir, {
        mediaID: String(args.media_id),
        question: args.question ? String(args.question) : undefined,
      });
      return [
        `media_id=${result.mediaID}`,
        `summary=${result.summary}`,
        `details=${JSON.stringify(result.details)}`,
      ].join('\n');
    },
  });

  return {
    miya_generate_image,
    miya_voice_input,
    miya_voice_output,
    miya_vision_analyze,
  };
}
