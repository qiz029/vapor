/** Installed tool packs: typed dispatch, durable receipts, user-only remote authorization. */
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,lstatSync,statSync,accessSync,constants} from 'node:fs';
import {resolve,join,relative,dirname,extname,delimiter} from 'node:path';
import {assert,within,MIME} from './store.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const closedStates=['completed','failed','interrupted','cancelled'];
const fileKeys=new Set(['path','source','src','audio','video','image','endImage','reference','input','project','animaticGate','alignment','manifest','timeline','picture','expected','textFile']);
export function validateInput(fields,required,input){
 assert(input&&typeof input==='object'&&!Array.isArray(input),'Expected input object');
 for(const k of Object.keys(input))assert(Object.hasOwn(fields,k),'Unknown input '+k);
 for(const k of required)assert(input[k]!==undefined,'Missing input '+k);
 function check(s,v,k){
  assert(s.type==='integer'?Number.isSafeInteger(v):s.type==='array'?Array.isArray(v):typeof v===s.type,'Invalid '+k);
  if(typeof v==='number')assert(Number.isFinite(v)&&(s.minimum===undefined||v>=s.minimum)&&(s.maximum===undefined||v<=s.maximum),'Out of range '+k);
  if(typeof v==='string')assert(v.length>=(s.minLength??0)&&v.length<=(s.maxLength??8000)&&!v.includes('\0')&&(!s.pattern||new RegExp(s.pattern).test(v)),'Invalid '+k);
  if(s.enum)assert(s.enum.includes(v),'Unsupported '+k);
  if(Array.isArray(v)){assert(v.length>=(s.minItems??0)&&v.length<=(s.maxItems??100),'Invalid array '+k);v.forEach(x=>check(s.items,x,k));}
 }
 for(const [k,v]of Object.entries(input))check(fields[k],v,k);
 return structuredClone(input);
}
function schema(o){return {type:'object',additionalProperties:false,required:o.required,properties:Object.fromEntries(Object.entries(o.fields).map(([key,value])=>{const {flag,path,repeat,...s}=value;return [key,{...s,...(path?{description:'Existing project-relative file path; use imported project assets. Absolute paths and secrets are rejected.'}:{})}];}))};}
export function runProcess(executable,args,{cwd,env,signal,timeout=1800000}={}){
 return new Promise((ok,no)=>{
  const child=spawn(executable,args,{cwd,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let stdout='',stderr='',force;
  const stop=()=>{try{process.platform==='win32'?child.kill():process.kill(-child.pid,'SIGTERM');}catch{}force??=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},3000);force.unref();};
  const timer=setTimeout(stop,timeout);signal?.addEventListener('abort',stop,{once:true});
  child.stdout.on('data',b=>{stdout=(stdout+b).slice(-4*1024*1024);});child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16000);});
  const clean=()=>{clearTimeout(timer);clearTimeout(force);signal?.removeEventListener('abort',stop);};
  child.on('error',e=>{clean();no(e);});child.on('close',code=>{clean();code===0?ok({stdout,stderr}):no(Object.assign(new Error('Tool exited '+code),{stderr}));});
 });
}
export class Toolkit{
 packs=new Map();operations=new Map();active=null;closed=false;dependencyCache=new Map();
 constructor(runtime,{runner=runProcess}={}){
  this.runtime=runtime;this.store=runtime.store;this.root=runtime.root;this.runner=runner;
  this.store.db.exec('CREATE TABLE IF NOT EXISTS vapor_tool_jobs(id TEXT PRIMARY KEY,command TEXT UNIQUE NOT NULL,payload TEXT NOT NULL)');
  this.store.db.exec('CREATE TABLE IF NOT EXISTS vapor_plugin_settings(name TEXT PRIMARY KEY,enabled INTEGER NOT NULL)');
  this.store.db.exec('CREATE TABLE IF NOT EXISTS vapor_tool_documents(command TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL)');
  for(const j of this.jobs())if(['running','preparing'].includes(j.state))this.save({...j,state:j.remote?'recovery_required':'interrupted',error:'Previous process stopped; inspect receipt. No automatic replay.'});
 }
 registerPack(name,root,definitions,config={}){
  assert(!this.packs.has(name),'Duplicate tool pack');
  for(const o of definitions)assert(!this.operations.has(o.id)&&/^[a-z][a-z0-9.-]+$/.test(o.id),'Duplicate/invalid tool operation');
  this.packs.set(name,{root,config});for(const o of definitions)this.operations.set(o.id,{...o,pack:name,root,config});
  return()=>{for(const o of definitions)this.operations.delete(o.id);this.packs.delete(name);};
 }
 enabled(name){return this.store.db.prepare('SELECT enabled FROM vapor_plugin_settings WHERE name=?').get(name)?.enabled!==0;}
 requireEnabled(name){assert(this.enabled(name),'插件已停用，请先在插件管理中启用：'+name);}
 setEnabled({name,enabled}){assert(this.packs.has(name),'Unknown installed plugin');assert(typeof enabled==='boolean','Expected enabled boolean');this.store.db.prepare('INSERT INTO vapor_plugin_settings VALUES(?,?) ON CONFLICT(name) DO UPDATE SET enabled=excluded.enabled').run(name,enabled?1:0);return this.plugins();}
 dependencyChecks(name,p){const found=command=>{const candidates=command.includes('/')?[command]:(process.env.PATH||'').split(delimiter).map(d=>join(d,command));return candidates.some(file=>{try{accessSync(file,constants.X_OK);return statSync(file).isFile();}catch{return false;}});};const python=p.config.python||(name==='vapor-vlm-modal'?process.env.VAPOR_VLM_PYTHON:process.env.VAPOR_TOOLS_PYTHON)||'python3';const checks=[{name:'Python 可执行文件',available:found(python)}];if(['vapor-vlm-modal','vapor-gpu-modal'].includes(name)){const key=python,previous=this.dependencyCache.get(key);let modules=previous?.modules;if(!previous||Date.now()-previous.at>60000){modules={};if(checks[0].available){const result=spawnSync(python,['-c','import importlib.util,json; print(json.dumps({m:importlib.util.find_spec(m) is not None for m in ["modal","PIL"]}))'],{encoding:'utf8',timeout:1500,maxBuffer:65536});try{if(result.status===0)modules=JSON.parse(result.stdout);}catch{}}this.dependencyCache.set(key,{at:Date.now(),modules});}checks.push({name:'Modal SDK',available:modules.modal===true});if(name==='vapor-vlm-modal')checks.push({name:'Pillow 图片处理',available:modules.PIL===true});}if(['vapor-audio','vapor-editing','vapor-captions','vapor-review','vapor-voice-local','vapor-remotion','vapor-regression'].includes(name))for(const cmd of ['ffmpeg','ffprobe'])checks.push({name:cmd,available:found(cmd)});if(['vapor-remotion','vapor-regression'].includes(name))checks.push({name:'Chrome / Chromium',available:[process.env.REMOTION_BROWSER_EXECUTABLE,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','chromium','google-chrome'].filter(Boolean).some(found)});if(name==='vapor-voice-local')checks.push({name:'macOS',available:process.platform==='darwin'});return checks;}
 plugins(){return [...this.packs].map(([name,p])=>{const operations=[...this.operations.values()].filter(o=>o.pack===name);return {name,enabled:this.enabled(name),operations:operations.map(o=>({id:o.id,description:o.description})),remote:operations.some(o=>o.remote)||name==='vapor-vlm-modal',requirements:name==='vapor-vlm-modal'?['Python / Modal 环境','Modal 配置（调用时验证）']:['Python 环境',...(['vapor-remotion','vapor-regression'].includes(name)?['Node.js / Chrome']:[]),...(['vapor-audio','vapor-editing','vapor-captions','vapor-review','vapor-voice-local','vapor-remotion','vapor-regression'].includes(name)?['FFmpeg / ffprobe']:[])],checks:this.dependencyChecks(name,p),resources:existsSync(p.root)?'present':'missing',configuration:'执行时验证环境与服务商配置'};});}
 list(){return [...this.operations.values()].filter(o=>this.enabled(o.pack)).map(o=>({id:o.id,plugin:o.pack,description:o.description,inputSchema:schema(o),remote:o.remote||false,provider:o.provider??null,authority:o.remote||o.authority==='user'?'user-approval':'agent',recovery:o.recovery??[],review:'Execution does not establish visual, listening or playback acceptance.'}));}
 jobs(){return this.store.db.prepare('SELECT payload FROM vapor_tool_jobs ORDER BY rowid DESC').all().map(r=>JSON.parse(r.payload));}
 get(id){const row=this.store.db.prepare('SELECT payload FROM vapor_tool_jobs WHERE id=?').get(id);assert(row,'Unknown tool job');return JSON.parse(row.payload);}
 save(j){j.updated=new Date().toISOString();this.store.db.prepare('UPDATE vapor_tool_jobs SET payload=? WHERE id=?').run(JSON.stringify(j),j.id);return j;}
 snapshot(){return {operations:this.list(),plugins:this.plugins(),jobs:this.jobs(),busy:!!this.active};}
 writeDocument({commandId,name,content}){
  assert(!this.closed,'Runtime closing');assert(typeof commandId==='string'&&/^[\w-]{1,100}$/.test(commandId),'Invalid document command ID');
  assert(typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,90}\.(json|txt|md|srt|vtt)$/.test(name),'Use a new document filename, not a path or executable');
  assert(typeof content==='string'&&content.trim()&&Buffer.byteLength(content)<=200000,'Document must contain 1–200000 bytes');if(name.endsWith('.json'))JSON.parse(content);
  const fingerprint=hash(JSON.stringify({name,content})),old=this.store.db.prepare('SELECT * FROM vapor_tool_documents WHERE command=?').get(commandId);
  if(old){assert(old.fingerprint===fingerprint,'Document command reused with different content');return JSON.parse(old.payload);}
  const dir=join(this.root,'inputs');mkdirSync(dir,{recursive:true});within(this.root,dir);const file=join(dir,name);
  if(existsSync(file))assert(readFileSync(within(this.root,file),'utf8')===content,'Document exists; use a new filename for a revision');else writeFileSync(file,content,{flag:'wx',mode:0o600,flush:true});
  const revision=this.store.register({id:'document-'+hash(name).slice(0,20),title:name,path:relative(this.root,file)});
  const result={path:relative(this.root,file),revisionId:revision.id,sha256:revision.sha256,execution:'not-executed'};
  this.store.db.prepare('INSERT INTO vapor_tool_documents VALUES(?,?,?)').run(commandId,fingerprint,JSON.stringify(result));return result;
 }
 help({operation,document}){const o=this.operations.get(operation);assert(o,'Unknown operation');const files=[];const walk=dir=>{if(!existsSync(dir))return;for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(md|json)$/.test(e.name))files.push(relative(o.root,p));}};walk(join(o.root,'docs'));walk(join(o.root,'examples'));if(document){assert(files.includes(document),'Choose a listed document');const file=within(o.root,join(o.root,document));assert(statSync(file).size<=200000,'Document too large');return {operation,document,content:readFileSync(file,'utf8')};}return {operation,inputSchema:schema(o),documents:files,note:'Use the matching project, EDL, audio or renderer manifest contract. Import files into your project; paths are project-relative. Experimental plans do not establish provider support.'};}
 inputFile(name){assert(typeof name==='string'&&!name.startsWith('/')&&!name.split(/[\\/]/).some(s=>s==='..'||s.startsWith('.')),'Use project-relative nonsecret input files');const file=within(this.root,join(this.root,name));assert(statSync(file).isFile(),'Expected input file');assert(!/(?:^|\/)(?:models|voices)\//.test(name),'Use the voice plugin for private model/profile access');return file;}
 bindings(o,input){
  const result={},seen=new Set();
  const visit=(file,mutable=false,expand=true)=>{
   file=within(this.root,file);assert(statSync(file).isFile(),'Missing input');
   assert(!relative(this.root,file).split('/').some(s=>s.startsWith('.')),'Secret/hidden inputs are not tool media');
   if(seen.has(file))return;seen.add(file);assert(seen.size<=500,'Too many input dependencies');
   result[relative(this.root,file)]={sha256:hash(readFileSync(file)),bytes:statSync(file).size,mutable};
   if(extname(file)!=='.json'||!expand)return;
   const doc=JSON.parse(readFileSync(file,'utf8'));const base=dirname(file);
   if(Array.isArray(doc.assets)&&doc.project&&typeof doc.project==='object'){
    // Registered manifests are immutable historical artifacts. Their original relative
    // paths are not rebased when copied by workflow.register; hash them, do not execute them.
    for(const asset of doc.assets)visit(resolve(base,asset.path),false,false);
    return;
   }
   const walk=(v,key='')=>{
    if(typeof v==='string'&&fileKeys.has(key)&&v&&!v.startsWith('asset:')){
     // Descriptive fields named source/input are allowed only when they do not look like file references.
     const looksPath=/\.(?:json|wav|mp3|mp4|webm|png|jpe?g|webp|srt|txt|md|aiff)$/i.test(v)||v.startsWith('/')||v.startsWith('../');
     if(looksPath){assert(!/^[a-z]+:\/\//i.test(v),'Remote media URLs must not bypass explicit uploads');const p=resolve(o.provider==='fal-video'&&['image','endImage'].includes(key)?this.root:base,v);visit(p,key==='project');}
    }else if(key==='media'&&v&&typeof v==='object'&&!Array.isArray(v)){for(const path of Object.values(v))visit(resolve(base,path));}
    else if(Array.isArray(v))for(const item of v){if(key==='images'&&typeof item==='string')visit(resolve(this.root,item));else walk(item,key);}
    else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){
     // Project assets and cost rows use source for provenance text, not a file reference.
     if(k==='source'&&((v.producer&&Object.hasOwn(v,'sha256'))||v.category&&v.provider))continue;
     if(k==='project'&&v.currency==='USD')continue;
     walk(x,k);
    }
   };walk(doc);
  };
  for(const [key,value]of Object.entries(input))if(o.fields[key].path)visit(this.inputFile(value),key==='project');
  if(o.id==='voice.speak'){const dir=join(this.root,'voices',input.name);for(const file of ['profile.json','reference.wav','reference.txt'])visit(join(dir,file));}
  return result;
 }
 verify(j,resume=false){for(const [path,b]of Object.entries(j.inputs)){if(resume&&b.mutable)continue;assert(hash(readFileSync(this.inputFileForBinding(path)))===b.sha256,'Input changed: '+path);}}
 inputFileForBinding(path){return within(this.root,join(this.root,path));}
 prepare({commandId,operation,input}){
  assert(!this.closed&&!this.active,'Tools busy or closing');assert(typeof commandId==='string'&&/^[\w-]{1,100}$/.test(commandId),'Invalid command ID');
  const o=this.operations.get(operation);assert(o,'Install the requested tool plugin');this.requireEnabled(o.pack);input=validateInput(o.fields,o.required,input);
  const requestHash=hash(JSON.stringify({operation,input}));const old=this.jobs().find(j=>j.commandId===commandId);if(old){assert(old.requestHash===requestHash,'Command ID reused with other inputs');return old;}
  const inputs=this.bindings(o,input),fingerprint=hash(JSON.stringify({operation,input,inputs,script:hash(readFileSync(join(o.root,o.script)))}));
  if(o.remote)assert(!this.jobs().some(j=>j.fingerprint===fingerprint&&!['failed','cancelled'].includes(j.state)),'Equivalent remote request exists; use its original job');
  const id='tool-'+randomUUID(),dir=join(this.store.dir,'tools',id);mkdirSync(dir,{recursive:true});within(this.root,dir);
  const j={id,commandId,operation,plugin:o.pack,input,inputs,fingerprint,requestHash,remote:o.remote||false,state:o.remote||o.authority==='user'?'awaiting_approval':'prepared',created:new Date().toISOString(),directory:relative(this.root,dir),outputs:[],review:'pending',cloudSubmitted:false};
  if(o.remote==='ledger'){
   const plan=JSON.parse(readFileSync(this.inputFile(input.plan)));j.plan=plan;
   j.ledgerIds=(plan.jobs??[{id:plan.id}]).map(x=>x.id);assert(j.ledgerIds.length&&j.ledgerIds.every(x=>typeof x==='string'&&/^[\w-]+$/.test(x)),'Invalid provider job IDs');
   j.budgetUSD=plan.budgetUSD;const ledger=join(this.root,'generation','ledger.json');
   if(existsSync(ledger)){const l=JSON.parse(readFileSync(within(this.root,ledger)));assert(l.budgetUSD===plan.budgetUSD,'Use the fixed project budget');assert(!j.ledgerIds.some(id=>l.jobs[id]),'Provider ID already exists; recover the original job');}
   for(const other of this.jobs())if(other.ledgerIds&&!(['failed','cancelled'].includes(other.state)&&other.cloudSubmitted===false))assert(!other.ledgerIds.some(id=>j.ledgerIds.includes(id)),'Provider ID belongs to an existing job');
  }
  writeFileSync(join(dir,'request.json'),JSON.stringify(j,null,2),{flag:'wx',flush:true});
  this.store.db.prepare('INSERT INTO vapor_tool_jobs VALUES(?,?,?)').run(id,commandId,JSON.stringify(j));return j;
 }
 command(o,j,{dry=false,resume=false,action='run',recovery={}}={}){
  dry=dry||o.dryOnly;
  const dir=join(this.root,j.directory),out=o.output?.ledger?join(this.root,'generation'):join(dir,o.output?.name??'output');
  let args=[...o.args];if(dry&&o.dryReplace)args=[...o.dryArgs];
  if(o.mv){args=[this.inputFile(j.input.manifest),out,j.input.mode??'render',String(j.input.frame??0),join(o.root,'tools/video/remotion/src',(o.mv==='lyric-driven-mv'?'lyric-driven-mv':'music-video')+'.tsx'),o.mv];}
  else{
   for(const k of o.positional??[])args.push(String(j.input[k]));
   for(const [k,v]of Object.entries(j.input)){const s=o.fields[k];if(!s.flag)continue;const value=s.path?this.inputFile(v):v;if(s.type==='boolean'){if(v)args.push(s.flag);}else if(Array.isArray(value)){if(s.repeat)for(const item of value)args.push(s.flag,String(item));else args.push(s.flag,...value.map(String));}else args.push(s.flag,String(value));}
   if(o.output?.flag){let target=out;if(o.id==='image.import')target=join(dir,'image'+extname(j.input.source));args.push(o.output.flag,target);}
   if(dry&&!o.dryReplace)args.push(...(o.dryArgs??[]));
   if(!dry&&!resume)args.push(...(o.approvalArgs??[]));
   if(o.budgetArgs&&!dry)args.push('--estimated-usd',String(j.authorization.reservedUSD),'--budget-usd',String(j.authorization.budgetUSD));
   if(o.provider==='fal-video'||o.provider==='gemini')args.push('--root',this.root);
  }
  return {executable:o.engine==='node'?process.execPath:(o.config.python||process.env.VAPOR_TOOLS_PYTHON||'python3'),args:o.engine==='node'?['--import','tsx',join(o.root,o.script),...args]:[join(o.root,o.script),...args],out};
 }
 run({id}){const j=this.get(id),o=this.operations.get(j.operation);assert(o&&!o.remote&&o.authority!=='user','This operation requires user approval');assert(j.state==='prepared','Job is not prepared');return this.start(j,o);}
 approve({id,fingerprint,confirmed,authorizationNote,budgetUSD,estimatedUSD,reservedUSD,pricingSource,priceValidThrough}){
  const j=this.get(id),o=this.operations.get(j.operation);assert(o&&j.state==='awaiting_approval','Job is not awaiting approval');assert(confirmed===true&&fingerprint===j.fingerprint,'Confirm the exact request fingerprint');assert(typeof authorizationNote==='string'&&authorizationNote.trim(),'Authorization note required');this.verify(j);
  if(o.remote&&o.remote!=='download'){
   assert([budgetUSD,estimatedUSD,reservedUSD].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0)&&estimatedUSD<=reservedUSD&&reservedUSD<=budgetUSD,'Require estimate <= reserve <= project budget');
   assert(pricingSource?.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(priceValidThrough)&&priceValidThrough>=new Date().toISOString().slice(0,10),'Current pricing evidence required');
   if(j.budgetUSD)assert(j.budgetUSD===budgetUSD,'Approval must match plan budget');
  }
  j.authorization={authorizationNote,budgetUSD,estimatedUSD,reservedUSD,pricingSource,priceValidThrough,at:new Date().toISOString()};
  return this.start(j,o);
 }
 start(j,o,{resume=false,collectOnly=false}={}){
  if(!resume&&!collectOnly)this.requireEnabled(o.pack);
  assert(!this.closed&&!this.active&&!this.runtime.active.size,'Tools busy or closing');if(!collectOnly)this.verify(j,resume);
  const controller=new AbortController();j.state='running';this.save(j);
  const task={controller,promise:null};this.active=task;
  task.promise=(async()=>{try{
   const cmd=collectOnly?{executable:'',args:[],out:join(this.root,j.directory)}:this.command(o,j,{resume});
   const env={...process.env,...await this.credentialEnvironment?.(o.pack),VAPOR_PLUGIN_MODE:'1',VAPOR_PROJECT_ROOT:this.root,VAPOR_ALLOW_PAID:resume||!o.remote?'0':'1',VAPOR_NODE:process.execPath,HF_HUB_DISABLE_IMPLICIT_TOKEN:'1'};
   if(!o.remote)Object.assign(env,{HF_HUB_OFFLINE:'1'});
   if(o.engine!=='node')env.PATH=dirname(cmd.executable)+':'+env.PATH;
   const driver=join(o.root,'tools/harness/plugin_driver.py');
   const invocation={...cmd,root:this.root,job:j,operation:o.id,remote:o.remote||false,resume,provider:o.provider};
   const spec=join(this.root,j.directory,'invocation.json');writeFileSync(spec,JSON.stringify(invocation),{flush:true});
   const cachedStdout=join(this.root,j.directory,'stdout.txt');
   const python=o.config.python||process.env.VAPOR_TOOLS_PYTHON||'python3',voiceSandbox=o.pack==='vapor-voice-local'&&!o.remote;
   if(voiceSandbox)assert(process.platform==='darwin','Local voice plugin requires macOS');
   const result=collectOnly?{stdout:existsSync(cachedStdout)?readFileSync(cachedStdout,'utf8'):''}:await this.runner(voiceSandbox?'/usr/bin/sandbox-exec':python,voiceSandbox?['-p','(version 1) (allow default) (deny network*)',python,driver,spec]:[driver,spec],{cwd:o.root,env,signal:controller.signal,timeout:o.timeout??1800000});
   writeFileSync(join(this.root,j.directory,'stdout.txt'),result.stdout||'');
   if(controller.signal.aborted)throw new Error('Interrupted');
   const receipt=JSON.parse(readFileSync(join(this.root,j.directory,'receipt.json')));j.state=receipt.state;j.cloudSubmitted=receipt.cloudSubmitted;j.receipt=receipt;
   if(collectOnly){assert(receipt.state==='completed'&&receipt.integrity,'Complete verified receipt required');for(const [path,digest]of Object.entries(receipt.integrity))assert(hash(readFileSync(within(this.root,join(this.root,path))))===digest,'Cached output changed');}
   const outputFiles=[];
   const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const file=join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())walk(file);else if(MIME[extname(file)]&&!['invocation.json','request.json','stdout.txt','receipt.json'].includes(e.name))outputFiles.push(file);}};walk(join(this.root,j.directory));
   for(const path of receipt.artifacts??[])if(existsSync(path)&&MIME[extname(path)])outputFiles.push(within(this.root,path));
   // Preserve a readable receipt even when a command returns only stdout or mutates a project contract.
   const report=join(this.root,j.directory,'result-report.json');writeFileSync(report,JSON.stringify({operation:j.operation,input:j.input,inputs:j.inputs,receipt,stdout:result.stdout,review:'pending'},null,2));outputFiles.push(report);
   for(const file of new Set(outputFiles)){const path=relative(this.root,file),digest=hash(readFileSync(file));if(j.outputs.some(r=>r.sha256===digest&&r.path===path))continue;const r=this.store.register({id:j.id+'-'+hash(path).slice(0,12),title:(j.operation+' · '+relative(join(this.root,j.directory),file)).slice(0,200),path});j.outputs.push({revisionId:r.id,path,sha256:digest});}
   this.save(j);
  }catch(error){j.state=o.remote?'recovery_required':controller.signal.aborted?'interrupted':'failed';j.error=o.remote?'Remote execution did not finish locally. Inspect the original receipt/ledger; do not resubmit.':String(error.message)+(error.stderr?' '+error.stderr.slice(-1500):'');
   const receiptFile=join(this.root,j.directory,'receipt.json');if(o.remote&&existsSync(receiptFile)){try{const receipt=JSON.parse(readFileSync(receiptFile));if(receipt.state==='failed_before_submission'&&receipt.cloudSubmitted===false){j.state='failed';j.cloudSubmitted=false;j.error=receipt.error;j.receipt=receipt;}}catch{}}
   this.save(j);}finally{this.active=null;}})();
  return j;
 }
 resume({id}){const j=this.get(id),o=this.operations.get(j.operation);assert(o,'Original plugin required');const file=join(this.root,j.directory,'receipt.json');if(existsSync(file)&&JSON.parse(readFileSync(file)).state==='completed'&&['interrupted','recovery_required'].includes(j.state))return this.start(j,o,{resume:true,collectOnly:true});assert(['ledger','viggle','download'].includes(o.remote)&&['submitted','recovery_required'].includes(j.state),'Only original provider jobs can resume');assert(j.authorization,'No approved submission to resume');return this.start(j,o,{resume:true});}
 async recover({id,action,callId,requestFile,providerJobId,evidence,actualUSD,state}){
  assert(!this.active,'Tools busy');const j=this.get(id),o=this.operations.get(j.operation);assert(o?.remote&&j.authorization,'Approved remote job required');assert(['status','reconcile','settle','mark-terminal'].includes(action),'Unknown recovery action');
  if(action!=='status')assert(typeof evidence==='string'&&evidence.trim(),'Recovery evidence required');
  if(action==='settle')assert(typeof actualUSD==='number'&&Number.isFinite(actualUSD)&&actualUSD>=0,'Explicit actual charge required');
  const credentialEnv=await this.credentialEnvironment?.(o.pack);assert(!this.active,'Tools busy');
  const file=requestFile?this.inputFile(requestFile):null;
  const spec=join(this.root,j.directory,'recovery.json');writeFileSync(spec,JSON.stringify({root:this.root,job:j,action,callId,requestFile:file,providerJobId,evidence,actualUSD,state}));
  const controller=new AbortController(),pending=this.runner(o.config.python||process.env.VAPOR_TOOLS_PYTHON||'python3',[join(o.root,'tools/harness/plugin_driver.py'),spec,'recover'],{cwd:o.root,env:{...process.env,...credentialEnv,VAPOR_PLUGIN_MODE:'1'},signal:controller.signal,timeout:10000});
  this.active={controller,promise:pending.catch(()=>{})};
  try{await pending;j.recovery=JSON.parse(readFileSync(join(this.root,j.directory,'recovery-result.json')));return this.save(j);}finally{this.active=null;}
 }
 cancel({id}){const j=this.get(id);if(['prepared','awaiting_approval'].includes(j.state)&&j.cloudSubmitted===false){j.state='cancelled';return this.save(j);}assert(!j.remote,'Cancel remotely with provider, then record terminal evidence');if(this.active&&j.state==='running')this.active.controller.abort();else if(j.state==='prepared'){j.state='cancelled';this.save(j);}return j;}
 userAction(action,args){if(action==='plugin-toggle')return this.setEnabled(args);if(action==='document')return this.writeDocument(args);if(action==='prepare')return this.prepare(args);if(action==='run')return this.run(args);if(action==='approve')return this.approve(args);if(action==='resume')return this.resume(args);if(action==='recover')return this.recover(args);if(action==='cancel')return this.cancel(args);throw new Error('Unknown toolkit action');}
 registerTools(tools){const defs=[
  {name:'media_document_write',description:'Create a new project input document (JSON, text, Markdown or subtitles) under inputs/. Read media_tool_help first for manifest contracts. Never overwrites different content, executes code or approves a plan. For media references inside this document, use paths relative to inputs/ that remain within the project.',parameters:{type:'object',required:['commandId','name','content'],additionalProperties:false,properties:{commandId:{type:'string'},name:{type:'string'},content:{type:'string'}}},run:a=>this.writeDocument(a)},
  {name:'media_tool_help',description:'Read packaged manifest contracts and examples for a specific tool. List documents first, then read one by its listed path.',parameters:{type:'object',required:['operation'],properties:{operation:{type:'string'},document:{type:'string'}},additionalProperties:false},run:a=>this.help(a)},
  {name:'media_tools_list',description:'Discover installed Vapor tool operations, exact schemas, requirements and approval boundaries.',parameters:{type:'object',properties:{},additionalProperties:false},run:()=>this.snapshot()},
  {name:'media_tool_prepare',description:'Prepare a typed operation using project-relative files. No cloud submission. Remote or acceptance operations require user UI approval of this exact request.',parameters:{type:'object',required:['commandId','operation','input'],properties:{commandId:{type:'string'},operation:{type:'string'},input:{type:'object'}},additionalProperties:false},run:a=>this.prepare(a)},
  ...[['run','Execute a prepared local operation after user intent. Remote operations and acceptance gates cannot use this tool.'],['get','Read original durable status and registered outputs.'],['resume','Collect an originally approved provider job; never authorizes a new submission.']].map(([name,description])=>({name:'media_tool_'+name,description,parameters:{type:'object',required:['id'],properties:{id:{type:'string'}},additionalProperties:false},run:a=>name==='get'?this.get(a.id):this[name](a)}))
 ];const disposers=defs.map(d=>tools.register({name:d.name,description:d.description,parameters:d.parameters,execute:async a=>d.run(a),output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]}}));return()=>disposers.forEach(d=>d());}
 async close(){this.closed=true;if(this.active){this.active.controller.abort();await this.active.promise;}}
}
