/** Durable Lab proposals. Confirmation is a user UI action, never an agent tool. */
import {randomUUID} from 'node:crypto';
import {assert} from './store.js';
const kinds={image_prompt:'image/',video_prompt:'video/',motion_description:'video/',voice_description:'audio/'};
const bounded=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
export class Lab {
  constructor(store){this.store=store;store.db.exec('CREATE TABLE IF NOT EXISTS lab_results(id TEXT PRIMARY KEY, command TEXT UNIQUE NOT NULL, request TEXT NOT NULL, payload TEXT NOT NULL)');}
  list(){return this.store.db.prepare('SELECT payload FROM lab_results ORDER BY rowid DESC').all().map(r=>JSON.parse(r.payload));}
  get(id){const row=this.store.db.prepare('SELECT payload FROM lab_results WHERE id=?').get(id);assert(row,'Unknown Lab result');return JSON.parse(row.payload);}
  propose(args){
    const {commandId,sourceRevisionId,kind,content,method,evidence,limitations}=args;
    assert(bounded(commandId,100)&&Object.hasOwn(kinds,kind),'Invalid Lab command/kind');
    assert(bounded(content,8000)&&bounded(method,300)&&bounded(evidence,2000)&&bounded(limitations,2000),'Content, method, evidence and limitations required');
    const source=this.store.revision(sourceRevisionId);
    assert(source.mime.startsWith(kinds[kind])||(kind==='voice_description'&&source.mime.startsWith('video/')),'Source type mismatch');
    const request=JSON.stringify({sourceRevisionId,kind,content,method,evidence,limitations});
    return this.store.transaction(()=>{
      const old=this.store.db.prepare('SELECT request,payload FROM lab_results WHERE command=?').get(commandId);
      if(old){assert(old.request===request,'Command reused with different Lab inputs');return JSON.parse(old.payload);}
      const result={id:randomUUID(),sourceRevisionId,sourceArtifactId:source.artifact,sourceSha256:source.sha256,kind,content,method,evidence,limitations,state:'draft',created:new Date().toISOString()};
      this.store.db.prepare('INSERT INTO lab_results VALUES(?,?,?,?)').run(result.id,commandId,request,JSON.stringify(result));
      this.store.event('lab.proposed',{id:result.id,sourceRevisionId});return result;
    });
  }
  confirm({id,content}){
    assert(bounded(content,8000),'Confirmed content required');
    return this.store.transaction(()=>{
      const result=this.get(id);
      if(result.state==='confirmed'){assert(result.confirmedContent===content,'Confirmed result is immutable; submit a new proposal');return result;}
      const next={...result,state:'confirmed',confirmedContent:content,confirmedAt:new Date().toISOString()};
      this.store.db.prepare('UPDATE lab_results SET payload=? WHERE id=?').run(JSON.stringify(next),id);
      this.store.event('lab.confirmed',{id});return next;
    });
  }
  references(ids=[]){
    assert(Array.isArray(ids)&&ids.length<=8&&new Set(ids).size===ids.length,'Invalid Lab references');
    return ids.map(id=>{const r=this.get(id);assert(r.state==='confirmed','Lab result must be confirmed by user');return r;});
  }
}
