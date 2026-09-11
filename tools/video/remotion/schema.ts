import {z} from 'zod';

const timed = {start: z.number().finite().nonnegative(), end: z.number().finite().positive()};
const visualSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('image'), src: z.string().min(1), alt: z.string().min(1),
    fit: z.enum(['contain', 'cover']).default('contain'),
    motion: z.enum(['still', 'slow-zoom']).default('still')}).strict(),
  z.object({kind: z.literal('flow'),
    nodes: z.array(z.object({id: z.string().min(1), label: z.string().min(1).max(20),
      icon: z.enum(['person', 'model', 'tool', 'database'])}).strict()).min(2).max(4),
    steps: z.array(z.object({from: z.string(), to: z.string(), at: z.number().nonnegative(),
      duration: z.number().positive(), label: z.string().min(1).max(30)}).strict()).min(1),
  }).strict(),
]);
export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().min(1).max(100),
  width: z.number().int().min(320).max(3840).refine(n => n % 2 === 0),
  height: z.number().int().min(320).max(3840).refine(n => n % 2 === 0),
  fps: z.number().int().min(1).max(60),
  duration: z.number().finite().positive().max(3600),
  audio: z.string().min(1).optional(),
  syntheticVoice: z.boolean().default(false),
  scenes: z.array(z.object({
    visual: visualSchema.optional(),
    ...timed, title: z.string().min(1).max(100),
    body: z.string().max(240).default(''),
    points: z.array(z.string().min(1).max(100)).max(5).default([]),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#7de2c3'),
  }).strict()).min(1),
  captions: z.array(z.object({...timed, text: z.string().min(1).max(240)}).strict()).default([]),
}).strict().superRefine((m, ctx) => {
  for (const [kind, items] of [['scenes', m.scenes], ['captions', m.captions]] as const) {
    items.forEach((s, i) => {
      if (s.end <= s.start || s.end > m.duration + 0.000001 ||
          Math.round(s.end * m.fps) <= Math.round(s.start * m.fps)) {
        ctx.addIssue({code: 'custom', path: [kind, i], message: 'Invalid or sub-frame time range'});
      }
      if (i && s.start < items[i - 1].end - 0.000001) {
        ctx.addIssue({code: 'custom', path: [kind, i], message: 'Ranges must be ordered and non-overlapping'});
      }
      if (kind === 'scenes' && Math.abs(s.start - (i ? items[i - 1].end : 0)) > 0.000001) {
        ctx.addIssue({code: 'custom', path: [kind, i], message: 'Scenes must cover the timeline without gaps'});
      }
    });
  }
  m.scenes.forEach((scene, i) => {
    const v = scene.visual;
    if (v?.kind !== 'flow') return;
    const ids = v.nodes.map(n => n.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({code: 'custom', path: ['scenes', i], message: 'Duplicate flow node id'});
    v.steps.forEach((step, j) => {
      if (!ids.includes(step.from) || !ids.includes(step.to) || step.from === step.to ||
          step.at + step.duration > scene.end - scene.start || step.duration * m.fps < 1 ||
          (j > 0 && step.at < v.steps[j - 1].at + v.steps[j - 1].duration)) {
        ctx.addIssue({code: 'custom', path: ['scenes', i, 'visual', 'steps', j], message: 'Flow steps need valid distinct nodes, sequential timings and must fit the scene'});
      }
    });
  });
  if (Math.abs(m.scenes.at(-1)!.end - m.duration) > 0.000001) {
    ctx.addIssue({code: 'custom', path: ['scenes'], message: 'Last scene must end at duration'});
  }
});
export type Manifest = z.infer<typeof manifestSchema>;
export const frameCount = (m: Manifest) => Math.ceil(m.duration * m.fps);
