/** Project-scoped activation; installed code and historical jobs are retained. */
export function mountPlugins({el,api,container,refresh}){
 const panel=el('section',{'aria-label':'创作能力',class:'plugin-manager'}),cards=el('div',{class:'plugin-grid'}),summary=el('p'),error=el('p',{role:'status'}),search=el('input',{type:'search',placeholder:'搜索创作能力','aria-label':'搜索创作能力'});
 const names={'project':'项目管理','audio':'音频处理','captions':'字幕与转写','editing':'视频剪辑','remotion':'画面与动画','images':'图片导入','review':'视频检查','vlm-modal':'画面理解','music':'音乐制作','generation-fal':'视频生成 · fal','gpu-modal':'云端处理','motion-viggle':'动作处理 · Viggle','costs':'费用管理','regression':'成片质量检查','voice-local':'本地声音 · macOS','review-gemini':'Gemini 审阅（可选）'};
 panel.append(el('h2',{text:'创作能力'}),el('p',{text:'选择当前项目启用的能力。立即生效并自动保存；停用保留历史记录，正在执行的任务继续完成。'}),summary,search,error,cards);container.append(panel);
 let signature='',plugins=[];
 function draw(){cards.replaceChildren();const q=search.value.trim().toLowerCase();for(const p of plugins){const title=names[p.name.replace('vapor-','')]||p.name;if(q&&!JSON.stringify([title,p.name,p.operations]).toLowerCase().includes(q))continue;
  const toggle=el('input',{type:'checkbox',role:'switch','aria-label':'启用 '+title});toggle.checked=p.enabled;
  toggle.addEventListener('change',async()=>{toggle.disabled=true;error.textContent='';try{await api('/toolkit/plugin-toggle',{name:p.name,enabled:toggle.checked});await refresh();}catch(e){toggle.checked=p.enabled;error.textContent=e.message;}finally{toggle.disabled=false;}});
  const details=el('details',{},el('summary',{text:p.operations.length?`查看 ${p.operations.length} 项能力`:'图片 / 视频批次检查与恢复'}));for(const o of p.operations)details.append(el('p',{text:o.description}));
  cards.append(el('article',{class:'plugin-card','data-plugin':p.name},el('div',{class:'plugin-card-heading'},el('h3',{text:title}),el('label',{},toggle,p.enabled?'已启用':'已停用')),el('p',{text:p.remote?'使用云端服务，开始前会请你确认':'在本机处理'}),el('details',{},el('summary',{text:'技术详情'}),el('p',{text:p.name}),el('p',{text:`资源：${p.resources==='present'?'已找到':'缺失'} · 依赖：${p.requirements.join('、')}`}),el('p',{text:p.checks.map(c=>`${c.available?'✓':'缺少'} ${c.name}`).join(' · ')}),el('p',{class:'note',text:'以上仅检查本机程序；Python 模块、模型与凭据在执行时验证。'})),details));
 }if(!cards.children.length)cards.append(el('p',{text:'没有找到匹配的创作能力。'}));}
 search.addEventListener('input',draw);
 return state=>{plugins=state.toolkit?.plugins||[];summary.textContent=`可用 ${plugins.length} 项创作能力 · 启用 ${plugins.filter(p=>p.enabled).length} 个`;const next=JSON.stringify(plugins);if(signature!==next){signature=next;draw();}};
}
