/** Optional plugin tools are registered into the selected Agent's scope. */
export const inject=['tools','vaporRuntime'];
export function apply(ctx){
  ctx.effect(()=>{
    const service=ctx.vaporRuntime.services.get('vlm');
    const dynamic=new Proxy({}, {get:(_t,key)=>{const v=ctx.vaporRuntime.services.get('vlm');const member=v[key];return typeof member==='function'?member.bind(v):member;}});return service?.registerTools.call(dynamic,ctx.tools);
  });
}
