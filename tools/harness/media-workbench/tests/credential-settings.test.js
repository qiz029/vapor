import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CredentialSettings} from '../credential-settings.js';
test('credential settings expose metadata and restrict execution to the owning pack',async()=>{
 const values=new Map(),service={describe:async ref=>({configured:values.has(ref),writable:true}),set:async(ref,value)=>values.set(ref,value),resolve:async ref=>values.has(ref)?{value:values.get(ref)}:undefined};
 const settings=new CredentialSettings(service);
 await settings.save({ref:'FAL_KEY',value:'test-secret'});
 assert(!(JSON.stringify(await settings.list())).includes('test-secret'));
 assert.deepEqual(await settings.environment('vapor-generation-fal'),{FAL_KEY:'test-secret'});
 assert.deepEqual(await settings.environment('vapor-editing'),{});
 await assert.rejects(settings.save({ref:'PATH',value:'bad'}));
 await assert.rejects(settings.save({ref:'FAL_KEY',value:''}));
});
test('connection test is read-only and never exposes provider response or credential',async()=>{
 const service={resolve:async()=>({value:'private-test-key'})};let request;
 const settings=new CredentialSettings(service,{request:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({data:[{id:'model'}],secret:'private-test-key'})};}});
 const result=await settings.test({ref:'DEEPSEEK_API_KEY'});assert.equal(result.ok,true);assert.equal(result.modelCount,1);assert(!JSON.stringify(result).includes('private-test-key'));assert.equal(request.url,'https://api.deepseek.com/models');assert.equal(request.options.redirect,'error');assert.equal(request.options.body,undefined);
 await assert.rejects(settings.test({ref:'PATH'}));
 const failure=new CredentialSettings(service,{request:async()=>{throw Error('private-test-key');}});assert(!JSON.stringify(await failure.test({ref:'DEEPSEEK_API_KEY'})).includes('private-test-key'));
});
test('provider probes use correct header and discard account details',async()=>{
 const cases=[['FAL_KEY','Authorization',{models:[]}],['GEMINI_API_KEY','x-goog-api-key',{models:[{name:'example'}]}],['ELEVENLABS_API_KEY','xi-api-key',{user_id:'private-user',subscription:{character_limit:999}}],['VIGGLE_API_KEY','Authorization',{balance:123}]];
 for(const [ref,header,payload]of cases){let observed;const settings=new CredentialSettings({resolve:async()=>({value:'secret-value'})},{request:async(url,options)=>{observed={url,options};return {ok:true,json:async()=>payload};}});const result=await settings.test({ref});assert.equal(result.ok,true);assert.equal(Object.keys(observed.options.headers)[0],header);assert.equal(observed.options.headers[header],(ref==='FAL_KEY'?'Key ':ref==='VIGGLE_API_KEY'?'Bearer ':'')+'secret-value');assert(!observed.url.includes('secret-value'));assert.deepEqual(result,{ok:true,message:'连接成功，认证有效'});}
});
test('Modal diagnostic requires both credentials and uses read-only CLI without leaking app metadata',async()=>{
 const values={MODAL_TOKEN_ID:'fake-id',MODAL_TOKEN_SECRET:'fake-secret'};let calls=0;
 const settings=new CredentialSettings({resolve:async ref=>values[ref]?{value:values[ref]}:undefined},{run:async(file,args,options)=>{calls++;assert.deepEqual(args,['-m','modal','app','list','--json']);assert.equal(options.env.MODAL_TOKEN_SECRET,'fake-secret');assert(!args.join(' ').includes('fake-secret'));assert.equal(options.timeout,15000);return {stdout:JSON.stringify([{description:'private-app'}])};}});
 assert.deepEqual(await settings.test({ref:'MODAL_TOKEN_SECRET'}),{ok:true,message:'连接成功，认证有效'});delete values.MODAL_TOKEN_ID;assert.equal((await settings.test({ref:'MODAL_TOKEN_SECRET'})).ok,false);assert.equal(calls,1);
 values.MODAL_TOKEN_ID='fake-id';settings.run=async()=>{throw Error('fake-secret private-app');};const result=await settings.test({ref:'MODAL_TOKEN_ID'});assert.equal(result.ok,false);assert(!JSON.stringify(result).includes('fake-secret'));
});
