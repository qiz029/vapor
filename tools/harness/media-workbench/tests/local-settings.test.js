import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localSettings} from '../local-settings.js';
test('daily settings reuse saved home and project and never persist credentials or transient overrides',t=>{
 const root=mkdtempSync(join(tmpdir(),'vapor-settings-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'.harness'),{recursive:true});mkdirSync(join(root,'project'));const file=join(root,'.harness/local-settings.json');const original=JSON.stringify({schemaVersion:1,dshHome:'/Users/example/vapor-home',profile:'web',project:'project',port:3090});writeFileSync(file,original);
 const first=localSettings(root);assert.equal(first.home,'/Users/example/vapor-home');assert.equal(localSettings(root).project,first.project);assert.equal(localSettings(root,{port:3095}).port,3095);assert.equal(readFileSync(file,'utf8'),original);assert.throws(()=>localSettings(root,{port:0}),/port/);
 writeFileSync(file,JSON.stringify({...JSON.parse(original),dshHome:'/tmp/test-home'}));assert.throws(()=>localSettings(root),/temporary/);
});
