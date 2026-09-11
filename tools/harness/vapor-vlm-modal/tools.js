export const inject=['tools','vaporRuntime'];
export function apply(ctx){
  const service=()=>{const value=ctx.vaporRuntime.services.get('vlm');if(!value)throw new Error('Modal Qwen plugin unavailable');return value;};
  ctx.effect(()=>registerTools(ctx.tools,service));
}
export function registerTools(tools,service){
  const definitions=[
    {name:'media_vlm_list',description:'Read Modal Qwen review jobs. Still images and sampled video frames only, no audio or full playback.',parameters:{type:'object',properties:{},additionalProperties:false},execute:()=>service().snapshot()},
    {name:'media_vlm_prepare',description:'Prepare ONE bounded batch of 1–40 registered image/video sources locally. No upload or GPU submission. Group ready sources in one batch. The user approves exact upload and budget in Lab. Images omit start/end; videos require an explicit source time range. Never infer acceptance from observations.',parameters:{type:'object',additionalProperties:false,required:['commandId','items'],properties:{commandId:{type:'string'},frameCount:{type:'integer',minimum:2,maximum:12},items:{type:'array',minItems:1,maxItems:40,items:{type:'object',additionalProperties:false,required:['sourceRevisionId','question'],properties:{sourceRevisionId:{type:'string'},question:{type:'string',maxLength:5000},start:{type:'number',minimum:0},end:{type:'number',minimum:0}}}}}},execute:args=>service().prepare(args)},
    {name:'media_vlm_get',description:'Read a prepared/submitted review and the source-bound raw/parsed report when available. needs_review is not a pass; sampled frames do not establish full playback.',parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},execute:args=>service().get(args.id)},
    {name:'media_vlm_resume',description:'Collect the ORIGINAL approved Modal call, without submitting another GPU job. Unknown submission requires user reconciliation in Lab; do not create a new ID to retry.',parameters:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},execute:args=>service().recover(args)}
  ];
  const disposers=definitions.map(d=>tools.register({...d,execute:async args=>d.execute(args),output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]}}));return()=>disposers.forEach(dispose=>dispose());
}
