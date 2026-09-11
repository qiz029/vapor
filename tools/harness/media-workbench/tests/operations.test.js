import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Registry,operations} from '../runtime.js';
test('all declared operation seams register without enabling paid/network execution',()=>{
  const registry=new Registry();
  for(const [i,operation]of operations.entries()){
    const adapter={id:`adapter-${i}`,operation,contractVersion:1,permissions:{network:false,paid:false},validate:x=>x,execute:async()=>{}};
    const dispose=registry.register(adapter);
    assert.equal(registry.get(adapter.id).operation,operation);
    dispose();assert.throws(()=>registry.get(adapter.id),/unavailable/);
    assert.throws(()=>registry.register({...adapter,permissions:{network:true,paid:false}}),/local unpaid/);
  }
});
