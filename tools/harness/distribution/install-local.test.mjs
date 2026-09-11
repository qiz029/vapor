import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const installer=fileURLToPath(new URL('./install-local.mjs',import.meta.url));
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'vapor-install-test-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bin=join(root,'bin'),candidate=join(root,'candidate'),home=join(root,'home');
 mkdirSync(bin);mkdirSync(candidate);
 const script=body=>`#!${process.execPath}\n${body}\n`;
 writeFileSync(join(bin,'pnpm'),script('console.log("10.15.1")'),{mode:0o755});
 writeFileSync(join(bin,'dsh'),script(`
 const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
 if(args.includes('--version')){console.log('0.1.5-rc.1');process.exit(0);}
 const home=process.env.DSH_HOME,dir=path.join(home,'profiles','web');
 if(args.includes('--dump-config')){
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({dsh:{profile:{bundles:[]}}}));
  fs.writeFileSync(path.join(dir,'pnpm-workspace.yaml'),'packages: []\\n');
 }else fs.appendFileSync(path.join(home,'calls.jsonl'),JSON.stringify(args)+'\\n');
 `),{mode:0o755});
 function pack(bytes){
  writeFileSync(join(candidate,'same-version.tgz'),bytes);
  writeFileSync(join(candidate,'release-candidate.json'),JSON.stringify({version:'0.3.0',runtime:{version:'0.1.5-rc.1'},profile:{bundles:['@test/plugin']},packages:[{name:'@test/plugin',tarball:'same-version.tgz',sha256:createHash('sha256').update(bytes).digest('hex')}]}));
 }
 const run=()=>spawnSync(process.execPath,[installer,candidate,home],{encoding:'utf8',env:{...process.env,PATH:bin}});
 const calls=()=>readFileSync(join(home,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 return {home,candidate,pack,run,calls};
}
test('same version and source filename with changed bytes produces distinct install references',t=>{
 const f=fixture(t);f.pack('first candidate');assert.equal(f.run().status,0);
 const first=f.calls()[0].at(-1);
 f.pack('second candidate');assert.equal(f.run().status,0);
 const second=f.calls()[1].at(-1);
 assert.notEqual(first,second);
 assert.equal(readFileSync(first,'utf8'),'first candidate');
 assert.equal(readFileSync(second,'utf8'),'second candidate');
 assert.equal(f.run().status,0);
 assert.equal(f.calls()[2].at(-1),second);
});
test('tampered candidate is rejected before creating a profile',t=>{
 const f=fixture(t);f.pack('expected');
 writeFileSync(join(f.candidate,'same-version.tgz'),'tampered');
 const result=f.run();assert.notEqual(result.status,0);
 assert.match(result.stderr,/Candidate checksum mismatch/);
 assert.equal(existsSync(f.home),false);
});
test('corrupt cached archive is rejected before invoking installation or changing profile',t=>{
 const f=fixture(t);f.pack('original');assert.equal(f.run().status,0);
 const manifest=join(f.home,'profiles/web/package.json');
 const before=readFileSync(manifest,'utf8');
 writeFileSync(f.calls()[0].at(-1),'corrupt');
 const result=f.run();assert.notEqual(result.status,0);
 assert.match(result.stderr,/Candidate cache checksum mismatch/);
 assert.equal(f.calls().length,1);
 assert.equal(readFileSync(manifest,'utf8'),before);
});
