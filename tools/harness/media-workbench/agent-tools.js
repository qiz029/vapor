/** Read-only media tools for the media preset. Mutation/generation intentionally absent in M1. */
import { Store } from './store.js';
import { capabilityCatalog } from './capabilities.js';
import {projectRoot} from './project.js';
export const inject=['tools','vaporRuntime'];
export function apply(ctx,config={}) {
  const root=projectRoot(config);
  ctx.effect(()=>{
    const store=ctx.vaporRuntime.store;
    const definitions=[
      ['media_project_get','Read registered media artifacts, immutable versions, feedback, and existing job states. No generation or budget mutation.',{},()=>({project:ctx.vaporRuntime.projectInfo?.(),...store.snapshot(),...store.jobs()})],
      ['media_artifact_get','Resolve an immutable media revision and its registered file path for local inspection. Do not confuse old revisions with the current version.',{revisionId:{type:'string'}},args=>store.file(args.revisionId)],
      ['media_feedback_list','Read persistent user feedback, including exact artifact revision and time/region locator. Feedback is not paid-generation approval.',{},()=>({feedback:store.snapshot().feedback})],
      ['media_capabilities_get','Read Vapor capability groups, skill names, dependencies and execution readiness. Skills do not grant tools or spending permission.',{},()=>{
        const workspace=config.workspaceRoot||process.env.VAPOR_WORKSPACE_ROOT;
        if(!workspace)return {configured:true,distribution:'portable',operations:ctx.vaporRuntime?.toolkit?.list()??[],note:'Installed tool plugins are authoritative. Use media_tool_help for packaged contracts/examples, media_adapters_list for legacy local adapters, and media_vlm_list for Modal Qwen.'};
        return {...capabilityCatalog(workspace),operations:ctx.vaporRuntime?.toolkit?.list()??[]};
      }]
    ];
    const disposers=definitions.map(([name,description,properties,execute])=>ctx.tools.register({name,description,parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false},output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async args=>JSON.parse(JSON.stringify(execute(args)))}));
    return ()=>{disposers.forEach(d=>d());};
  });
}
