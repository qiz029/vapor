import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export function registerTools(ctx,config={}){
 const resources=fileURLToPath(new URL('./resources/',import.meta.url));
 const root=existsSync(resources)?resources:fileURLToPath(new URL('../../../',import.meta.url));
 const catalog=JSON.parse(readFileSync(new URL('./catalog.json',import.meta.url),'utf8'));
 return ctx.vaporRuntime.toolkit.registerPack('vapor-review',root,catalog,config);
}
