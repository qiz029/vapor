import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../store.js';
import {apply} from '../agent-tools.js';

test('preset exposes only scoped read tools and disposes registrations',async()=>{
  const root=mkdtempSync(join(tmpdir(),'media-tools-test-'));
  writeFileSync(join(root,'plan.md'),'Test only');
  const store=new Store(root),r=store.register({id:'plan',title:'Plan',path:'plan.md'});
  store.addFeedback({commandId:'tool1',sessionId:'test',artifactId:'plan',revisionId:r.id,locator:{type:'whole'},comment:'Test feedback'});store.close();
  const definitions=new Map();let dispose;
  const runtimeStore=new Store(root);
  apply({vaporRuntime:{store:runtimeStore},effect(fn){dispose=fn();},tools:{register(def){definitions.set(def.name,def);return()=>definitions.delete(def.name);}}},{projectRoot:root});
  try {
    assert.deepEqual([...definitions.keys()],['media_project_get','media_artifact_get','media_feedback_list','media_capabilities_get']);
    const project=await definitions.get('media_project_get').execute({});assert.equal(project.artifacts.length,1);
    const item=await definitions.get('media_artifact_get').execute({revisionId:r.id});assert.equal(item.sha256,r.sha256);
    await assert.rejects(()=>definitions.get('media_artifact_get').execute({revisionId:'unknown'}),/Unknown/);
    const feedback=await definitions.get('media_feedback_list').execute({});assert.equal(feedback.feedback[0].revisionId,r.id);
    assert.equal(JSON.parse(definitions.get('media_project_get').output.render({},project)[0].text).schemaVersion,1);
  } finally {dispose();runtimeStore.close();}
  assert.equal(definitions.size,0);
});
