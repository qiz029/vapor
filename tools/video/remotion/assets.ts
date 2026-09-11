import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import type {Manifest} from './schema';

export async function imageAssets(manifest: Manifest, manifestPath: string) {
  const assets = [];
  for (const [sceneIndex, scene] of manifest.scenes.entries()) {
    if (scene.visual?.kind !== 'image') continue;
    const path = resolve(dirname(manifestPath), scene.visual.src);
    const data = await readFile(path);
    const png = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
    const webp = data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    if (!png && !jpeg && !webp) throw new Error(`Scene ${sceneIndex}: image must be a PNG, JPEG or WebP`);
    assets.push({sceneIndex, path, sha256: createHash('sha256').update(data).digest('hex'),
      stagedName: `scene-${sceneIndex}.${png ? 'png' : jpeg ? 'jpg' : 'webp'}`});
  }
  return assets;
}
