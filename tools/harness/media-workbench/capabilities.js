/** Read-only capability inventory, shared by preflight and the Agent. */
import {readFileSync,realpathSync,existsSync,readdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function capabilityCatalog(workspaceRoot){
  const root=realpathSync(workspaceRoot);
  const manifest=JSON.parse(readFileSync(join(root,'.harness/capabilities.json'),'utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.groups))throw new Error('Unsupported capability manifest');
  const ids=new Set(),owned=new Set(),names=new Set(),warnings=[];
  const groups=manifest.groups.map(group=>{
    if(!/^vapor-[a-z]+$/.test(group.id)||ids.has(group.id))throw new Error('Invalid or duplicate group');ids.add(group.id);
    if(!Array.isArray(group.skills)||!Array.isArray(group.tools)||!Array.isArray(group.dependsOn))throw new Error('Invalid group fields');
    const skills=group.skills.map(path=>{
      if(isAbsolute(path)||path.split('/').includes('..')||owned.has(path))throw new Error('Invalid or duplicate skill path');owned.add(path);
      const file=resolve(root,path,'SKILL.md'),external=(group.externalSkills||[]).includes(path);
      if(!existsSync(file)){
        if(!external)throw new Error('Missing skill: '+path);
        warnings.push('Optional external skill unavailable: '+path);return {path,available:false,external:true};
      }
      const actual=realpathSync(file),rel=relative(root,actual);
      if((rel.startsWith('..')||isAbsolute(rel))&&!external)throw new Error('Undeclared external skill: '+path);
      const source=readFileSync(actual,'utf8');
      const front=source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const name=front?.[1].match(/^name:\s*([^\r\n]+)$/m)?.[1].trim();
      if(!name||names.has(name)||!/^description:/m.test(front[1]))throw new Error('Invalid or duplicate skill metadata: '+path);names.add(name);
      return {name,path,available:true,external};
    });
    return {...group,skills};
  });
  for(const group of groups)for(const dep of group.dependsOn)if(!ids.has(dep)||dep===group.id)throw new Error('Invalid dependency: '+dep);
  const visiting=new Set(),visited=new Set();
  function visit(id){if(visiting.has(id))throw new Error('Capability dependency cycle');if(visited.has(id))return;visiting.add(id);groups.find(g=>g.id===id).dependsOn.forEach(visit);visiting.delete(id);visited.add(id);}
  groups.forEach(g=>visit(g.id));
  // Existing flat skill discovery stays intact, but newly added skills must be classified.
  for(const dir of ['skills','.agents/skills'])for(const item of readdirSync(join(root,dir),{withFileTypes:true})){
    const path=dir+'/'+item.name;
    if(existsSync(join(root,path,'SKILL.md'))&&!owned.has(path))throw new Error('Unclassified skill: '+path);
  }
  return {schemaVersion:1,preset:manifest.preset,groups,warnings,skillCount:groups.reduce((n,g)=>n+g.skills.filter(s=>s.available).length,0),note:'Logical capability groups, not independently installed plugins. Skills do not grant tool access or spending approval.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(capabilityCatalog(process.argv[2]||process.cwd()),null,2));
