import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {Runtime} from '../runtime.js';
import {createAdapter} from '../../vapor-voice-local/index.js';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'vapor-voice-test-')),runtime=new Runtime(root);
 const data=Buffer.alloc(44+24000*4*2);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(24000,24);data.writeUInt32LE(48000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(data.length-44,40);for(let n=0;n<96000;n++)data.writeInt16LE(Math.round(3000*Math.sin(n*2*Math.PI*440/24000)),44+n*2);
 writeFileSync(join(root,'synthetic-tone.wav'),data);
 const source=runtime.store.register({id:'tone',title:'Synthetic test tone, not speech',path:'synthetic-tone.wav'});
 return {runtime,input:{sourceRevisionId:source.id,start:0,duration:3,separation:'none',sourceNote:'Generated sine tone for technical test only; not a voice'}};
}
test('voice adapter validates bounded source references and rejects paths',async()=>{
 const {runtime,input}=fixture();try{const a=createAdapter(repo,runtime.store);assert.deepEqual(a.validate(input),input);for(const change of [{duration:31},{start:-1},{sourceRevisionId:'missing'},{path:'/etc/passwd'},{separation:'auto'}])assert.throws(()=>a.validate({...input,...change}));}finally{await runtime.close();}
});
test('voice profile requires explicit review; retries preserve immutable reference',async()=>{
 const {runtime,input}=fixture();try{
 runtime.registry.register({...createAdapter(repo,runtime.store),execute:async({jobDir})=>{const path=join(jobDir,'mock.wav');writeFileSync(path,'mock, not playable');return {path,technical:{sourceSha256:runtime.store.revision(input.sourceRevisionId).sha256,signal:{duration_seconds:3}}};}});
 const j=runtime.submit({commandId:'voice-test',adapterId:'vapor-voice-local',artifactId:'reference',title:'Test reference',input});await runtime.idle();
 const args={jobId:j.id,transcript:'Test fixture only',authorizationNote:'Synthetic test fixture',listened:true};
 assert.throws(()=>runtime.saveVoiceProfile({...args,listened:false}),/Listen/);
 const r=runtime.saveVoiceProfile(args);assert.equal(runtime.saveVoiceProfile(args).id,r.id);
 assert.throws(()=>runtime.saveVoiceProfile({...args,transcript:'changed'}),/different/);
 assert.equal(runtime.store.revision(r.id).mime,'application/json');
 }finally{await runtime.close();}
});
test('actual macOS offline reference preparation', {skip:process.env.VAPOR_VOICE_INTEGRATION!=='1'},async()=>{
 const {runtime,input}=fixture();try{
 runtime.registry.register(createAdapter(repo,runtime.store));
 if(process.env.VAPOR_VOICE_DEMUCS==='1')input.separation='demucs';
 const j=runtime.submit({commandId:'real-preparation',adapterId:'vapor-voice-local',artifactId:'reference',title:'Synthetic tone smoke test',input});await runtime.idle();
 const result=runtime.get(j.id);assert.equal(result.state,'completed',result.error);assert.equal(result.technical.signal.sample_rate,24000);assert.equal(result.assets.length,input.separation==='demucs'?3:1);assert.equal(result.review,'pending');
 console.log('Voice integration output:',runtime.store.file(result.revisionId).absolute);
 }finally{await runtime.close();}
});
