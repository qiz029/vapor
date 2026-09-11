import {VlmService} from './service.js';
export const inject=['vaporRuntime'];
export function apply(ctx,config={}){ctx.effect(()=>ctx.vaporRuntime.forEachProject?ctx.vaporRuntime.forEachProject(runtime=>install(runtime,config)):install(ctx.vaporRuntime,config));}
function install(runtime,config){
 const service=new VlmService(runtime.store,{...config,environment:()=>runtime.toolkit.credentialEnvironment?.('vapor-vlm-modal')??{}});
 const unregister=runtime.toolkit.registerPack('vapor-vlm-modal',service.root,[],config);
 service.checkEnabled=()=>runtime.toolkit.requireEnabled('vapor-vlm-modal');
 service.isEnabled=()=>runtime.toolkit.enabled('vapor-vlm-modal');
 const dispose=runtime.registerService('vlm',service);
 return async()=>{await dispose();unregister();};
}
