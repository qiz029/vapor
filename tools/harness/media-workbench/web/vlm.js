/** Persistent forms: metadata polling never discards an unfinished approval. */
export function mountVlm({el,api,fileURL,source,container,refresh,jobsOnly=false}){
  const panel=el('section',{'aria-label':'Modal Qwen 素材检查'}),queue=[],queueView=el('div'),jobs=el('div'),status=el('p',{role:'status'});
  const question=el('textarea',{'aria-label':'素材检查问题',placeholder:'希望检查哪些可见内容？'}),start=el('input',{type:'number',min:'0',step:'.1',value:'0','aria-label':'检查开始秒'}),end=el('input',{type:'number',min:'0',step:'.1',value:'5','aria-label':'检查结束秒'}),frames=el('input',{type:'number',min:'2',max:'12',value:'8','aria-label':'每段抽帧数'});
  let current=null,signature='',command=null;const drafts=new Map();
  function showQueue(){queueView.replaceChildren(...queue.map((item,i)=>el('div',{class:'job'},el('p',{text:`${item.sourceRevisionId} · ${item.start===undefined?'图片':`${item.start}–${item.end}s`} · ${item.question}`}),el('button',{text:'移出本批',onclick:()=>{queue.splice(i,1);command=null;showQueue();}}))));}
  const add=el('button',{text:'加入检查批次',onclick:()=>{try{
    const revision=current?.artifacts.flatMap(a=>a.revisions).find(r=>r.id===source.value);
    if(!revision||! /^(image|video)\//.test(revision.mime))throw new Error('请选择图片或视频版本');
    if(!question.value.trim())throw new Error('请填写检查问题');if(queue.length>=40)throw new Error('每批最多 40 项');
    queue.push({sourceRevisionId:revision.id,question:question.value,...(revision.mime.startsWith('video/')?{start:Number(start.value),end:Number(end.value)}:{})});command=null;showQueue();status.textContent='已加入；准备批次只在本地抽帧，不上传。';
  }catch(error){status.textContent=error.message;}}});
  const prepare=el('button',{text:'本地准备批次',onclick:async()=>{prepare.disabled=true;command??=crypto.randomUUID();try{await api('/vlm/prepare',{commandId:command,items:queue,frameCount:Number(frames.value)});queue.length=0;command=null;showQueue();await refresh();}catch(error){status.textContent=error.message;}finally{prepare.disabled=false;}}});
  if(jobsOnly)panel.append(el('h2',{text:'素材检查任务'}),status,jobs);else panel.append(el('h2',{text:'素材检查 · Modal / Qwen'}),el('p',{text:'图片直接检查，视频抽帧检查。不包含声音或完整连续播放。先加入本批，再准备、核对上传范围和费用。'}),question,el('label',{},'视频开始秒',start),el('label',{},'视频结束秒',end),el('label',{},'每段抽帧数',frames),add,queueView,prepare,status,jobs);container.append(panel);
  const field=(label,type='text',value='')=>{const input=el('input',{type,'aria-label':label,value});if(type==='number'){input.min='0';input.step='.01';}return input;};
  function action(button,fn,error){button.addEventListener('click',async()=>{button.disabled=true;try{await fn();await refresh();}catch(e){error.textContent=e.message;button.disabled=false;}});return button;}
  return function render(state){
    current=state;panel.hidden=!state.vlm; if(!state.vlm)return;
    prepare.disabled=state.vlm.busy||state.vlm.enabled===false;add.disabled=state.vlm.busy||state.vlm.enabled===false;prepare.textContent=state.vlm.enabled===false?'插件已停用':'本地准备批次';
    const sig=JSON.stringify([state.vlm.jobs,state.vlm.enabled]);if(sig===signature)return;signature=sig;jobs.replaceChildren();
    for(const j of state.vlm.jobs){
      const box=el('div',{class:'job'},el('strong',{text:`${j.id} · ${j.state}`})),error=el('p',{role:'status',text:j.error||''});
      box.append(el('p',{text:j.cost?`预估 $${j.cost.estimatedUSD} · 预留 $${j.cost.reservedUSD} · 实际 ${j.cost.actualUSD===null?'待核账':'$'+j.cost.actualUSD}`:'未提交 GPU'}));
      if(j.preview){box.append(el('p',{text:`上传 ${(j.preview.uploadBytes/1024).toFixed(1)} KiB · ${j.preview.shots.length} 项 · ${j.preview.model}`}),el('p',{text:`模型版本 ${j.preview.modelRevision} · 输入 SHA256 ${j.preview.inputSha256}`}));for(const s of j.preview.shots)box.append(el('p',{text:`${s.sourceRevisionId} · ${s.kind==='image'?'静态图片':`采样秒数 ${s.sampledSeconds.join(', ')}`} · ${s.question}`}));}
      if(j.state==='awaiting_approval'&&state.vlm.enabled!==false){
        const budget=field('项目总预算 USD','number',state.budget?.cap??''),estimate=field('本批预估 USD','number'),reservation=field('本批预留 USD','number'),pricing=field('费用估算依据'),expiry=field('价格有效截止日','date'),note=field('本批授权说明'),confirmed=el('input',{type:'checkbox'});
        if(state.budget)budget.readOnly=true;
        const draftKey=j.id+':'+j.approvalFingerprint,fields={budget,estimate,reservation,pricing,expiry,note};
        const saved=drafts.get(draftKey)||{};
        for(const [key,input]of Object.entries(fields)){if(saved[key]!==undefined&&!input.readOnly)input.value=saved[key];input.addEventListener('input',()=>{drafts.set(draftKey,{...drafts.get(draftKey),[key]:input.value});});}
        confirmed.checked=saved.confirmed===true;confirmed.addEventListener('change',()=>drafts.set(draftKey,{...drafts.get(draftKey),confirmed:confirmed.checked}));
        box.append(el('p',{text:'使用当前项目统一账本。预留金额不是实际账单，也不是云端硬性消费上限。仅此批图片会上传至你的 Modal 账户。'}));
        for(const [name,input]of [['项目总预算 USD',budget],['本批预估 USD',estimate],['本批预留 USD',reservation],['费用估算依据',pricing],['价格有效截止日',expiry],['本批授权说明',note]])box.append(el('label',{},name,input));
        box.append(el('label',{},confirmed,'我确认上述来源、上传范围与本批费用授权'),action(el('button',{text:'授权并提交此批'}),()=>api('/vlm/approve',{id:j.id,approvalFingerprint:j.approvalFingerprint,confirmed:confirmed.checked,budgetUSD:Number(budget.value),estimatedUSD:Number(estimate.value),reservedUSD:Number(reservation.value),pricingSource:pricing.value,priceValidThrough:expiry.value,authorizationNote:note.value}),error));
      }
      if(j.state==='awaiting_approval')box.append(action(el('button',{text:'取消本次检查'}),()=>api('/vlm/cancel',{id:j.id}),error));
      if(['submitted','recovery_required','submission_unknown'].includes(j.state)){
        box.append(action(el('button',{text:'查询原任务 / 取回结果'}),()=>api('/vlm/resume',{id:j.id}),error));
        const call=field('原 Modal call ID'),evidence=field('对账证据');
        box.append(el('details',{},el('summary',{text:'提交未知：登记已核实的原任务'}),call,evidence,action(el('button',{text:'关联原 call ID'}),()=>api('/vlm/reconcile',{id:j.id,callId:call.value,evidence:evidence.value}),error)));
        const terminal=field('终态核实证据');box.append(el('details',{},el('summary',{text:'远端已取消或失败'}),el('p',{text:'先在 Modal 控制台取消或确认失败；本按钮不终止 GPU，也不退还预留。'}),terminal,...['failed','cancelled'].map(value=>action(el('button',{text:value==='failed'?'记录远端失败':'记录远端已取消'}),()=>api('/vlm/mark-terminal',{id:j.id,state:value,evidence:terminal.value}),error))));
      }
      if(j.reportRevisionId)box.append(el('a',{href:fileURL(j.reportRevisionId),target:'_blank',rel:'noopener',text:'查看完整检查报告（原始回答、观察与覆盖范围）'}),el('p',{text:`结构待复核项：${j.needsReview?.join(', ')||'无'}；作品仍未验收。报告也已登记在画板。`}));
      if(['completed','failed','cancelled'].includes(j.state)&&j.cost&&j.cost.actualUSD===null){const amount=field('实际费用 USD','number'),evidence=field('账单证据');box.append(el('details',{},el('summary',{text:'按实际账单结算'}),amount,evidence,action(el('button',{text:'记录实际费用'}),()=>api('/vlm/settle',{id:j.id,actualUSD:Number(amount.value),evidence:evidence.value}),error)));}
      box.append(error);jobs.append(box);
    }
  };
}
