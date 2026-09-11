window.__ModuleLoader__.load({
  id:'@toddzheng024/vapor',
  factory:(require)=>{
    const React=require('react'),h=React.createElement;
    const id='@toddzheng024/vapor';
    function VaporMark({size=28}) {
      return h('svg',{width:size,height:size,viewBox:'0 0 32 32',fill:'none',role:'img','aria-label':'vapor 标志',style:{color:'var(--dsw-alias-brand-text)',flexShrink:0}},
        h('path',{d:'M6 5C2 13 12 15 16 27C20 15 30 13 26 5',stroke:'currentColor',strokeWidth:2.7,strokeLinecap:'round',strokeLinejoin:'round'}),
        h('path',{d:'M16 4C10 10 22 12 16 19',stroke:'currentColor',strokeWidth:2.7,strokeLinecap:'round'}));
    }
    function VaporName(){return h('span',{'aria-label':'vapor',style:{fontSize:27,fontWeight:650,letterSpacing:'-1.2px',lineHeight:1,fontFamily:'ui-sans-serif, system-ui, sans-serif',color:'var(--dsw-alias-label-primary)'}},'vapor');}
    // Public, reversible palette layer. Both modes stay readable; no durable
    // preference writes. Structural classes below are pinned to dsh 0.1.5-rc.1.
    const palette={
      'bg-base':['#f3f5f0','#0b0e13'],
      'bg-layer-1':['#e9eee5','#101620'],
      'bg-layer-2':['#ffffff','#19212c'],
      'bg-layer-3':['#e4eadf','#242e3b'],
      'bg-module-platform':['#f1f4ed','#0d131c'],
      'bg-overlay':['#ffffff','#18202c'],
      'brand-primary':['#496b1b','#c7f77b'],
      'brand-text':['#46651d','#c7f77b'],
      'brand-primary-invert':['#ffffff','#17210c'],
      'button-primary-fill':['#496b1b','#c7f77b'],
      'button-primary-hover':['#3b5813','#daffa3'],
      'button-primary-dimmed':['#d7e4c2','#435334'],
      'button-floating-fill':['#ffffff','#202c3c'],
      'button-floating-hover':['#e7efda','#2b3b4e'],
      'button-elevated-fill':['#ffffff','#1d2837'],
      'button-ghost-active-fill':['#e1edce','#c7f77b18'],
      'button-ghost-active-hover':['#d5e5b9','#c7f77b25'],
      'button-ghost-active-border':['#a8bf82','#c7f77b50'],
      'label-primary':['#1e2a20','#e6edf5'],
      'label-secondary':['#546351','#aab9cc'],
      'label-tertiary':['#64735f','#8c9bb0'],
      'label-primary-foreground':['#ffffff','#18240b'],
      'label-primary-bluish':['#324724','#d7e5c4'],
      'border-l1':['#d4decc','#ffffff10'],
      'border-l2':['#c3cfb9','#ffffff1c'],
      'border-l3':['#b4c1a8','#ffffff2a'],
      'interactive-bg-hover':['#e4ecd9','#c7f77b0c'],
      'interactive-bg-active':['#dce9c8','#c7f77b17'],
      'interactive-bg-hover-solid':['#e2ead9','#253044'],
      'link':['#45651a','#c7f77b'],
      'markdown-code-block':['#eaf0e3','#0a111b'],
      'markdown-code-block-banner':['#dfe9d3','#151f2c'],
      'markdown-inline-code':['#e4ecd9','#253146'],
    };
    // Pinned DSH 0.1.5 layout adapter: keep its drag/clamp/collapse semantics.
    function installSplitters(layout){
      const panels=layout?.panels;if(!panels?.setSidebar||!panels?.setRightbar)return()=>{};
      const key='vapor.layout.widths.v1';let raf=0,dragSide=null,disposed=false;
      const widths=()=>{const f=document.querySelector('.pI_x6G_frame');return f?{sidebar:f.querySelector('.pI_x6G_sidebarCol')?.getBoundingClientRect().width,rightbar:f.querySelector('.pI_x6G_rightbarCol')?.getBoundingClientRect().width}:{};};
      const save=()=>{const w=widths();let old={};try{old=JSON.parse(localStorage.getItem(key)||'{}');}catch{};for(const side of ['sidebar','rightbar'])if(w[side]>0)old[side]=w[side];try{localStorage.setItem(key,JSON.stringify(old));}catch{}};
      try{const value=JSON.parse(localStorage.getItem(key)||'{}');if(window.innerWidth>=1024&&Number.isFinite(value.sidebar)&&value.sidebar>=264&&value.sidebar<=420)panels.setSidebar(value.sidebar);if(Number.isFinite(value.rightbar)&&value.rightbar>=300)panels.setRightbar(value.rightbar);}catch{}
      const observed=new WeakSet(),original=new Map();
      const update=()=>{raf=0;if(disposed)return;const f=document.querySelector('.pI_x6G_frame');if(!f)return;const fr=f.getBoundingClientRect();
        for(const n of [f,...f.querySelectorAll('.pI_x6G_sidebarCol,.pI_x6G_centerCol,.pI_x6G_rightbarCol')])if(!observed.has(n)){observed.add(n);resize.observe(n);}
        for(const h of f.querySelectorAll('.pI_x6G_handle')){if(!original.has(h))original.set(h,{transform:h.style.transform,role:h.getAttribute('role'),tabindex:h.getAttribute('tabindex')});const side=h.dataset.side,left=f.querySelector(side==='sidebar'?'.pI_x6G_sidebarCol':'.pI_x6G_centerCol'),right=f.querySelector(side==='sidebar'?'.pI_x6G_centerCol':'.pI_x6G_rightbarCol');if(!left||!right)continue;const a=left.getBoundingClientRect(),b=right.getBoundingClientRect();h.style.transform=`translateX(${(a.right+b.left)/2-fr.left-parseFloat(h.style.left)}px)`;h.setAttribute('role','separator');h.tabIndex=0;h.setAttribute('aria-orientation','vertical');h.setAttribute('aria-label',side==='sidebar'?'调整侧栏宽度':'调整聊天与工作台宽度');h.setAttribute('aria-valuenow',String(Math.round(side==='sidebar'?a.width:b.width)));h.title='拖动调整宽度 · 方向键微调 · 双击恢复默认';}
      };
      const schedule=()=>{if(!raf)raf=requestAnimationFrame(update);};const resize=new ResizeObserver(schedule),mutation=new MutationObserver(schedule);mutation.observe(document.body,{subtree:true,childList:true});schedule();
      const handle=e=>e.target.closest?.('.pI_x6G_handle');
      const down=e=>{const h=handle(e);if(h&&e.button===0)dragSide=h.dataset.side;};
      const up=()=>{if(dragSide){dragSide=null;requestAnimationFrame(()=>{if(!disposed)save();});}};
      const keyboard=e=>{const h=handle(e);if(!h||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const w=widths(),delta=(e.key==='ArrowRight'?1:-1)*(e.shiftKey?40:10);if(h.dataset.side==='sidebar')panels.setSidebar(w.sidebar+delta);else panels.setRightbar(w.rightbar-delta);requestAnimationFrame(save);};
      const reset=e=>{const h=handle(e);if(!h)return;if(h.dataset.side==='sidebar')panels.setSidebar(280);else panels.setRightbar(window.innerWidth*.45);requestAnimationFrame(save);};
      document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);document.addEventListener('keydown',keyboard);document.addEventListener('dblclick',reset);
      return()=>{disposed=true;cancelAnimationFrame(raf);resize.disconnect();mutation.disconnect();document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);document.removeEventListener('keydown',keyboard);document.removeEventListener('dblclick',reset);for(const [h,o]of original){h.style.transform=o.transform;for(const k of ['role','tabindex'])o[k]===null?h.removeAttribute(k):h.setAttribute(k,o[k]);for(const k of ['aria-label','aria-orientation','aria-valuenow','title'])h.removeAttribute(k);}};
    }
    function installCreativeProcess(){
      const button=document.createElement('button');button.className='vapor-process-toggle';button.textContent='查看详情';button.setAttribute('aria-expanded','false');
      button.onclick=()=>{const open=document.body.toggleAttribute('data-vapor-process-details');button.textContent=open?'收起详情':'查看详情';button.setAttribute('aria-expanded',String(open));};
      const attach=()=>{const root=document.querySelector('.pI_x6G_centerCol .uV2eYG_root');if(root&&!button.isConnected)root.append(button);};
      const observer=new MutationObserver(attach);observer.observe(document.body,{childList:true,subtree:true});attach();return()=>{observer.disconnect();button.remove();document.body.removeAttribute('data-vapor-process-details');};
    }
    const shellCSS=`
      body[data-media-studio] .pI_x6G_rightbarCol:has(iframe[title="项目画布"]) [class*="_tabStrip_"]{display:none!important}
      body[data-media-studio] [data-sidebar-right-panel]:has(iframe[title="项目画布"]) [class*="_tabStrip_"]{display:none!important}

      body[data-media-studio] .pI_x6G_handle{width:10px;margin-left:-5px;transition:none;outline:none}
      body[data-media-studio] .pI_x6G_handle:after{content:"";position:absolute;left:4px;top:35%;height:30%;width:2px;border-radius:2px;background:var(--dsw-alias-border-l3)}
      body[data-media-studio] .pI_x6G_handle:hover:after,body[data-media-studio] .pI_x6G_handle:focus-visible:after,body[data-media-studio] .pI_x6G_handle[data-dragging]:after{background:var(--dsw-alias-brand-primary);width:3px;box-shadow:0 0 6px var(--dsw-alias-brand-primary)}
      body[data-media-studio] .pI_x6G_frame[data-dragging]{user-select:none;cursor:col-resize}
      body[data-media-studio] .pI_x6G_frame[data-dragging] iframe{pointer-events:none}

      body[data-media-studio] .pI_x6G_frame{box-sizing:border-box;padding:12px;gap:10px;background:var(--dsw-alias-bg-base)}
      body[data-media-studio] .pI_x6G_sidebarCol{border:1px solid var(--dsw-alias-border-l1);border-radius:18px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
      body[data-media-studio] .pI_x6G_centerCol{border:1px solid var(--dsw-alias-border-l1);border-radius:18px;overflow:hidden;background:var(--dsw-alias-bg-base)}
      body[data-media-studio] .pI_x6G_rightbarCol{border:1px solid var(--dsw-alias-border-l2);border-radius:18px;overflow:hidden}
      body[data-media-studio] .hHd-Xa_root{background:transparent}
      body[data-media-studio] .hHd-Xa_logoRow{min-height:66px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:12px}
      body[data-media-studio] .hHd-Xa_newSession{border:1px solid var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-brand-text);border-radius:12px;min-height:42px;transition:background .2s,box-shadow .2s}
      body[data-media-studio] .hHd-Xa_newSession:hover{background:var(--dsw-alias-button-ghost-active-hover);box-shadow:0 4px 20px #0002}
      body[data-media-studio] [role=treeitem][aria-selected=true]{background:var(--dsw-alias-interactive-bg-active);box-shadow:inset 3px 0 var(--dsw-alias-brand-primary);border-radius:7px}
      body[data-media-studio] .wSkVaW_header{padding-top:8px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2)}
      body[data-media-studio] .wSkVaW_tabs{gap:6px;padding-bottom:8px;padding-top:6px}
      body[data-media-studio] .wSkVaW_tab{border-radius:7px;padding:7px 14px;font-size:12px;transition:background .18s}
      body[data-media-studio] .wSkVaW_tabActive{color:var(--dsw-alias-brand-text);background:var(--dsw-alias-interactive-bg-active);box-shadow:inset 0 -2px var(--dsw-alias-brand-primary)}
      body[data-media-studio] .wSkVaW_tabActive:after{display:none}
      body[data-media-studio] .uV2eYG_card{border:1px solid var(--dsw-alias-border-l3);border-radius:18px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 45px #0003;transition:border-color .2s,box-shadow .2s}
      body[data-media-studio] .uV2eYG_card:focus-within{border-color:var(--dsw-alias-button-ghost-active-border);box-shadow:0 0 0 3px var(--dsw-alias-button-ghost-active-fill),0 14px 45px #0003}
      body[data-media-studio] .uV2eYG_scroll{max-height:260px}
      body[data-media-studio] .uV2eYG_input{line-height:1.8}
      body[data-media-studio] .uV2eYG_primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);box-shadow:0 0 18px var(--dsw-alias-button-ghost-active-fill);border:1px solid var(--dsw-alias-button-ghost-active-border)}
      body[data-media-studio] .uV2eYG_primary:hover{background:var(--dsw-alias-button-primary-hover)}
      body[data-media-studio] .Sixlwa_bubble{background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2);border-radius:15px;box-shadow:0 6px 20px #0001}
      body[data-media-studio] .uV2eYG_tools{border-top:1px solid var(--dsw-alias-border-l1);padding-top:9px}
      body[data-media-studio] ._tabStrip_17p4l_156{background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2);min-height:46px}
      body[data-media-studio] ._tabStrip_17p4l_156 [role=tab][aria-selected=true]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-brand-text);border:1px solid var(--dsw-alias-button-ghost-active-border);border-radius:7px}
      body[data-media-studio] button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
      body[data-media-studio][data-ds-dark-theme] .pI_x6G_frame{background:radial-gradient(ellipse at 20% 0,#30463b44,transparent 48%),radial-gradient(ellipse at 90% 100%,#23355244,transparent 48%),#080c12}
      @media(max-width:767px){body[data-media-studio] .pI_x6G_frame{padding:0;gap:0}body[data-media-studio] .pI_x6G_centerCol,body[data-media-studio] .pI_x6G_rightbarCol{border-radius:0}body[data-media-studio] .uV2eYG_scroll{max-height:200px}}

      body[data-media-studio] [class*="_newSession"]{display:none!important}
      .vapor-project-sidebar{height:100%;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;gap:12px;color:var(--dsw-alias-label-primary);overflow:hidden}
      .vapor-project-rail{display:flex;flex-direction:column;align-items:center;gap:10px;padding:8px 0;min-width:0}.vapor-project-rail button{display:grid;place-items:center;flex-shrink:0;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:20px;cursor:pointer}.vapor-project-rail button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-text)}
      .vapor-project-brand{display:flex;align-items:center;gap:10px;padding:10px 2px 20px}
      .vapor-project-sidebar button,.vapor-project-sidebar input,.vapor-project-sidebar select,.vapor-project-sidebar textarea{font:inherit;color:inherit;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;padding:8px;box-sizing:border-box}
      .vapor-project-sidebar button{cursor:pointer;text-align:left}.vapor-project-sidebar button:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .vapor-project-sidebar .vapor-project-new{color:var(--dsw-alias-brand-text);border-color:var(--dsw-alias-button-ghost-active-border);background:var(--dsw-alias-interactive-bg-active);text-align:center}
      .vapor-project-list{flex:1;overflow:auto}.vapor-project-title{width:100%;margin:4px 0;font-weight:600!important;overflow-wrap:anywhere}.vapor-project-title[aria-current=true]{border-left:3px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-active)}
      .vapor-project-contents{padding:4px 0 12px 10px}.vapor-project-contents>button{margin:4px 3px 4px 0}.vapor-project-contents h3{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:18px 0 6px}.vapor-project-empty,.vapor-project-status{font-size:12px;color:var(--dsw-alias-label-tertiary)}.vapor-project-error{font-size:13px;color:#ff8989;overflow-wrap:anywhere}
      .vapor-artifact-menu{z-index:10000;width:150px;padding:5px;border:1px solid var(--dsw-alias-border-primary,#555);border-radius:10px;background:var(--dsw-alias-background-primary,#20252d);box-shadow:0 8px 24px #0004}.vapor-artifact-menu button{display:block;width:100%;text-align:left;padding:8px 12px;border:0;border-radius:6px;background:transparent;color:inherit}.vapor-artifact-menu button:hover,.vapor-artifact-menu button:focus{background:#8882}.vapor-artifact-menu .vapor-artifact-delete{color:#e56b6b}.vapor-project-item{display:flex;gap:2px;margin:3px 0}.vapor-project-item button{border:0}.vapor-project-item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.vapor-project-group{font-size:12px;padding:8px;color:var(--dsw-alias-label-secondary)}
      .vapor-project-settings{margin-top:auto}.vapor-project-modal{position:fixed;inset:0;z-index:9999;background:#0009;display:grid;place-items:center}.vapor-project-modal form{background:var(--dsw-alias-bg-layer-1);padding:24px;border-radius:16px;width:min(460px,90vw);max-height:85vh;overflow:auto}.vapor-project-modal label{display:block;margin:12px 0}.vapor-project-modal input:not([type=checkbox]),.vapor-project-modal textarea,.vapor-project-modal select{display:block;width:100%;margin-top:6px}.vapor-project-modal button{margin-right:8px}

      /* Creative conversation: crisp surfaces and restrained emphasis. */
      body[data-media-studio] [data-slot="conversation.hero.workspace"],body[data-media-studio] [data-slot="conversation.hero.agentPreset"]{display:none!important}
      body[data-media-studio] .pI_x6G_centerCol{border-radius:8px}
      body[data-media-studio] .wSkVaW_header{padding-top:0;background:transparent}
      body[data-media-studio] .wSkVaW_tabs{padding:0 18px;gap:18px}
      body[data-media-studio] .wSkVaW_tab{padding:10px 0;border-radius:0;font-size:12px;letter-spacing:.04em}
      body[data-media-studio] .wSkVaW_tabActive{background:transparent;box-shadow:inset 0 -2px var(--dsw-alias-brand-primary)}
      body[data-media-studio] .uV2eYG_root{padding:12px 22px 18px;--dsh-composer-card-max-width:860px}
      body[data-media-studio] .uV2eYG_card{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding-top:16px;gap:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:none}
      body[data-media-studio] .uV2eYG_card:focus-within{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 3px 0 var(--dsw-alias-brand-primary)}
      body[data-media-studio] .uV2eYG_input{padding:0 18px;min-height:72px;font-size:15px;line-height:1.7;letter-spacing:.01em}
      body[data-media-studio] .uV2eYG_placeholder{left:18px;top:0;font-size:14px}
      body[data-media-studio] .uV2eYG_row{padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1);gap:8px}
      body[data-media-studio] .uV2eYG_tools{border:0;padding:0;gap:8px}
      body[data-media-studio] .uV2eYG_primary{border-radius:5px;box-shadow:none;width:34px;height:34px;transform:none}
      body[data-media-studio] .uV2eYG_add{border-radius:5px;background:transparent}
      body[data-media-studio] .Sixlwa_bubble{border:0;border-left:2px solid var(--dsw-alias-border-l3);border-radius:0;background:var(--dsw-alias-bg-layer-1);box-shadow:none;line-height:1.75}
      @media(max-width:767px){body[data-media-studio] .uV2eYG_root{padding:8px 10px 12px}}
      body[data-media-studio] .uV2eYG_root{padding:6px 18px 8px}
      body[data-media-studio] .uV2eYG_card{padding-top:10px;gap:8px}
      body[data-media-studio] .uV2eYG_input,body[data-media-studio] .uV2eYG_hero .uV2eYG_input{min-height:44px;font-size:14px;line-height:22px}
      body[data-media-studio] .uV2eYG_scroll{max-height:180px}
      body[data-media-studio] .uV2eYG_row{padding:6px 10px}
      .vapor-process-toggle{align-self:flex-end;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);padding:4px 0;font:inherit;font-size:11px;cursor:pointer}
      body[data-media-studio]:not([data-vapor-process-details]) [data-chat-flow-kind="system-prompt"],
      body[data-media-studio]:not([data-vapor-process-details]) [data-chat-flow-kind="notice"],
      body[data-media-studio]:not([data-vapor-process-details]) [data-chat-flow-kind="turn-process"],
      body[data-media-studio]:not([data-vapor-process-details]) .lcKema_root{display:none!important}
      body[data-media-studio]:not([data-vapor-process-details]) [data-chat-flow-kind="tool-call"]:not(:has([role="alert"],[role="dialog"],input,textarea,[data-state="error"],[data-state="failed"])){display:none!important}
      body[data-media-studio] .EvIC1a_turnStatus{font-size:0;background:none;animation:none;-webkit-text-fill-color:var(--dsw-alias-brand-text);color:var(--dsw-alias-brand-text);gap:9px;height:30px}
      body[data-media-studio] .EvIC1a_turnStatus:before{content:"";width:22px;height:26px;background:currentColor;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M6 5C2 13 12 15 16 27C20 15 30 13 26 5M16 4C10 10 22 12 16 19' fill='none' stroke='black' stroke-width='2.7' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;animation:vapor-breathe 1.6s ease-in-out infinite}
      body[data-media-studio] .EvIC1a_turnStatus:after{content:"创作中";font-size:13px;letter-spacing:.04em}
      body[data-media-studio] .EvIC1a_turnStatusClock{display:none}
      @keyframes vapor-breathe{0%,100%{opacity:.45;transform:translateY(2px)}50%{opacity:1;transform:translateY(-2px)}}
      @media(prefers-reduced-motion:reduce){body[data-media-studio] .EvIC1a_turnStatus:before{animation:none}}
      @media(prefers-reduced-motion:reduce){body[data-media-studio] *{transition:none!important}}
    `;
    let projectTokenPromise;
    const projectToken=()=>projectTokenPromise??=fetch('/media-workbench/').then(r=>r.text()).then(text=>new DOMParser().parseFromString(text,'text/html').querySelector('meta[name=media-token]').content).catch(e=>{projectTokenPromise=null;throw e;});
    async function projectApi(path,data,retry=true){const response=await fetch('/media-workbench/projects'+path,{method:data?'POST':'GET',headers:{'x-media-token':await projectToken(),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const result=await response.json();if(!response.ok){if(retry&&result.error==='Invalid access token'){projectTokenPromise=null;return projectApi(path,data,false);}throw Error(result.error||'项目操作未完成');}return result;}
    async function uploadProjectFile(projectId,file,retry=true){
      const response=await fetch('/media-workbench/projects/upload?id='+encodeURIComponent(projectId)+'&name='+encodeURIComponent(file.name),{method:'POST',headers:{'x-media-token':await projectToken(),'Content-Type':'application/octet-stream'},body:file});
      const value=await response.json();
      if(!response.ok){if(retry&&value.error==='Invalid access token'){projectTokenPromise=null;return uploadProjectFile(projectId,file,false);}throw Error(value.error||'资料上传失败');}
      return value;
    }
    const projectSelections=new Map(),projectDrafts=new Map();
    function ProjectSidebar({renderSlot,projectCtx:ctx,wide=true,expandSidebar}){
      const [projects,setProjects]=React.useState([]),[selected,setSelected]=React.useState(null),[detail,setDetail]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[creating,setCreating]=React.useState(false),[name,setName]=React.useState(''),[editor,setEditor]=React.useState(null),[progress,setProgress]=React.useState(''),[menu,setMenu]=React.useState(null);
      const selectedRef=React.useRef(null),generation=React.useRef(0),uploadRef=React.useRef(null),booted=React.useRef(false),alive=React.useRef(true);
      const refresh=async()=>{const data=await projectApi('');if(alive.current)setProjects(data.projects);return data;};
      const open=async(p,artifactId)=>{
        const version=++generation.current;setError('');setBusy(true);
        try{let opened=await projectApi('/open',{id:p.id});if(!opened.sessionId){const ws=await ctx.workspaces.create({path:opened.root});await ctx.workspaces.rename(ws.workspaceId,opened.title);const sid=await ctx.sessions.create({workspaceId:ws.workspaceId,cwd:opened.root,sessionId:'vapor-'+opened.id});opened=await projectApi('/bind',{id:p.id,sessionId:sid});}
          // Official Web session creation supplies model selection and preset setup.
          for(let i=0;i<100&&!ctx.sessions.list.getSnapshot().byId[opened.sessionId];i++)await new Promise(r=>setTimeout(r,100));
          if(version!==generation.current||!alive.current)return;
          ctx.uiWorkspace.openSession(opened.sessionId);setEditor(null);setMenu(null);selectedRef.current=opened;setSelected(opened);localStorage.setItem('vapor.project.selected',opened.id);
          if(artifactId)projectSelections.set(opened.sessionId,artifactId);else projectSelections.delete(opened.sessionId);
          for(let attempt=0;attempt<80;attempt++){if(version!==generation.current||!alive.current)return;ctx.sidebarRight.openTabIn(opened.sessionId,'media-workbench');if([...document.querySelectorAll('iframe')].some(f=>new URL(f.src,location.href).searchParams.get('sessionId')===opened.sessionId))break;await new Promise(r=>setTimeout(r,75));}window.dispatchEvent(new CustomEvent('vapor-project-selection',{detail:{sessionId:opened.sessionId,artifactId}}));
          const nextDetail=await projectApi('/detail?id='+encodeURIComponent(opened.id));if(version!==generation.current||!alive.current)return;setDetail(nextDetail);await refresh();
        }catch(e){setError(e.message);}finally{if(version===generation.current)setBusy(false);}
      };
      React.useEffect(()=>{alive.current=true;refresh().then(data=>{if(booted.current||!alive.current)return;booted.current=true;const saved=localStorage.getItem('vapor.project.selected');const current=ctx.sessions.list.getSnapshot().current;const p=data.projects.find(p=>p.sessionId===current)||data.projects.find(p=>p.id===saved)||data.projects.find(p=>p.id===data.defaultId);if(p)void open(p);}).catch(e=>setError(e.message));const timer=setInterval(()=>{const p=selectedRef.current;if(p)projectApi('/detail?id='+encodeURIComponent(p.id)).then(d=>{if(alive.current&&selectedRef.current?.id===p.id)setDetail(d);}).catch(()=>{});},3000);return()=>{alive.current=false;clearInterval(timer);};},[]);
      const upload=async(files,chat=false)=>{const p=selectedRef.current;if(!p){setError('请先选择项目');return;}setError('');const refs=[];try{for(const [i,file]of [...files].entries()){setProgress(`正在添加 ${i+1}/${files.length}：${file.name}`);const value=await uploadProjectFile(p.id,file);refs.push(`${file.name}（资料版本：${value.revision.id}；项目路径：${value.revision.source}）`);}if(chat&&refs.length){const text='已添加本次参考资料：\n'+refs.join('\n');projectDrafts.set(p.sessionId,[projectDrafts.get(p.sessionId),text].filter(Boolean).join('\n'));window.dispatchEvent(new CustomEvent('vapor-project-draft',{detail:{sessionId:p.sessionId}}));}if(selectedRef.current?.id===p.id)setDetail(await projectApi('/detail?id='+encodeURIComponent(p.id)));setProgress(`已添加 ${refs.length} 份资料`);}catch(e){setError(e.message+ (refs.length?`（已有 ${refs.length} 份保存到项目）`:''));setProgress('');}};
      React.useEffect(()=>{const drag=e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();};const drop=e=>{if(!e.dataTransfer?.files.length||e.target.closest('.vapor-project-sidebar')||!e.target.closest('.pI_x6G_centerCol'))return;e.preventDefault();e.stopPropagation();void upload(e.dataTransfer.files,true);};document.addEventListener('dragover',drag);document.addEventListener('drop',drop,true);return()=>{document.removeEventListener('dragover',drag);document.removeEventListener('drop',drop,true);};},[]);
      React.useEffect(()=>{if(!menu)return;const dismiss=e=>{if(!e.target.closest('.vapor-artifact-menu')&&!e.target.closest('[data-artifact-menu]'))setMenu(null);};const key=e=>{if(e.key==='Escape'){setMenu(null);document.querySelector('[data-artifact-menu="'+CSS.escape(menu.a.id)+'"]')?.focus();}};document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',key);};},[menu]);
      React.useEffect(()=>{if(!wide){setMenu(null);setEditor(null);}},[wide]);
      const deleteArtifact=async()=>{const {a,project}=menu;setMenu(null);setError('');try{const next=await projectApi('/delete',{id:project.id,artifactId:a.id});if(selectedRef.current?.id===project.id)setDetail(next);if(projectSelections.get(project.sessionId)===a.id)projectSelections.delete(project.sessionId);}catch(e){setError(e.message);}};
      const saveEditor=async e=>{e.preventDefault();setError('');try{if(editor.artifactId)await projectApi('/organize',{...editor,id:selected.id});else await projectApi('/update',{id:selected.id,title:editor.title,brief:editor.brief});setEditor(null);await refresh();setDetail(await projectApi('/detail?id='+selected.id));}catch(e){setError(e.message);}};
      const rows=(category)=>{const items=(detail?.items||[]).filter(a=>a.category===category).sort((a,b)=>b.pinned-a.pinned);const groups=[...new Set(items.map(a=>a.groupName||''))];return groups.map(group=>h('div',{key:group},group&&h('div',{className:'vapor-project-group'},group),...items.filter(a=>(a.groupName||'')===group).map(a=>h('div',{className:'vapor-project-item',key:a.id},h('button',{className:'vapor-project-item-name',onClick:()=>open(selected,a.id),title:a.title},`${a.pinned?'★ ':''}${{image:'▧',video:'▷',audio:'♫',text:'▤'}[a.kind]||'◻'} ${a.title}`),h('button',{'aria-label':'更多操作 '+a.title,'data-artifact-menu':a.id,'aria-haspopup':'menu','aria-expanded':menu?.a.id===a.id,onClick:e=>{const rect=e.currentTarget.getBoundingClientRect();setMenu(menu?.a.id===a.id?null:{a,project:selected,x:Math.max(8,rect.right-150),y:Math.min(rect.bottom+4,window.innerHeight-100)});}},'⋯')))));};
      if(!wide)return h('nav',{className:'vapor-project-rail','aria-label':'项目快捷栏'},h('button',{'aria-label':'展开项目列表',title:'展开项目列表',onClick:()=>expandSidebar?.()},'▤'),h('button',{'aria-label':'新建项目',title:'新建项目',onClick:()=>{setCreating(true);expandSidebar?.();}},'＋'));
      return h('aside',{className:'vapor-project-sidebar',onDragOver:e=>{e.preventDefault();},onDrop:e=>{if(e.dataTransfer.files.length){e.preventDefault();e.stopPropagation();void upload(e.dataTransfer.files);}}},

        h('button',{className:'vapor-project-new',onClick:()=>setCreating(!creating)},'＋ 新建项目'),
        creating&&h('form',{onSubmit:async e=>{e.preventDefault();setError('');try{const p=await projectApi('/create',{title:name});setCreating(false);setName('');await open(p);}catch(e){setError(e.message);}}},h('input',{'aria-label':'项目名称',placeholder:'给作品起个名字',value:name,onChange:e=>setName(e.target.value),required:true,maxLength:100}),h('button',{type:'submit',disabled:busy},'创建')),
        h('div',{role:'status',className:'vapor-project-status'},busy?'正在打开项目…':progress),error&&h('div',{role:'alert',className:'vapor-project-error'},error),
        h('nav',{'aria-label':'项目',className:'vapor-project-list'},...projects.map(p=>h('div',{key:p.id},h('button',{'data-project-id':p.id,'aria-current':selected?.id===p.id?'true':undefined,className:'vapor-project-title',onClick:()=>open(p)},`${selected?.id===p.id?'▾':'▸'} ${detail?.id===p.id?detail.title:p.title}`),selected?.id===p.id&&h('div',{className:'vapor-project-contents'},
          h('button',{onClick:()=>setEditor({title:detail?.title||p.title,brief:detail?.brief||''})},'项目说明'),
          h('button',{onClick:()=>uploadRef.current.click()},'＋ 添加资料'),h('input',{ref:uploadRef,type:'file',multiple:true,hidden:true,onChange:e=>{void upload(e.target.files);e.target.value='';},accept:'.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov,.mp3,.wav,.m4a,.flac,.aiff,.txt,.md,.json,.srt,.vtt,.pdf,.docx'}),
          h('h3',{},'创作资料'),rows('inputs'),!(detail?.items||[]).some(a=>a.category==='inputs')&&h('p',{className:'vapor-project-empty'},'拖入剧本、图片、视频…'),h('h3',{},'创作成果'),rows('outputs'))))),

        menu&&h('div',{className:'vapor-artifact-menu',role:'menu','aria-label':'作品操作',style:{position:'fixed',left:menu.x,top:menu.y},onKeyDown:e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const buttons=[...e.currentTarget.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}}},h('button',{role:'menuitem',autoFocus:true,onClick:()=>{const a=menu.a;setEditor({artifactId:a.id,title:a.title,category:a.category,groupName:a.groupName||'',pinned:!!a.pinned});setMenu(null);}},'Edit'),h('button',{role:'menuitem',className:'vapor-artifact-delete',onClick:deleteArtifact},'Delete')),
        editor&&h('div',{className:'vapor-project-modal'},h('form',{onSubmit:saveEditor,role:'dialog','aria-modal':true,'aria-label':editor.artifactId?'整理素材':'项目说明'},h('h2',{},editor.artifactId?'整理素材':'项目说明'),h('label',{},'名称',h('input',{value:editor.title,required:true,onChange:e=>setEditor({...editor,title:e.target.value})})),editor.artifactId?h(React.Fragment,{},h('label',{},'归属',h('select',{value:editor.category,onChange:e=>setEditor({...editor,category:e.target.value})},h('option',{value:'inputs'},'创作资料'),h('option',{value:'outputs'},'创作成果'))),h('label',{},'分组',h('input',{value:editor.groupName,placeholder:'例如：角色、分镜、配音',onChange:e=>setEditor({...editor,groupName:e.target.value})})),h('label',{},h('input',{type:'checkbox',checked:editor.pinned,onChange:e=>setEditor({...editor,pinned:e.target.checked})}),'置顶')):h('label',{},'目标、风格与要求',h('textarea',{value:editor.brief,rows:7,maxLength:20000,onChange:e=>setEditor({...editor,brief:e.target.value})})),h('button',{type:'submit'},'保存'),h('button',{type:'button',onClick:()=>setEditor(null)},'取消'))));
    }

    function CapabilitySettings(){
      const projectId=localStorage.getItem('vapor.project.selected');
      return h('iframe',{title:'能力插件设置',src:'/media-workbench/?view=plugins'+(projectId?'&projectId='+encodeURIComponent(projectId):''),style:{width:'100%',height:'70vh',border:0},referrerPolicy:'no-referrer'});
    }
    function Body({sessionId,inputActions,useInput}) {
      const frame=React.useRef(null),draft=useInput(s=>s.draft);
      const draftRef=React.useRef(draft);draftRef.current=draft;
      const prepared=React.useRef(new Set());
      React.useEffect(()=>{
        const dismiss=event=>{if(event.target===frame.current)return;frame.current?.contentWindow?.postMessage({channel:'vapor-project',type:'dismiss-detail',sessionId},location.origin);};
        document.addEventListener('pointerdown',dismiss,true);document.addEventListener('focusin',dismiss);
        return()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('focusin',dismiss);};
      },[sessionId]);
      React.useEffect(()=>{let focusRequest=0;const select=event=>{if(event?.type==='vapor-project-selection')focusRequest++;frame.current?.contentWindow?.postMessage({channel:'vapor-project',sessionId,artifactId:projectSelections.get(sessionId),focusRequest},location.origin);};const draft=()=>{const text=projectDrafts.get(sessionId);if(text){const next=[draftRef.current,text].filter(Boolean).join('\n\n');inputActions.setDraft(next);draftRef.current=next;projectDrafts.delete(sessionId);}};window.addEventListener('vapor-project-selection',select);window.addEventListener('vapor-project-draft',draft);const timer=setInterval(select,700);draft();return()=>{clearInterval(timer);window.removeEventListener('vapor-project-selection',select);window.removeEventListener('vapor-project-draft',draft);};},[sessionId,inputActions]);
      React.useEffect(()=>{
        const receive=event=>{
          if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.channel!=='media-workbench'||event.data?.sessionId!==sessionId) return;
          if(event.data.type==='feedback-draft' && typeof event.data.message==='string') {
            // Preserve any unsent human text; preparation is not submission.
            const key=sessionId+':'+event.data.id;
            if(!prepared.current.has(key)) {
              const next=[draftRef.current,event.data.message].filter(Boolean).join('\n\n');
              inputActions.setDraft(next);draftRef.current=next;prepared.current.add(key);
            }
            frame.current.contentWindow.postMessage({channel:'media-workbench',type:'draft-ready',id:event.data.id},location.origin);
          }
        };
        window.addEventListener('message',receive);return ()=>window.removeEventListener('message',receive);
      },[sessionId,inputActions]);
      return h('iframe',{ref:frame,title:'项目画布',allowFullScreen:true,src:'/media-workbench/?sessionId='+encodeURIComponent(sessionId),style:{width:'100%',height:'100%',border:0},referrerPolicy:'no-referrer'});
    }
    return {inject:['slots','sidebarRightTabs','sidebarRight','theme','layout','sessions','workspaces','uiWorkspace'],apply(ctx){
      ctx.effect(()=>ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'vapor-capabilities',order:14,label:()=> '能力插件'},CapabilitySettings)));
      ctx.effect(()=>installSplitters(ctx.layout));
      ctx.effect(()=>installCreativeProcess());
      ctx.effect(()=>ctx.slots.inject('sidebar.workspaces',()=>ctx.slots.register({name:'sidebar.workspaces',priority:-20,inject:()=>({projectCtx:ctx})},ProjectSidebar)));
      ctx.effect(()=>ctx.slots.inject('sidebar.brand.mark',()=>ctx.slots.register({name:'sidebar.brand.mark',priority:-10},VaporMark)));
      ctx.effect(()=>ctx.slots.inject('sidebar.brand.name',()=>ctx.slots.register({name:'sidebar.brand.name',priority:-10},VaporName)));
      ctx.effect(()=>ctx.theme.overrideTokens(id,Object.fromEntries(Object.entries(palette).map(([name,[light,dark]])=>['--dsw-alias-'+name,{light,dark}]))));
      ctx.effect(()=>{
        const previous=document.body.getAttribute('data-media-studio');
        const style=document.createElement('style');style.dataset.mediaStudio='shell';style.textContent=shellCSS;
        document.head.append(style);document.body.setAttribute('data-media-studio','');
        return()=>{style.remove();if(previous===null)document.body.removeAttribute('data-media-studio');else document.body.setAttribute('data-media-studio',previous);};
      });
      ctx.effect(()=>ctx.sidebarRightTabs.register({id,kind:'media-workbench',title:()=> '媒体工作台',guide:[{order:1,title:()=> '媒体工作台',description:()=> '产物、版本与精准反馈'}]}));
      ctx.effect(()=>ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:id},Body)));
    }};
  }
});
