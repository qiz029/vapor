/** Installation paths and user data have separate lifetimes. */
import {mkdirSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
export function projectRoot(config={}) {
  const path=resolve(config.projectRoot||process.env.VAPOR_PROJECT_ROOT||process.env.MEDIA_WORKBENCH_PROJECT||'vapor-project');
  mkdirSync(path,{recursive:true,mode:0o700});
  return realpathSync(path);
}
