/** Renew protected media URLs without intentionally discarding playback position. */
const pending=new WeakMap();
export function renewMediaSource(media,url){
 if(media.src===url)return;
 const previous=pending.get(media);previous?.controller.abort();
 if(!['VIDEO','AUDIO'].includes(media.tagName)){media.src=url;return;}
 const controller=new AbortController(),position=previous?.position??(Number.isFinite(media.currentTime)?media.currentTime:0),resume=previous?.resume??(!media.paused&&!media.ended);
 pending.set(media,{controller,position,resume});
 media.addEventListener('loadedmetadata',()=>{
  if(pending.get(media)?.controller!==controller)return;
  pending.delete(media);controller.abort();
  try{media.currentTime=Number.isFinite(media.duration)?Math.min(position,media.duration):position;}catch{}
  if(resume)media.play().catch(()=>{});
 },{once:true,signal:controller.signal});
 media.src=url;
}
