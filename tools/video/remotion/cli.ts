import {imageAssets} from './assets';
import {parseArgs} from 'node:util';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname, extname, resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {VERSION} from 'remotion';
import {frameCount, manifestSchema, type Manifest} from './schema';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
function probe(path: string) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], {encoding: 'utf8'}));
}
function verify(path: string, manifest: Manifest) {
  const info = probe(path);
  const video = info.streams.find((s: any) => s.codec_type === 'video');
  const audio = info.streams.find((s: any) => s.codec_type === 'audio');
  const [n, d] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  if (!video || video.width !== manifest.width || video.height !== manifest.height || n / d !== manifest.fps ||
      Number(video.nb_frames) !== frameCount(manifest) ||
      Math.abs(Number(info.format.duration) - frameCount(manifest) / manifest.fps) > .15 ||
      Boolean(audio) !== Boolean(manifest.audio)) throw new Error('Rendered media does not match manifest');
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'], {stdio: 'pipe'});
  return {fullDecode: 'passed', frames: Number(video.nb_frames), width: video.width, height: video.height,
    fps: n / d, duration: Number(info.format.duration), videoCodec: video.codec_name, audioCodec: audio?.codec_name ?? null};
}
async function main() {
  const {positionals, values} = parseArgs({allowPositionals: true, options: {
    manifest: {type: 'string'}, out: {type: 'string'}, frame: {type: 'string'},
    browser: {type: 'string'}, help: {type: 'boolean'},
    progress: {type: 'boolean'},
  }});
  const command = positionals[0];
  const progress = (phase: string, fraction: number | null = null) => {
    if (values.progress) console.error('VAPOR_PROGRESS ' + JSON.stringify({phase, fraction}));
  };
  if (values.help || !command) {
    console.log('npm run video -- <validate|still|render> --manifest FILE [--out NEW_DIRECTORY] [--frame N] [--browser PATH]\nAudio paths are relative to the manifest. still/render refuse existing output directories.');
    return;
  }
  if (!['validate', 'still', 'render'].includes(command) || positionals.length !== 1 || !values.manifest) throw new Error('Use --help for usage');
  const manifestPath = resolve(values.manifest);
  const source = await readFile(manifestPath);
  const m = manifestSchema.parse(JSON.parse(source.toString()));
  const images = await imageAssets(m, manifestPath);
  for (const asset of images) {
    const visual = m.scenes[asset.sceneIndex].visual;
    if (visual?.kind === 'image') visual.src = asset.path;
  }
  const audioPath = m.audio ? resolve(dirname(manifestPath), m.audio) : undefined;
  let audioHash: string | null = null;
  if (audioPath) {
    const info = probe(audioPath);
    if (!info.streams.some((s: any) => s.codec_type === 'audio')) throw new Error('Input has no audio stream');
    if (Math.abs(Number(info.format.duration) - m.duration) > .15) throw new Error('Audio duration must match manifest within 150ms; align the timeline first');
    audioHash = createHash('sha256').update(await readFile(audioPath)).digest('hex');
  }
  const frame = Number(values.frame ?? '0');
  if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount(m)) throw new Error('Frame is outside the timeline');
  if (command === 'validate') {
    console.log(JSON.stringify({valid: true, duration: m.duration, frames: frameCount(m), audioSha256: audioHash, images}));
    return;
  }
  if (!values.out) throw new Error('--out NEW_DIRECTORY is required');
  const out = resolve(values.out);
  await mkdir(dirname(out), {recursive: true});
  await mkdir(out); // Exclusive directory creation protects existing renders, including concurrent calls.
  const stage = await mkdtemp(join(tmpdir(), 'agent-media-'));
  try {
    const publicDir = join(stage, 'public');
    await mkdir(publicDir);
    const renderManifest = structuredClone(m);
    for (const asset of images) {
      await copyFile(asset.path, join(publicDir, asset.stagedName));
      const visual = renderManifest.scenes[asset.sceneIndex].visual;
      if (visual?.kind === 'image') visual.src = asset.stagedName;
    }
    if (audioPath) {
      renderManifest.audio = `narration${extname(audioPath)}`;
      await copyFile(audioPath, join(publicDir, renderManifest.audio));
    }
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const browserExecutable = values.browser ?? process.env.REMOTION_BROWSER_EXECUTABLE ?? [chrome,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/chromium-browser'].find(p=>existsSync(p));
    if(process.env.VAPOR_PLUGIN_MODE==='1'&&!browserExecutable)throw new Error('Install a browser and set REMOTION_BROWSER_EXECUTABLE before local rendering; no automatic download in Vapor');
    const started = performance.now();
    progress('bundling');
    const serveUrl = await bundle({entryPoint: join(root, 'tools/video/remotion/src/index.tsx'), publicDir, outDir: join(stage, 'bundle')});
    const inputProps = {manifest: renderManifest};
    const composition = await selectComposition({serveUrl, id: 'Timeline', inputProps, browserExecutable});
    const common = {serveUrl, composition, inputProps, browserExecutable, logLevel: 'error' as const};
    const artifact = join(out, command === 'still' ? 'preview.png' : 'final.mp4');
    let technical: unknown;
    if (command === 'still') {
      await renderStill({...common, output: artifact, frame, imageFormat: 'png'});
      technical = {renderedFrame: frame};
    } else {
      progress('rendering', 0);
      let lastProgress = 0;
      await renderMedia({...common, outputLocation: artifact, codec: 'h264', muted: !m.audio, pixelFormat: 'yuv420p', crf: 18, concurrency: 2,
        onProgress: ({progress: fraction}) => {if (Date.now() - lastProgress > 250 || fraction === 1) {progress('rendering', fraction); lastProgress = Date.now();}},
      });
      progress('verifying');
      technical = verify(artifact, m);
    }
    // Keep the resolved source manifest, not the temporary public URL, for reproducibility.
    await writeFile(join(out, 'manifest.json'), JSON.stringify({...m, ...(audioPath ? {audio: audioPath} : {})}, null, 2) + '\n');
    const report = {backend: 'remotion', version: VERSION, artifact, sourceManifest: manifestPath,
      manifestSha256: createHash('sha256').update(source).digest('hex'), audioSha256: audioHash, images,
      seconds: (performance.now() - started) / 1000, technical,
      visualReview: 'pending', listeningReview: m.audio ? 'pending' : 'not-applicable', playbackReview: 'pending'};
    await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    progress('complete', 1);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await writeFile(join(out, 'failure.json'), JSON.stringify({error: String(error), review: 'not-complete'}, null, 2) + '\n');
    throw error;
  } finally { await rm(stage, {recursive: true, force: true}); }
}
main().catch(error => {console.error(String(error)); process.exitCode = 1;});
