export function mountCanvas({el,api,fileURL,open,container}){
  const toolbar=el('div',{class:'canvas-toolbar'}),viewport=el('div',{class:'canvas-viewport',tabindex:'0','aria-label':'项目画布'}),world=el('div',{class:'canvas-world'}),status=el('span',{role:'status'});
  viewport.append(world);container.replaceChildren(toolbar,viewport);
  let nodes=new Map(),artifacts=[],selected=new Set(),zoom=1,pan={x:40,y:40},gesture=null,space=false,ready=false,saving=Promise.resolve();
  const viewKey='vapor.canvas.view:'+location.search;
  try{const v=JSON.parse(localStorage.getItem(viewKey));if(v&&Number.isFinite(v.zoom)){zoom=Math.max(.15,Math.min(3,v.zoom));pan=v.pan;}}catch{}
  function transform(){world.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`;localStorage.setItem(viewKey,JSON.stringify({zoom,pan}));}
  function save(ids){const items=[...ids].map(id=>nodes.get(id)).filter(Boolean).map(({element,...n})=>n);status.textContent='保存中…';saving=saving.catch(()=>{}).then(()=>api('/canvas',{items})).then(()=>status.textContent='已保存').catch(e=>{status.textContent='保存失败 · '+e.message;});}
  let animationFrame=null,pendingFocus=null,focusedId=null;
  function cancelAnimation(){if(animationFrame!==null)cancelAnimationFrame(animationFrame);animationFrame=null;}
  function camera(){return {x:(viewport.clientWidth/2-pan.x)/zoom,y:(viewport.clientHeight/2-pan.y)/zoom,zoom};}
  function animateCamera(stages){
    cancelAnimation();
    const apply=v=>{zoom=v.zoom;pan={x:viewport.clientWidth/2-v.x*zoom,y:viewport.clientHeight/2-v.y*zoom};transform();};
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){apply(stages.at(-1));return;}
    let from=camera(),started=null,index=0;
    function tick(now){
      if(started===null)started=now;
      const to=stages[index],t=Math.min(1,(now-started)/to.duration),ease=t*t*(3-2*t);
      apply({x:from.x+(to.x-from.x)*ease,y:from.y+(to.y-from.y)*ease,zoom:Math.exp(Math.log(from.zoom)+(Math.log(to.zoom)-Math.log(from.zoom))*ease)});
      if(t===1){index++;if(index===stages.length){animationFrame=null;return;}from=camera();started=now;}
      animationFrame=requestAnimationFrame(tick);
    }
    animationFrame=requestAnimationFrame(tick);
  }
  function boundsCamera(ns,padding=80,maxZoom=1.5){
    const x=Math.min(...ns.map(n=>n.x)),y=Math.min(...ns.map(n=>n.y)),w=Math.max(...ns.map(n=>n.x+n.w))-x,h=Math.max(...ns.map(n=>n.y+n.h))-y;
    return {x:x+w/2,y:y+h/2,zoom:Math.max(Number.EPSILON,Math.min(maxZoom,Math.max(1,viewport.clientWidth-padding)/w,Math.max(1,viewport.clientHeight-padding)/h))};
  }
  function fit(){if(!nodes.size)return;pendingFocus=null;focusedId=null;animateCamera([{...boundsCamera([...nodes.values()]),duration:760}]);}
  const fullscreen=el('button',{class:'canvas-fullscreen','aria-label':'进入全屏',text:'全屏',onclick:async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch(e){status.textContent=e.message;}}});
  document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'退出全屏':'全屏';fullscreen.setAttribute('aria-label',document.fullscreenElement?'退出全屏':'进入全屏');});
  toolbar.append(el('button',{text:'适合窗口',onclick:fit}),status,fullscreen);
  viewport.append(el('div',{class:'canvas-hint',text:'拖动作品 · Shift 多选 · 空格拖动画布 · 双击聚焦'}));
  function position(n){Object.assign(n.element.style,{left:n.x+'px',top:n.y+'px',width:n.w+'px',height:n.h+'px'});}
  function mark(){for(const n of nodes.values())n.element?.classList.toggle('is-selected',selected.has(n.id));}
  function draw(n){
    n.element?.remove();const a=artifacts.find(a=>a.id===n.id),r=a?.revisions.find(r=>r.id===a.current);
    const box=el('div',{class:'canvas-node '+(n.kind==='frame'?'canvas-frame':''),'data-node':n.id,tabindex:'0','aria-label':a?.title||n.title});n.element=box;
    const heading=el('div',{class:'canvas-node-title',text:a?.title||n.title});box.append(heading);
    if(r){let media;if(r.mime.startsWith('image/'))media=el('img',{src:fileURL(r.id),alt:a.title,draggable:'false'});else if(/^(video|audio)\//.test(r.mime))media=el(r.mime.split('/')[0],{src:fileURL(r.id),controls:'',preload:'metadata',playsinline:''});else{media=el('div',{class:'canvas-document',text:a.title});if(r.mime.startsWith('text/')||r.mime==='application/json')fetch(fileURL(r.id)).then(r=>r.text()).then(t=>media.textContent=t.slice(0,2400)).catch(()=>{});}if(/^(video|audio)\//.test(r.mime)){const play=el('button',{class:'canvas-play','aria-label':'播放 '+a.title,text:'▶ 播放',onclick:async()=>{try{if(media.paused){if(media.ended)media.currentTime=0;await media.play();}else media.pause();}catch(e){status.textContent='无法播放：'+e.message;}}});media.addEventListener('play',()=>{play.textContent='Ⅱ 暂停';play.setAttribute('aria-label','暂停 '+a.title);});const paused=()=>{play.textContent='▶ 播放';play.setAttribute('aria-label','播放 '+a.title);};media.addEventListener('pause',paused);media.addEventListener('ended',paused);media.addEventListener('error',()=>status.textContent='此视频无法在当前浏览器播放，请在详情中打开原文件');box.append(play);}box.append(media,el('button',{class:'canvas-open',text:'查看 / 修改',onclick:()=>open(a.id)}));box.addEventListener('dblclick',e=>{if(!e.target.closest('video,audio,button'))focus(a.id);});}
    box.append(el('div',{class:'canvas-resize','aria-label':'调整大小'}));world.append(box);position(n);mark();
  }
  viewport.addEventListener('pointerdown',e=>{
    if(e.target.closest('button,video,audio,input,textarea,select')||e.button>1)return;
    viewport.focus();const box=e.target.closest('[data-node]'),n=box&&nodes.get(box.dataset.node),point={x:e.clientX,y:e.clientY};
    if(space||e.button===1){gesture={type:'pan',point,pan:{...pan}};}
    else if(n){if(e.shiftKey){selected.has(n.id)?selected.delete(n.id):selected.add(n.id);}else if(!selected.has(n.id))selected=new Set([n.id]);mark();
      const ids=new Set(selected);for(const id of selected){const f=nodes.get(id);if(f.kind==='frame')for(const v of nodes.values())if(v.kind!=='frame'&&v.x>=f.x&&v.y>=f.y&&v.x+v.w<=f.x+f.w&&v.y+v.h<=f.y+f.h)ids.add(v.id);}
      gesture={type:e.target.closest('.canvas-resize')?'resize':'move',point,ids,original:new Map([...ids].map(id=>[id,{...nodes.get(id)}])),target:n.id};
    }else{selected.clear();mark();gesture={type:'select',point};}
    viewport.setPointerCapture(e.pointerId);e.preventDefault();
  });
  viewport.addEventListener('pointermove',e=>{if(!gesture)return;const dx=e.clientX-gesture.point.x,dy=e.clientY-gesture.point.y;
    if(gesture.type==='pan'){pan={x:gesture.pan.x+dx,y:gesture.pan.y+dy};transform();}
    else if(gesture.type==='select'){const rect=viewport.getBoundingClientRect(),x1=(gesture.point.x-rect.left-pan.x)/zoom,y1=(gesture.point.y-rect.top-pan.y)/zoom,x2=(e.clientX-rect.left-pan.x)/zoom,y2=(e.clientY-rect.top-pan.y)/zoom;selected=new Set([...nodes.values()].filter(n=>n.kind!=='frame'&&n.x+n.w>=Math.min(x1,x2)&&n.x<=Math.max(x1,x2)&&n.y+n.h>=Math.min(y1,y2)&&n.y<=Math.max(y1,y2)).map(n=>n.id));mark();}
    else for(const id of gesture.ids){const n=nodes.get(id),o=gesture.original.get(id);if(gesture.type==='resize'){if(id!==gesture.target)continue;n.w=Math.max(140,o.w+dx/zoom);n.h=Math.max(100,o.h+dy/zoom);}else{n.x=o.x+dx/zoom;n.y=o.y+dy/zoom;}position(n);}
  });
  function finish(){if(gesture&&['move','resize'].includes(gesture.type))save(gesture.ids);gesture=null;}
  viewport.addEventListener('pointerup',finish);viewport.addEventListener('pointercancel',finish);
  viewport.addEventListener('keydown',e=>{if(e.target.closest('button,video,audio'))return;if(e.code==='Space'){space=true;e.preventDefault();}if(e.key==='Escape'){selected.clear();mark();}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();for(const id of selected){const n=nodes.get(id);n.x+=(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)*(e.shiftKey?10:1);n.y+=(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)*(e.shiftKey?10:1);position(n);}save(selected);}});
  window.addEventListener('keyup',()=>space=false);window.addEventListener('blur',()=>{space=false;finish();});
  viewport.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||e.metaKey){const rect=viewport.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,next=Math.max(.15,Math.min(3,zoom*Math.exp(-e.deltaY*.01)));pan={x:x-(x-pan.x)*next/zoom,y:y-(y-pan.y)*next/zoom};zoom=next;}else{pan.x-=e.deltaX;pan.y-=e.deltaY;}transform();},{passive:false});
  const loaded=api('/canvas').then(saved=>{for(const n of saved)nodes.set(n.id,n);ready=true;}).catch(e=>status.textContent=e.message);
  function focus(id){
    const n=nodes.get(id);if(!n?.element){pendingFocus=id;return;}
    pendingFocus=null;selected=new Set([id]);mark();
    const target=boundsCamera([n],64,4),previous=nodes.get(focusedId),stages=[];
    if(previous&&focusedId!==id){
      const current=camera();
      // Pull back around the current view before travelling toward the next work.
      stages.push({...current,zoom:Math.min(current.zoom,target.zoom)*.85,duration:480});
      stages.push({...target,duration:800});
    }else stages.push({...target,duration:480});
    focusedId=id;animateCamera(stages);
  }
  viewport.addEventListener('pointerdown',cancelAnimation,{capture:true});viewport.addEventListener('wheel',cancelAnimation,{capture:true});
  toolbar.addEventListener('click',cancelAnimation,{capture:true});
  let signature='';
  return {async update(next){artifacts=next;await loaded;for(const [id,n]of nodes)if(n.kind!=='frame'&&!next.some(a=>a.id===id)){n.element?.remove();nodes.delete(id);selected.delete(id);}if(!ready)return;if(!gesture){const saved=await api('/canvas');for(const n of saved)if(!nodes.has(n.id))nodes.set(n.id,n);}
    const sig=JSON.stringify([next.map(a=>[a.id,a.title,a.current]),[...nodes.keys()]]);if(sig===signature)return;signature=sig;
    const fresh=nodes.size===0;
    for(const a of artifacts){let n=nodes.get(a.id);if(!n){const bottom=Math.max(-40,...[...nodes.values()].map(n=>n.y+n.h));n={id:a.id,kind:'artifact',title:a.title,x:(artifacts.indexOf(a)%3)*340,y:fresh?Math.floor(artifacts.indexOf(a)/3)*310:bottom+70,w:300,h:a.kind==='audio'?150:260};nodes.set(a.id,n);save([a.id]);}const contentKey=JSON.stringify([a.title,a.current]);if(!n.element||n.element.dataset.contentKey!==contentKey){draw(n);n.element.dataset.contentKey=contentKey;}}for(const n of nodes.values())if(n.kind==='frame')draw(n);transform();if(pendingFocus)focus(pendingFocus);},focus};
}
