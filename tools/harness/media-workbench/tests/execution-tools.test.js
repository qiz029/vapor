import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../execution-tools.js';

test('execution tools delegate to the shared runtime and unregister',async()=>{
  const definitions=new Map(),calls=[];let dispose;
  const runtime={registry:{list:()=>[{id:'vapor-remotion'}]},submit:args=>{calls.push(args);return {id:'job1'};},get:id=>({id}),cancel:id=>({id,state:'cancelled'})};
  apply({vaporRuntime:runtime,effect:fn=>{dispose=fn();},tools:{register:def=>{definitions.set(def.name,def);return()=>definitions.delete(def.name);}}});
  assert.equal(definitions.size,7);
  assert.equal(definitions.has('media_lab_confirm'),false);
  assert.equal((await definitions.get('media_operation_submit').execute({commandId:'generic'})).id,'job1');
  calls.length=0;
  assert.equal((await definitions.get('media_adapters_list').execute({})).adapters[0].id,'vapor-remotion');
  const args={commandId:'test'};
  assert.equal((await definitions.get('media_render_submit').execute(args)).id,'job1');
  assert.equal(calls[0],args);
  assert.equal((await definitions.get('media_job_get').execute({id:'job1'})).id,'job1');
  assert.equal((await definitions.get('media_job_cancel').execute({id:'job1'})).state,'cancelled');
  dispose();assert.equal(definitions.size,0);
});
