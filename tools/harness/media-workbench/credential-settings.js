import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
/** Configuration UI never receives resolved credential values. */
export const credentialFields=[
 {ref:'DEEPSEEK_API_KEY',label:'DeepSeek',packs:[]},
 {ref:'FAL_KEY',label:'fal · 视频与音乐',packs:['vapor-generation-fal','vapor-music']},
 {ref:'VIGGLE_API_KEY',label:'Viggle · 动作处理',packs:['vapor-motion-viggle']},
 {ref:'GEMINI_API_KEY',label:'Gemini · 媒体审阅',packs:['vapor-review-gemini']},
 {ref:'ELEVENLABS_API_KEY',label:'ElevenLabs · 转写',packs:['vapor-captions']},
 {ref:'MODAL_TOKEN_ID',label:'Modal Token ID',packs:['vapor-gpu-modal','vapor-vlm-modal']},
 {ref:'MODAL_TOKEN_SECRET',label:'Modal Token Secret',packs:['vapor-gpu-modal','vapor-vlm-modal']},
];
export class CredentialSettings{
 constructor(service,{request=fetch,run=execute}={}){this.service=service;this.request=request;this.run=run;}
 async list(){return Promise.all(credentialFields.map(async f=>({...f,...await this.service.describe(f.ref)})));}
 async save({ref,value}){if(!credentialFields.some(f=>f.ref===ref))throw Error('未知凭据');if(typeof value!=='string'||!value.trim()||value.length>8192)throw Error('请输入有效密钥');await this.service.set(ref,value.trim());return {saved:true};}
 async test({ref}){
  if(['MODAL_TOKEN_ID','MODAL_TOKEN_SECRET'].includes(ref))return this.testModal();
  const probes={
   FAL_KEY:{url:'https://api.fal.ai/v1/models?limit=1',header:'Authorization',prefix:'Key ',valid:d=>Array.isArray(d.models)},
   DEEPSEEK_API_KEY:{url:'https://api.deepseek.com/models',header:'Authorization',prefix:'Bearer ',valid:d=>Array.isArray(d.data)},
   GEMINI_API_KEY:{url:'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',header:'x-goog-api-key',prefix:'',valid:d=>Array.isArray(d.models)},
   VIGGLE_API_KEY:{url:'https://apis.viggle.ai/v1/credits',header:'Authorization',prefix:'Bearer ',valid:d=>typeof d.balance==='number'},
   ELEVENLABS_API_KEY:{url:'https://api.elevenlabs.io/v1/user',header:'xi-api-key',prefix:'',valid:d=>typeof d.user_id==='string'},
  };
  const probe=probes[ref];if(!probe)throw Error('此服务的连接测试尚未接入');
  const value=await this.service.resolve(ref);if(!value)return {ok:false,message:'请先保存密钥'};
  try{
   const response=await this.request(probe.url,{headers:{[probe.header]:probe.prefix+value.value},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok){await response.body?.cancel();return {ok:false,message:[401,403].includes(response.status)?'认证失败，请检查密钥':'服务暂不可用，请稍后重试'};}
   const data=await response.json();if(!probe.valid(data))return {ok:false,message:'服务响应格式异常'};
   return {ok:true,message:'连接成功，认证有效',...(ref==='DEEPSEEK_API_KEY'?{modelCount:data.data.length}:{})};
  }catch{return {ok:false,message:'无法连接服务，请检查网络后重试'};}
 }
 async testModal(){
  const env=await this.environment('vapor-vlm-modal');
  if(!env.MODAL_TOKEN_ID||!env.MODAL_TOKEN_SECRET)return {ok:false,message:'请先保存 Modal Token ID 和 Token Secret'};
  try{
   const {stdout}=await this.run(process.env.VAPOR_VLM_PYTHON||'python3',['-m','modal','app','list','--json'],{env:{...process.env,...env},timeout:15000,maxBuffer:1024*1024,encoding:'utf8'});
   if(!Array.isArray(JSON.parse(stdout)))return {ok:false,message:'Modal 响应格式异常'};
   return {ok:true,message:'连接成功，认证有效'};
  }catch{return {ok:false,message:'Modal 连接失败，请检查密钥、网络和本机 Modal SDK'};}
 }
 async environment(pack){const env={};for(const f of credentialFields.filter(f=>f.packs.includes(pack))){const v=await this.service.resolve(f.ref);if(v)env[f.ref]=v.value;}return env;}
}
