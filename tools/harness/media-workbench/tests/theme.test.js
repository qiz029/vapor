import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('shell theme is reversible, supplies both modes, never writes preference',()=>{
  let module,style,palette,disposed=false;
  const attributes=new Map(),effects=[];
  const document={body:{getAttribute:k=>attributes.get(k)??null,setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k)},head:{append:s=>style=s},querySelector:()=>null,createElement:()=>({dataset:{},setAttribute(){},remove(){this.removed=true;}})};
  runInNewContext(readFileSync(new URL('../client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:m=>module=m}},document,MutationObserver:class{observe(){}disconnect(){}}});
  const plugin=module.factory(()=>({createElement:()=>{}}));
  plugin.apply({effect:fn=>effects.push(fn()),theme:{overrideTokens:(_id,tokens)=>{palette=tokens;return()=>disposed=true;}},sidebarRightTabs:{register:()=>()=>{}},slots:{inject:()=>()=>{},register:()=>()=>{}}});
  assert.ok(plugin.inject.includes('theme'));
  assert.ok(attributes.has('data-media-studio'));
  assert.match(style.textContent,/prefers-reduced-motion/);
  assert.match(style.textContent,/pI_x6G_frame\{box-sizing:border-box/);
  for(const [name,value] of Object.entries(palette)){assert.match(name,/^--dsw-alias-/);assert.equal(typeof value.light,'string');assert.equal(typeof value.dark,'string');}
  assert.equal(palette['--dsw-alias-brand-primary'].dark,'#c7f77b');
  effects.reverse().forEach(dispose=>dispose());
  assert.equal(disposed,true);assert.equal(style.removed,true);assert.equal(attributes.has('data-media-studio'),false);
});
