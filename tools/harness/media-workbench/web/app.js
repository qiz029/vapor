import {renewMediaSource} from './media-recovery.js';
import {mountCanvas} from './canvas.js';
import {mountVlm} from './vlm.js';
import {mountToolkit} from './toolkit.js';
let token=document.querySelector('meta[name=media-token]').content;
const base='/media-workbench',sessionId=new URL(location.href).searchParams.get('sessionId')||'preview';
const projectId=new URL(location.href).searchParams.get('projectId');
const scopeQuery=projectId?'projectId='+encodeURIComponent(projectId):'sessionId='+encodeURIComponent(sessionId);
let state,filter='all',selection=null,revisionId=null,compareId='',seq=-1;
let lastFocusRequest,refreshError=null;
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent||event.data?.channel!=='vapor-project'||event.data.sessionId!==sessionId)return;const data=event.data;if(data.type==='dismiss-detail'){$('detail').hidden=true;return;}if(data.artifactId&&(selection!==data.artifactId||lastFocusRequest!==data.focusRequest)){lastFocusRequest=data.focusRequest;selection=data.artifactId;revisionId=null;compareId='';$('detail').hidden=true;canvas.focus(selection);}});
const $=id=>document.getElementById(id);
const el=(tag,attrs={},...children)=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='text')n.textContent=v;else n.setAttribute(k,v);}children.flat().forEach(c=>n.append(c));return n;};
const fileURL=id=>`${base}/file/${encodeURIComponent(id)}?token=${token}&${scopeQuery}`;
let tokenRefresh;
async function renewToken(){
  tokenRefresh??=fetch(base+'/?'+scopeQuery,{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('本地连接尚未恢复');const html=new DOMParser().parseFromString(await r.text(),'text/html'),next=html.querySelector('meta[name=media-token]')?.content;if(!next)throw Error('请重新连接本地应用');token=next;
    for(const media of document.querySelectorAll('img[src],video[src],audio[src]')){const u=new URL(media.src,location.href);if(u.origin===location.origin&&u.pathname.startsWith(base+'/file/')){u.searchParams.set('token',token);renewMediaSource(media,u.href);}}
  }).finally(()=>tokenRefresh=null);return tokenRefresh;
}
async function api(path,body,retry=true){const r=await fetch(base+path+'?'+scopeQuery,{method:body?'POST':'GET',headers:{'x-media-token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok){if(retry&&r.status===403&&d.error==='Invalid access token'){await renewToken();return api(path,body,false);}throw new Error(d.error||'请求失败');}return d;}
function showError(e){$('error').textContent=e.message;}
const types={all:'全部',image:'图片',video:'视频',audio:'音频',text:'文档'};
function switchArea(area){
  for(const id of ['board','library','lab'])$('workspace-'+id).hidden=id!==area;
  document.querySelectorAll('[data-area]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.area===area)));
}
for(const [id,title]of [['board','画板'],['library','素材库'],['lab','Lab']])$('workspace-nav').append(el('button',{'data-area':id,'aria-pressed':String(id==='board'),text:title,onclick:()=>switchArea(id)}));
const labOperations=[['lab.image.describe','图片特征 / Prompt','image'],['lab.video.describe','视频特征 / 分镜 Prompt','video'],['lab.motion.extract','视频动作提取','video']];
function renderAreas(){
  const source=$('lab-source'),previous=source.value;
  source.replaceChildren(el('option',{value:'',text:'选择一个精确的来源版本…'}));
  for(const a of state.artifacts)for(const r of a.revisions)source.append(el('option',{value:r.id,text:`${a.title} · v${r.ordinal}`}));
  if([...source.options].some(o=>o.value===previous))source.value=previous;
  $('library-capabilities').replaceChildren(...[['motion.search','动作搜索'],['motion.download','动作下载'],['image.generate','图片生成'],['image.edit','图片编辑']].map(([op,title])=>capabilityCard(op,title)));
  $('library-items').replaceChildren(...state.artifacts.filter(a=>['image','video','audio'].includes(a.kind)).map(a=>el('div',{class:'job'},el('strong',{text:a.title}),el('p',{class:'note',text:`${a.kind} · ${a.revisions.length} 个版本 · 来源许可未核实`}),el('button',{text:'提取灵感',onclick:()=>{source.value=a.current;renderLab();switchArea('lab');}}))));
  if(!$('library-items').children.length)$('library-items').append(el('p',{text:'尚无已登记媒体素材。'}));
  renderLab();
}
function capabilityCard(op,title,compatible=true){
  if(['lab.motion.extract','motion.download'].includes(op)&&state.toolkit?.operations.some(o=>o.id==='motion.submit'))return el('div',{class:'job'},el('strong',{text:title}),el('p',{text:'Viggle 已接入 · 在插件工具中准备 mocap 计划；结果通过原任务取回。'}));
  if(state.vlm?.enabled!==false&&state.vlm&&['lab.image.describe','lab.video.describe'].includes(op))return el('div',{class:'job'},el('strong',{text:title}),el('p',{text:compatible?'Modal Qwen 已接入 · 在下方加入检查批次':'请选择匹配的来源类型'}));
  const adapters=(state.adapters||[]).filter(a=>a.operation===op);
  return el('div',{class:'job'},el('strong',{text:title}),el('p',{class:'note',text:op}),el('button',{disabled:'',text:!adapters.length?'暂不可用':!compatible?'请选择匹配的来源类型':'在聊天中告诉我你想怎么处理'}));
}
function renderLab(){
  const id=$('lab-source').value,a=state.artifacts.find(a=>a.revisions.some(r=>r.id===id)),r=a?.revisions.find(r=>r.id===id);
  $('lab-reference').textContent=r?`来源版本 ${r.id} · SHA256 ${r.sha256}`:'尚未选择来源';
  $('lab-capabilities').replaceChildren(...labOperations.map(([op,title,kind])=>capabilityCard(op,title,a?.kind===kind)));
}
$('lab-source').addEventListener('change',renderLab);
const voicePanel=el('section',{'aria-label':'本地声音 Lab'});
$('workspace-lab').append(voicePanel);
const voiceStart=el('input',{type:'number',min:'0',value:'0',step:'.1','aria-label':'声音片段开始秒'}),voiceDuration=el('input',{type:'number',min:'3',max:'30',value:'10',step:'.1','aria-label':'声音片段时长秒'});
const voiceMethod=el('select',{'aria-label':'声音预处理方法'},el('option',{value:'demucs',text:'Demucs 人声分离（默认）'}),el('option',{value:'none',text:'已干净单人录音：仅截取转格式'}));
const voiceNote=el('textarea',{'aria-label':'声音来源与用途',placeholder:'记录来源与用途；仅处理你有权使用的录音'});
const voiceStatus=el('p',{role:'status'}),voiceJobs=el('div');let voiceCommand=null;
const voiceSubmit=el('button',{text:'准备声音参考',onclick:async()=>{
  voiceSubmit.disabled=true;voiceCommand??=crypto.randomUUID();
  try{await api('/jobs',{commandId:voiceCommand,adapterId:'vapor-voice-local',artifactId:'voice-'+voiceCommand,title:'声音参考片段',input:{sourceRevisionId:$('lab-source').value,start:Number(voiceStart.value),duration:Number(voiceDuration.value),separation:voiceMethod.value,sourceNote:voiceNote.value}});voiceCommand=null;voiceStatus.textContent='任务已提交。完成后请试听全部音轨。';await refresh();}
  catch(e){voiceStatus.textContent=e.message;voiceSubmit.disabled=false;}
}});
voicePanel.append(el('h2',{text:'本地声音 / REFERENCE VOICE'}),el('p',{text:'3–30 秒单人片段。完全本地，网络被禁止；模型未缓存将失败，不自动下载。不是多说话人分离。'}),el('label',{},'开始秒',voiceStart),el('label',{},'时长秒',voiceDuration),voiceMethod,voiceNote,voiceSubmit,voiceStatus,voiceJobs);
let voiceSignature='';
function renderVoiceJobs(){
  voicePanel.hidden=!(state.adapters||[]).some(a=>a.id==='vapor-voice-local');
  voiceSubmit.disabled=!(state.adapters||[]).some(a=>a.id==='vapor-voice-local')||(state.renderJobs||[]).some(j=>['queued','running'].includes(j.state));
  const jobs=(state.renderJobs||[]).filter(j=>j.adapterId==='vapor-voice-local'),sig=JSON.stringify(jobs);if(sig===voiceSignature)return;voiceSignature=sig;voiceJobs.replaceChildren();
  for(const j of jobs){
    const box=el('div',{class:'job'},el('strong',{text:`${j.title} · ${j.state} / ${j.phase}`}),el('p',{text:`来源版本 ${j.input.sourceRevisionId} · ${j.input.start}s + ${j.input.duration}s`}));
    if(j.error)box.append(el('p',{text:j.error}));
    if(['queued','running'].includes(j.state))box.append(el('button',{text:'取消声音任务',onclick:async()=>{try{await api('/jobs/cancel',{id:j.id});await refresh();}catch(e){showError(e);}}}));
    if(j.state==='completed'){
      for(const a of [{name:'24 kHz 参考声音',revisionId:j.revisionId},...(j.assets||[])])box.append(el('label',{},a.name,el('audio',{controls:'',preload:'metadata',src:fileURL(a.revisionId)})));
      if(j.profileRevisionId)box.append(el('p',{text:`已保存 Profile · 版本 ${j.profileRevisionId}。可由 media_artifact_get 读取；尚未生成配音。`}));
      else{
        const key=`voice-review:${j.id}`,saved=loadDraft(key);
        const transcript=el('textarea',{'aria-label':`逐字稿 ${j.id}`,placeholder:'逐字核对片段，填写准确文本'}),authorization=el('textarea',{'aria-label':`声音授权 ${j.id}`,placeholder:'声音使用授权与限制'}),listened=el('input',{type:'checkbox'});
        transcript.value=saved.transcript||'';authorization.value=saved.authorization||'';
        const save=()=>sessionStorage.setItem(key,JSON.stringify({transcript:transcript.value,authorization:authorization.value}));transcript.addEventListener('input',save);authorization.addEventListener('input',save);
        const status=el('p',{role:'status'});
        box.append(transcript,authorization,el('label',{},listened,'我已试听参考声音和所有可用分离音轨，并核对逐字稿'),el('button',{text:'确认并保存声音 Profile',onclick:async e=>{e.target.disabled=true;try{await api('/voice/profile',{jobId:j.id,transcript:transcript.value,authorizationNote:authorization.value,listened:listened.checked});sessionStorage.removeItem(key);await refresh();}catch(error){status.textContent=error.message;e.target.disabled=false;}}}),status);
      }
    }
    voiceJobs.append(box);
  }
}
const labResults=el('section',{'aria-label':'Lab 提取结果'});
$('workspace-lab').append(labResults);
let labSignature='';
function renderLabResults(){
  const signature=JSON.stringify(state.labResults||[]);if(signature===labSignature)return;labSignature=signature;
  labResults.replaceChildren(el('h2',{text:'提取草稿与已确认结果'}));
  if(!(state.labResults||[]).length)labResults.append(el('p',{text:'尚无提取结果。需要可读取媒体的提取服务；不会自动生成示例内容。'}));
  for(const r of state.labResults||[]){
    const key=`vapor-lab:${r.id}`,draft=loadDraft(key);
    const text=el('textarea',{'aria-label':`Lab 内容 ${r.id}`,rows:'7'});text.value=r.confirmedContent??draft.content??r.content;text.readOnly=r.state==='confirmed';
    text.addEventListener('input',()=>sessionStorage.setItem(key,JSON.stringify({content:text.value})));
    const status=el('p',{role:'status',text:r.state==='confirmed'?'已确认 · 内容不可变':'草稿 · 未经用户确认'});
    const box=el('div',{class:'job'},el('strong',{text:r.kind}),el('p',{class:'reference',text:`来源 ${r.sourceArtifactId} / ${r.sourceRevisionId} · SHA256 ${r.sourceSha256}`}),el('p',{text:`方法：${r.method}`}),el('p',{text:`证据范围：${r.evidence}`}),el('p',{text:`局限：${r.limitations}`}),text,status);
    if(r.state==='draft')box.append(el('button',{text:'确认此内容为可引用结果',onclick:async e=>{e.target.disabled=true;try{await api('/lab/confirm',{id:r.id,content:text.value});sessionStorage.removeItem(key);await refresh();}catch(error){status.textContent=error.message;e.target.disabled=false;}}}));
    else box.append(el('button',{text:'准备创作引用',onclick:()=>{
      const message=`请读取 media_lab_get 中已确认的 Lab 结果 ${r.id}，使用 confirmedContent 规划创作；执行前核对我的制作要求。提交任务时附 labReferenceIds: ["${r.id}"]。确认提取结果不授权付费生成。`;
      if(parent!==window)parent.postMessage({channel:'media-workbench',type:'feedback-draft',sessionId,id:`lab-${r.id}`,message},location.origin);
      const copy=el('textarea',{'aria-label':'Lab 创作引用指令',readonly:''});copy.value=message;box.append(copy);status.textContent='引用已准备，尚未发送给 Agent。';
    }}));
    labResults.append(box);
  }
}
const taskDialog=el('dialog',{class:'vapor-task-dialog','aria-label':'创作任务'}),taskBody=el('div');
const taskButton=el('button',{text:'创作任务',onclick:()=>taskDialog.showModal()});
const taskEmpty=el('p',{text:'还没有创作任务。在聊天中描述你想制作或修改的内容，任务会显示在这里。'}),localTaskPanel=el('section',{'aria-label':'本地制作任务'},el('h2',{text:'本地制作'}),$('render-jobs'));taskBody.append(taskEmpty,localTaskPanel);
taskDialog.append(el('button',{text:'返回画布',onclick:()=>taskDialog.close()}),taskBody);document.body.append(taskDialog);
taskDialog.addEventListener('click',event=>{if(event.target===taskDialog){const r=taskDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)taskDialog.close();}});
const renderVlm=mountVlm({el,api,fileURL,source:$('lab-source'),container:taskBody,refresh,jobsOnly:true});
const pluginSettings=el('section',{id:'plugin-settings',hidden:''});document.querySelector('main').append(pluginSettings);
const renderToolkit=mountToolkit({el,api,fileURL,container:taskBody,pluginContainer:pluginSettings,refresh,jobsOnly:true});
if(new URL(location.href).searchParams.get('view')==='plugins'){
 document.body.dataset.view='plugins';pluginSettings.hidden=false;
 const credentials=el('section',{'aria-label':'服务密钥'}),message=el('p',{role:'status'});pluginSettings.prepend(credentials);
 async function renderCredentials(){
  try{const data=await api('/credentials');credentials.replaceChildren(el('h2',{text:'服务密钥'}),el('p',{text:'保存在本机，所有项目共用。输入新密钥可以替换已有配置。'}),message);
   for(const field of data.credentials){const input=el('input',{type:'password',autocomplete:'new-password','aria-label':field.label+'密钥',placeholder:field.configured?'已配置，输入可替换':'尚未配置'}),button=el('button',{text:'保存',onclick:async()=>{button.disabled=true;try{await api('/credentials',{ref:field.ref,value:input.value});input.value='';message.textContent='已保存';await renderCredentials();}catch(e){message.textContent=e.message;}finally{button.disabled=false;}}});button.disabled=!field.writable;
    const row=el('div',{class:'credential-row'},el('label',{},field.label,input),el('span',{text:field.configured?'已配置':'未配置'}),button);
    if(['FAL_KEY','DEEPSEEK_API_KEY','GEMINI_API_KEY','ELEVENLABS_API_KEY','VIGGLE_API_KEY','MODAL_TOKEN_SECRET'].includes(field.ref))row.append(el('button',{text:'测试连接',onclick:async event=>{event.target.disabled=true;try{const result=await api('/credentials/test',{ref:field.ref});message.textContent=result.message;}catch(e){message.textContent=e.message;}finally{event.target.disabled=false;}}}));
    credentials.append(row);}
  }catch(e){message.textContent=e.message;credentials.replaceChildren(message);}
 }
 const catalog=el('section',{'aria-label':'安装创作插件'}),query=el('input',{type:'search','aria-label':'搜索插件',placeholder:'搜索 PluginHub 插件'}),results=el('div'),hubMessage=el('p',{role:'status'});
 const search=el('button',{text:'搜索插件',onclick:async()=>{search.disabled=true;try{const data=await api('/hub/search',{query:query.value});results.replaceChildren();for(const item of data.items||[]){const name=item.packageName,version=item.latestVersion;results.append(el('article',{class:'plugin-card'},el('h3',{text:item.displayName||name}),el('p',{text:item.summary||name}),el('button',{text:'查看安装计划',onclick:async()=>{try{const plan=await api('/hub/plan',{name,version});const confirm=el('button',{text:plan.installedVersion?'确认更新':'确认安装',onclick:async()=>{confirm.disabled=true;try{await api('/hub/install',{id:plan.id,confirmed:true});hubMessage.textContent='安装准备完成，下次启动 Vapor 时生效。';cancelUpdate.hidden=false;rollback.hidden=true;}catch(e){hubMessage.textContent=e.message;}finally{confirm.disabled=false;}}});results.replaceChildren(el('h3',{text:(plan.installedVersion?'更新 ':'安装 ')+name}),el('p',{text:plan.installedVersion?'当前版本 '+plan.installedVersion+' → '+version:'尚未安装 · '+version}),el('p',{text:'安装来源：'+plan.input.installSpec}),el('p',{text:'版本 '+version+'。插件会在本机执行代码。安装先在隔离配置中校验，成功后于下次启动生效。'}),confirm,el('button',{text:'返回搜索',onclick:()=>search.click()}));}catch(e){hubMessage.textContent=e.message;}}})));}if(!results.children.length)results.append(el('p',{text:'没有找到插件'}));}catch(e){hubMessage.textContent=e.message;}finally{search.disabled=false;}}});
 const cancelUpdate=el('button',{text:'取消待应用更新',hidden:'',onclick:async()=>{cancelUpdate.disabled=true;try{await api('/hub/cancel',{confirmed:true});updateStatus.textContent='更新已取消，继续使用当前版本';cancelUpdate.hidden=true;}catch(e){updateStatus.textContent=e.message;}finally{cancelUpdate.disabled=false;}}});
 const updateStatus=el('p',{role:'status'}),rollback=el('button',{text:'恢复之前的版本',hidden:'',onclick:async()=>{rollback.disabled=true;try{await api('/hub/rollback',{confirmed:true});updateStatus.textContent='恢复已准备，下次启动生效。';cancelUpdate.hidden=false;rollback.hidden=true;}catch(e){updateStatus.textContent=e.message;}finally{rollback.disabled=false;}}});
 void api('/hub/status',{}).then(({update})=>{if(!update)return;updateStatus.textContent=({ready:'更新已准备，下次启动生效',applied:'更新已应用，可恢复之前的版本',failed:'更新未应用，继续使用当前配置；可以重新安装',rolled_back:'已恢复之前的版本',cancelled:'更新已取消，继续使用当前版本',recovery_required:'更新需要恢复'})[update.state]||'更新处理中';rollback.hidden=update.state!=='applied';cancelUpdate.hidden=update.state!=='ready';}).catch(e=>updateStatus.textContent=e.message);
 catalog.append(el('h2',{text:'安装创作插件'}),updateStatus,rollback,cancelUpdate,query,search,hubMessage,results);pluginSettings.append(catalog);
 void renderCredentials();
}

let demoCommand=null;
$('render-demo').addEventListener('click',async()=>{
  $('render-demo').disabled=true;demoCommand??=crypto.randomUUID();
  try{await api('/jobs',{commandId:demoCommand,adapterId:'vapor-remotion',artifactId:'vapor-demo-'+demoCommand.slice(0,8),title:'Vapor · 本地渲染测试',input:{heading:'Vapor — ideas in motion',body:'Local render / real progress / versioned feedback',duration:3,accent:'#c7f77b'}});demoCommand=null;await refresh();}
  catch(e){showError(e);$('render-demo').disabled=false;}
});
for(const [key,title]of Object.entries(types))$('filters').append(el('button',{text:title,'data-filter':key,onclick:()=>{filter=key;renderCards();}}));
const canvas=mountCanvas({el,api,fileURL,container:$('artifacts'),open:id=>{selection=id;revisionId=null;compareId='';renderDetail();}});
document.querySelector('.canvas-toolbar').append(taskButton);
function renderCards(){canvas.update(state.artifacts).catch(showError);}

function preview(r){
  const box=el('div',{},el('label',{text:`版本 ${r.ordinal}`}));
  if(r.mime.startsWith('image/'))box.append(el('img',{src:fileURL(r.id),alt:`版本 ${r.ordinal}`}));
  else if(/^(video|audio)\//.test(r.mime))box.append(el(r.mime.split('/')[0],{src:fileURL(r.id),controls:'',preload:'metadata'}));
  else if(r.mime==='application/pdf'||r.mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')box.append(el('a',{href:fileURL(r.id),target:'_blank',rel:'noopener',text:'打开或下载文档'}));
  else if(r.mime==='model/gltf-binary')box.append(el('p',{text:'GLB 动作文件：请下载后在兼容的 3D 工具中检查。文件结构校验不代表动作已验收。'}),el('a',{href:fileURL(r.id),download:'motion.glb',text:'下载 GLB'}));
  else{const p=el('pre',{text:'读取中…'});box.append(p);fetch(fileURL(r.id)).then(async response=>{if(!response.ok)throw new Error('文件不可用');const text=await response.text();p.textContent=text.slice(0,100000)+(text.length>100000?'\n[预览已截断]':'');}).catch(e=>p.textContent=e.message);}
  return box;
}
function loadDraft(key){try{return JSON.parse(sessionStorage.getItem(key)||'{}');}catch{return {};}}
// Keep detail interactions intact; dismiss only when attention moves outside it.
function dismissDetailOutside(event){const detail=$('detail');if(!detail.hidden&&!detail.contains(event.target))detail.hidden=true;}
document.addEventListener('pointerdown',dismissDetailOutside,{capture:true});
document.addEventListener('focusin',dismissDetailOutside);
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('detail').hidden=true;});
function renderDetail(){
  const a=state.artifacts.find(a=>a.id===selection);if(!a)return;
  const r=a.revisions.find(r=>r.id===revisionId)||a.revisions[0];revisionId=r.id;
  const detail=$('detail');detail.hidden=false;detail.replaceChildren(el('button',{text:'返回画布',onclick:()=>{detail.hidden=true;}}));
  const revisions=el('select',{'aria-label':'选择版本',onchange:e=>{revisionId=e.target.value;renderDetail();}});
  a.revisions.forEach(v=>{const o=el('option',{value:v.id,text:`v${v.ordinal}${v.id===a.current?' · 当前':''}`});o.selected=v.id===r.id;revisions.append(o);});
  const compare=el('select',{'aria-label':'对比版本',onchange:e=>{compareId=e.target.value;renderDetail();}},el('option',{value:'',text:'不对比'}));
  a.revisions.filter(v=>v.id!==r.id).forEach(v=>{const o=el('option',{value:v.id,text:`对比 v${v.ordinal}`});o.selected=v.id===compareId;compare.append(o);});
  const actions=el('details',{class:'artifact-actions'},el('summary',{text:'素材操作'}));
  const actionStatus=el('p',{role:'status',class:'note'});
  const prepare=(label,instruction)=>{const message=`${instruction}。参考作品「${a.title}」的版本 ${r.id}。先检查已启用的能力是否支持；不支持就说明。保留原素材，将新结果登记到当前项目并放回画布。需要付费时先征求我的确认。`;if(parent!==window){parent.postMessage({channel:'media-workbench',type:'feedback-draft',sessionId,id:crypto.randomUUID(),message},location.origin);actionStatus.textContent='已加入聊天草稿，可补充要求后发送。';}else{const draft=el('textarea',{'aria-label':'处理要求',readonly:''});draft.value=message;actionStatus.replaceChildren('复制到项目聊天中继续：',draft);}actions.open=false;};
  const options={image:[['分析画面','分析这张图片的内容和构图'],['提取风格','提取这张图片的色彩、光线和视觉风格'],['生成变体','基于这张图片生成变体，先和我确认变化方向和数量']],video:[['提取分镜','按时间顺序提取这段视频的分镜'],['分析动作','分析这段视频中主体的动作和镜头运动'],['提取音轨','提取这段视频的音轨并保存为独立音频']],audio:[['转录文字','转录这段音频的文字，标注时间和不确定内容'],['准备声音参考','从这段音频准备声音参考，先和我确认片段范围']],text:[['整理内容','阅读并整理这份资料的内容']]};
  for(const [label,instruction] of options[a.kind]||options.text)actions.append(el('button',{text:label,onclick:()=>prepare(label,instruction)}));
  detail.append(actionStatus);
  detail.append(actions);
  detail.append(el('div',{class:'toolbar'},el('h2',{text:a.title}),el('div',{},revisions,' ',compare)));
  const p=el('div',{class:'preview'+(compareId?' compare':'')});detail.append(p);p.append(preview(r));
  const other=a.revisions.find(v=>v.id===compareId);if(other)p.append(preview(other));
  detail.append(el('div',{class:'reference',text:`版本 ID ${r.id} · SHA256 ${r.sha256.slice(0,16)}…`}),el('p',{class:'note',text:'旧版始终保留。并排播放可分别控制，当前未启用自动时间同步。'}));
  const key=`media-feedback:${sessionId}:${r.id}`,saved=loadDraft(key);
  const comment=el('textarea',{'aria-label':'反馈内容',placeholder:'哪里需要修改？哪些部分必须保留？'});comment.value=saved.comment||'';
  const mode=el('select',{'aria-label':'反馈定位'},el('option',{value:'whole',text:'整个产物'}));
  if(/^(video|audio)\//.test(r.mime))mode.append(el('option',{value:'time',text:'时间点 / 时间范围'}));
  if(r.mime.startsWith('image/'))mode.append(el('option',{value:'region',text:'图片区域（归一化坐标）'}));
  if(r.mime.startsWith('text/')||r.mime==='application/json')mode.append(el('option',{value:'quote',text:'引用文本'}));
  mode.value=saved.mode||'whole';
  const start=el('input',{type:'number',min:'0',step:'.1','aria-label':'开始秒'}),end=el('input',{type:'number',min:'0',step:'.1','aria-label':'结束秒'});start.value=saved.start||'0';end.value=saved.end||'0';
  const times=el('div',{class:'time'},'从',start,'到',end,'秒',el('button',{type:'button',text:'取当前播放时间',onclick:()=>{const media=p.querySelector('video,audio');start.value=end.value=(media?.currentTime||0).toFixed(1);save();}}));
  const quote=el('textarea',{'aria-label':'引用原文',placeholder:'粘贴要评论的原文'});quote.value=saved.quote||'';
  const regions=['x','y','width','height'].map((name,i)=>{const input=el('input',{type:'number',min:'0',max:'1',step:'.01','aria-label':name});input.value=saved.region?.[i]??(i<2?0:1);return input;});
  const regionBox=el('div',{class:'region-fields'},...regions.map((input,i)=>el('label',{},['x','y','宽','高'][i],input)));
  function updateMode(){times.hidden=mode.value!=='time';quote.hidden=mode.value!=='quote';regionBox.hidden=mode.value!=='region';save();}
  function save(){sessionStorage.setItem(key,JSON.stringify({comment:comment.value,mode:mode.value,start:start.value,end:end.value,quote:quote.value,region:regions.map(i=>i.value)}));}
  [comment,mode,start,end,quote,...regions].forEach(n=>n.addEventListener('input',save));mode.addEventListener('change',updateMode);updateMode();
  const status=el('div',{class:'status',role:'status'}),draftText=el('textarea',{'aria-label':'可复制的 Agent 指令',readonly:''});draftText.hidden=true;
  let commandId=crypto.randomUUID(),submitted=false;
  const button=el('button',{type:'submit',class:'primary',text:'保存反馈并准备对话'});
  const form=el('form',{class:'feedback-form',onsubmit:async event=>{
    event.preventDefault();if(submitted)return;button.disabled=true;
    try{
      const locator=mode.value==='whole'?{type:'whole'}:mode.value==='time'?{type:'time',start:Number(start.value),end:Number(end.value)}:mode.value==='quote'?{type:'quote',text:quote.value}:{type:'region',...Object.fromEntries(['x','y','width','height'].map((name,i)=>[name,Number(regions[i].value)]))};
      const media=p.querySelector('video,audio');if(locator.type==='time'&&Number.isFinite(media?.duration)&&locator.end>media.duration)throw new Error('时间范围超过媒体时长');
      const result=await api('/feedback',{commandId,sessionId,artifactId:a.id,revisionId:r.id,locator,comment:comment.value});
      submitted=true;sessionStorage.removeItem(key);status.textContent='反馈已保存。尚未发送给 Agent；请在左侧检查草稿后发送。';draftText.value=result.message;draftText.hidden=false;
      feedbackList.prepend(feedbackItem(result.feedback));
      if(parent!==window)parent.postMessage({channel:'media-workbench',type:'feedback-draft',sessionId,id:result.feedback.id,message:result.message},location.origin);
      else status.textContent='反馈已保存。可复制下方内容到聊天中继续修改。';
    }catch(e){status.textContent=e.message;button.disabled=false;}
  }},el('h2',{text:'针对这个版本，留下反馈'}),el('div',{class:'field'},el('span',{text:'定位'}),mode,times,regionBox,quote),el('div',{class:'field'},el('span',{text:'修改意见'}),comment),button,status,draftText);
  const feedbackList=el('div');
  detail.append(form,el('h2',{text:'该版本的反馈'}),feedbackList);
  const feedback=state.feedback.filter(f=>f.revisionId===r.id);
  function feedbackItem(f){return el('div',{class:'feedback-item'},el('div',{class:'meta',text:`${{open:'待处理',pending:'待处理',resolved:'已处理',accepted:'已采纳'}[f.status]||'已记录'} · ${f.locator.type==='whole'?'整个作品':f.locator.type==='time'?`${f.locator.start}–${f.locator.end} 秒`:f.locator.type==='quote'?'选中的文字':'选中的画面区域'}`}),el('p',{text:f.comment}));}
  for(const f of feedback)feedbackList.append(feedbackItem(f));
}
let localJobsSignature='';
async function refresh(){try{
  const next=await api('/snapshot');if(refreshError&&$('error').textContent===refreshError)$('error').textContent='';refreshError=null;state=next;if(selection&&!state.artifacts.some(a=>a.id===selection)){selection=null;revisionId=null;$('detail').hidden=true;}$('connection').textContent='● 项目已同步';$('count').textContent=`${state.artifacts.length} 项作品 · ${state.feedback.length} 条反馈`;
  const active=(state.renderJobs||[]).some(j=>['queued','running'].includes(j.state));
  $('render-demo').disabled=active||!(state.adapters||[]).some(a=>a.id==='vapor-remotion');
  const localJobsNext=JSON.stringify(state.renderJobs||[]);
  if(localJobsSignature!==localJobsNext){localJobsSignature=localJobsNext;$('render-jobs').replaceChildren(...(state.renderJobs||[]).map(j=>{
    const box=el('div',{class:'job'},el('strong',{text:j.title}),el('div',{text:`${({queued:'等待开始',running:'制作中',completed:'已完成',failed:'未完成',cancelled:'已取消'})[j.state]||'等待处理'}${j.state==='running'&&j.progress!==null?` · ${Math.round(j.progress*100)}%（当前阶段）`:''}`}));
    if(j.progress!==null)box.append(el('progress',{max:'1',value:String(j.progress),'aria-label':'当前阶段进度'}));
    if(j.revisionId)box.append(el('button',{text:'查看作品',onclick:()=>{taskDialog.close();selection=j.artifactId;revisionId=j.revisionId;compareId='';$('detail').hidden=true;canvas.focus(j.artifactId);}}));
    if(['queued','running'].includes(j.state))box.append(el('button',{text:'取消',onclick:async()=>{try{await api('/jobs/cancel',{id:j.id});await refresh();}catch(e){showError(e);}}}));
    if(j.error)box.append(el('p',{text:j.error}));return box;
  }));}
  $('budget').textContent=state.budget?`原账本 USD：已结算＋未结算预留 $${state.budget.reserved.toFixed(2)} / $${state.budget.cap}（非账单）`:'未接入费用账本';
  $('jobs').replaceChildren(...state.jobs.map(j=>el('div',{class:'job'},el('strong',{text:j.id}),el('span',{text:` · ${j.state} · ${j.actualUSD===null?'费用未核实':'已记录费用'}`}))));
  renderAreas();
  renderLabResults();
  renderVoiceJobs();
  renderVlm(state);
  renderToolkit(state);
  localTaskPanel.hidden=!(state.renderJobs||[]).length;taskEmpty.hidden=!!((state.renderJobs||[]).length+(state.toolkit?.jobs||[]).length+(state.vlm?.jobs||[]).length);
  const pending=[...(state.toolkit?.jobs||[]),...(state.vlm?.jobs||[])].filter(j=>['awaiting_approval','recovery_required'].includes(j.state)).length;taskButton.textContent=pending?'待确认 · '+pending:'创作任务';
  if(next.seq!==seq){seq=next.seq;renderCards();}
}catch(e){$('connection').textContent='连接中断 · 稍后重试';refreshError=e.message;showError(e);}}
await refresh();setInterval(refresh,3000);
