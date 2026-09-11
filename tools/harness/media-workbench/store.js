/** Local immutable artifact registry. No provider calls or budget writes. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, extname, join, isAbsolute } from 'node:path';

export const MIME = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm','.wav':'audio/wav','.mp3':'audio/mpeg','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.json':'application/json'};
Object.assign(MIME,{'.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.srt':'text/plain; charset=utf-8','.vtt':'text/plain; charset=utf-8','.aiff':'audio/aiff','.flac':'audio/flac','.m4a':'audio/mp4','.mov':'video/quicktime','.glb':'model/gltf-binary'});
const hash = data => createHash('sha256').update(data).digest('hex');
export function assert(value, message) { if (!value) throw new Error(message); }
export function within(root, path) {
  const r = relative(realpathSync(root), realpathSync(path));
  assert(r !== '..' && !r.startsWith('../') && !isAbsolute(r), 'Path outside project');
  return realpathSync(path);
}
function nonempty(s, max=200) { return typeof s === 'string' && s.trim().length > 0 && s.length <= max; }
export function validateLocator(locator) {
  assert(locator && typeof locator === 'object', 'Locator required');
  if (locator.type === 'whole') { assert(Object.keys(locator).length === 1, 'Invalid whole locator'); return; }
  if (locator.type === 'time') {
    assert(Object.keys(locator).every(k => ['type','start','end'].includes(k)), 'Invalid time fields');
    assert(Number.isFinite(locator.start) && Number.isFinite(locator.end) && locator.start >= 0 && locator.end >= locator.start, 'Invalid time range'); return;
  }
  if (locator.type === 'quote') { assert(Object.keys(locator).every(k=>['type','text'].includes(k)) && nonempty(locator.text,4000), 'Invalid quote'); return; }
  if (locator.type === 'region') {
    assert(Object.keys(locator).every(k=>['type','x','y','width','height'].includes(k)), 'Invalid region fields');
    const {x,y,width,height} = locator;
    assert([x,y,width,height].every(Number.isFinite) && x>=0 && y>=0 && width>0 && height>0 && x+width<=1 && y+height<=1, 'Invalid image region'); return;
  }
  throw new Error('Unsupported locator');
}

export class Store {
  constructor(projectRoot) {
    this.root = realpathSync(projectRoot);
    this.dir = join(this.root,'workbench');
    mkdirSync(this.dir,{recursive:true,mode:0o700});
    within(this.root,this.dir);
    this.db = new DatabaseSync(join(this.dir,'state.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    assert(version <= 1,'Unsupported database version');
    this.db.exec(`CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,title TEXT NOT NULL,kind TEXT NOT NULL,current TEXT);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,artifact TEXT NOT NULL,ordinal INTEGER NOT NULL,path TEXT NOT NULL,sha256 TEXT NOT NULL,mime TEXT NOT NULL,source TEXT NOT NULL,created TEXT NOT NULL, UNIQUE(artifact,ordinal));
      CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,command TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vapor_deleted(artifact TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS vapor_items(artifact TEXT PRIMARY KEY,category TEXT NOT NULL,group_name TEXT NOT NULL DEFAULT "",pinned INTEGER NOT NULL DEFAULT 0,manual INTEGER NOT NULL DEFAULT 0);
      PRAGMA user_version=1;`);
  }
  close() { this.db.close(); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const v=fn(); this.db.exec('COMMIT'); return v; } catch(e) {this.db.exec('ROLLBACK'); throw e;} }
  event(type,payload) { this.db.prepare('INSERT INTO events(type,payload) VALUES(?,?)').run(type,JSON.stringify(payload)); }
  register({id,title,path,expectedRevision}) {
    assert(typeof id==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id),'Invalid artifact id');
    assert(nonempty(title),'Invalid title');
    assert(typeof path==='string' && !isAbsolute(path),'Use project-relative path');
    const source = within(this.root,resolve(this.root,path));
    const ext=extname(source).toLowerCase(), mime=MIME[ext];
    assert(mime,'Unsupported media format');
    assert(statSync(source).isFile() && statSync(source).size <= 512*1024*1024,'File too large or not a file');
    const bytes=readFileSync(source), digest=hash(bytes);
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(id);
      if(expectedRevision !== undefined) assert((old?.current ?? null)===expectedRevision,'Revision conflict');
      const current=old && this.db.prepare('SELECT * FROM revisions WHERE id=?').get(old.current);
      if(current?.sha256===digest) return current;
      const rid=randomUUID(), ordinal=(this.db.prepare('SELECT MAX(ordinal) n FROM revisions WHERE artifact=?').get(id).n || 0)+1;
      const dir=join(this.dir,'artifacts',id,rid); mkdirSync(dir,{recursive:true,mode:0o700}); within(this.root,dir);
      const file=join(dir,'media'+ext); writeFileSync(file,bytes,{flag:'wx',mode:0o600,flush:true});
      const record={id:rid,artifact:id,ordinal,path:relative(this.root,file),sha256:digest,mime,source:path,created:new Date().toISOString()};
      this.db.prepare('INSERT INTO revisions VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(record));
      const kind=mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'text';
      const displayTitle=old&&this.db.prepare('SELECT manual FROM vapor_items WHERE artifact=?').get(id)?.manual?old.title:title;
      this.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,current=excluded.current').run(id,displayTitle,kind,rid);
      this.event('artifact.revision_created',{artifactId:id,revisionId:rid}); return record;
    });
  }
  revision(id) {const r=this.db.prepare('SELECT * FROM revisions WHERE id=?').get(id); assert(r,'Unknown revision'); return r;}
  file(id) {const r=this.revision(id); return {...r,absolute:within(this.root,join(this.root,r.path))};}
  addFeedback({commandId,sessionId,artifactId,revisionId,locator,comment}) {
    assert(nonempty(commandId,100)&&nonempty(sessionId,150),'Missing command/session id');
    assert(nonempty(comment,8000),'Feedback required'); validateLocator(locator);
    const rev=this.revision(revisionId); assert(rev.artifact===artifactId,'Artifact revision mismatch');
    assert(locator.type!=='time'||/^(video|audio)\//.test(rev.mime),'Time requires audio/video');
    assert(locator.type!=='region'||rev.mime.startsWith('image/'),'Region requires image');
    assert(locator.type!=='quote'||rev.mime.startsWith('text/')||rev.mime==='application/json','Quote requires text');
    const payload={sessionId,artifactId,revisionId,locator,comment:comment.trim(),status:'open'};
    return this.transaction(()=>{
      const existing=this.db.prepare('SELECT * FROM feedback WHERE command=?').get(commandId);
      if(existing) {assert(existing.payload===JSON.stringify(payload),'Command id reused with different feedback'); return {id:existing.id,...JSON.parse(existing.payload),created:existing.created};}
      const id=randomUUID(),created=new Date().toISOString();
      this.db.prepare('INSERT INTO feedback VALUES(?,?,?,?)').run(id,commandId,JSON.stringify(payload),created);
      this.event('feedback.created',{id,...payload}); return {id,...payload,created};
    });
  }
  snapshot() {
    const artifacts=this.db.prepare('SELECT * FROM artifacts WHERE id NOT IN (SELECT artifact FROM vapor_deleted) ORDER BY rowid').all().map(a=>({...a,...(this.db.prepare('SELECT category,group_name AS groupName,pinned,manual FROM vapor_items WHERE artifact=?').get(a.id)??{category:'outputs',groupName:'',pinned:0,manual:0}),revisions:this.db.prepare('SELECT * FROM revisions WHERE artifact=? ORDER BY ordinal DESC').all(a.id)}));
    const feedback=this.db.prepare('SELECT * FROM feedback ORDER BY rowid DESC').all().map(f=>({id:f.id,...JSON.parse(f.payload),created:f.created}));
    return {schemaVersion:1,seq:this.db.prepare('SELECT COALESCE(MAX(seq),0) seq FROM events').get().seq,artifacts,feedback};
  }
  /** Read-only old ledger projection; no inferred refunds, progress or approvals. */
  jobs() {
    const file=join(this.root,'generation','ledger.json');
    if(!existsSync(file)) return {jobs:[],budget:null};
    const ledger=JSON.parse(readFileSync(within(this.root,file),'utf8'));
    return {budget:{currency:'USD',cap:ledger.budgetUSD,reserved:Object.values(ledger.jobs||{}).reduce((n,j)=>n+(j.actualUSD??j.reservedUSD??0),0)},jobs:Object.entries(ledger.jobs||{}).map(([id,j])=>({id,state:j.state,estimatedUSD:j.estimatedUSD,reservedUSD:j.reservedUSD,actualUSD:j.actualUSD??null,progress:null,progressSource:'unknown'}))};
  }
}

export function feedbackMessage(f) {
  return `请处理媒体产物反馈，不要自动启动付费生成。先读取指定版本并提出局部修复方案。\n\n${JSON.stringify({feedbackId:f.id,artifactId:f.artifactId,revisionId:f.revisionId,locator:f.locator,comment:f.comment},null,2)}`;
}
