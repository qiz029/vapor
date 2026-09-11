import {assert} from './store.js';
/** Project-local spatial metadata. Media and revisions remain owned by Store. */
export class Canvas {
  constructor(store){this.store=store;this.db=store.db;this.db.exec('CREATE TABLE IF NOT EXISTS vapor_canvas (id TEXT PRIMARY KEY, data TEXT NOT NULL)');}
  snapshot(){const ids=new Set(this.store.snapshot().artifacts.map(a=>a.id));return this.db.prepare('SELECT data FROM vapor_canvas').all().map(r=>JSON.parse(r.data)).filter(n=>n.kind==='frame'||ids.has(n.id));}
  update({items},manual=true){
    assert(Array.isArray(items)&&items.length<=500,'画布修改过大');
    const artifacts=new Set(this.store.snapshot().artifacts.map(a=>a.id));
    const existing=new Map(this.snapshot().map(n=>[n.id,n]));
    const clean=items.map(i=>{
      assert(manual||!existing.has(i.id),'用户或画布已安放此对象，请保留现有布局');
      assert(i&&typeof i.id==='string'&&i.id.length<=200,'无效画布对象');
      assert(i.kind==='frame'||artifacts.has(i.id),'作品不属于这个项目');
      assert(i.kind!=='frame'||i.id.startsWith('frame-'),'无效分组');
      for(const key of ['x','y','w','h'])assert(Number.isFinite(i[key])&&Math.abs(i[key])<=100000,'无效画布位置');
      assert(i.w>=100&&i.h>=80,'画布对象过小');
      assert(typeof i.title==='string'&&i.title.length<=100,'分组名称过长');
      return {id:i.id,kind:i.kind==='frame'?'frame':'artifact',x:i.x,y:i.y,w:i.w,h:i.h,title:i.title};
    });
    this.db.exec('BEGIN IMMEDIATE');try{for(const i of clean)this.db.prepare('INSERT INTO vapor_canvas VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(i.id,JSON.stringify(i));this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return this.snapshot();
  }
}
