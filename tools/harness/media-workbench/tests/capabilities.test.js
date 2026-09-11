import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {capabilityCatalog} from '../capabilities.js';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
test('real catalog classifies all project skills and explicitly marks external dependency',{skip:!existsSync(join(repo,'.harness/capabilities.json'))},()=>{
  const c=capabilityCatalog(repo);assert.equal(c.groups.length,6);
  assert.equal(c.groups.reduce((n,g)=>n+g.skills.length,0),14);
  assert.equal(c.groups.find(g=>g.id==='vapor-reference').skills[0].external,true);
  assert.equal(c.groups.find(g=>g.id==='vapor-core').tools.length,4);
});
function fixture(groups){const root=mkdtempSync(join(tmpdir(),'vapor-cap-'));for(const path of ['.harness','.agents/skills','skills/test'])mkdirSync(join(root,path),{recursive:true});writeFileSync(join(root,'skills/test/SKILL.md'),'---\nname: test\ndescription: test\n---\n');writeFileSync(join(root,'.harness/capabilities.json'),JSON.stringify({schemaVersion:1,groups}));return root;}
const group={id:'vapor-core',skills:['skills/test'],tools:[],dependsOn:[]};
test('reject duplicate ownership, missing classification and cyclic dependencies',()=>{
  assert.throws(()=>capabilityCatalog(fixture([group,{...group,id:'vapor-review'}])),/duplicate skill/);
  assert.throws(()=>capabilityCatalog(fixture([{...group,skills:[]}])),/Unclassified/);
  assert.throws(()=>capabilityCatalog(fixture([{...group,dependsOn:['vapor-review']},{id:'vapor-review',skills:[],tools:[],dependsOn:['vapor-core']} ])),/cycle/);
});
test('missing optional external skill is explicit, required skill fails closed',()=>{
  const optional={...group,skills:['skills/test','.agents/skills/external'],externalSkills:['.agents/skills/external']};
  assert.equal(capabilityCatalog(fixture([optional])).warnings.length,1);
  assert.throws(()=>capabilityCatalog(fixture([{...optional,externalSkills:[]}])),/Missing skill/);
});
