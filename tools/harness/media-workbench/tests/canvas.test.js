import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';
import {Canvas} from '../canvas.js';
test('canvas persists separately from revisions and rejects cross-project or invalid batches',()=>{
 const root=mkdtempSync(join(tmpdir(),'vapor-canvas-'));let s=new Store(root);
 try{writeFileSync(join(root,'a.txt'),'original');s.register({id:'a',title:'A',path:'a.txt'});const c=new Canvas(s),item={id:'a',kind:'artifact',title:'A',x:50,y:-20,w:300,h:200};c.update({items:[item]});assert.throws(()=>c.update({items:[{...item,x:100},{...item,id:'foreign'}]}));assert.equal(c.snapshot()[0].x,50);assert.throws(()=>c.update({items:[{...item,x:Infinity}]}));s.close();s=new Store(root);assert.deepEqual(new Canvas(s).snapshot(),[item]);assert.equal(s.snapshot().artifacts[0].revisions.length,1);}finally{s.close();rmSync(root,{recursive:true,force:true});}
});
