import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run the real panel render/bind lifecycle. Only transport and browser elements are fixtures.
test('live chat redraw preserves editing selection without stealing deliberately moved focus', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = { activeElement: null };
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document; });
  const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
  const transport = url(`
    export const S = { openConv: null, me: {me:{id:'me'},friends:[],limits:{body:500}, conversations:[],visiting:null},threads:new Map() };
    export const calls=[];
    export const send=(...args)=>calls.push(args);
    export const gate=()=>'', socketNote=()=>'', threadView=()=>[], cityId=()=> 'lagos', newClientId=()=> 'test-id';
    export const start=()=>{},bindCommon=()=>{},call=()=>{},perform=()=>{},sync=()=>{},openThread=()=>{},retry=()=>{},discard=()=>{};
  `);
  const { S, calls } = await import(transport);
  const source = (await readFile(new URL('./messages.js', import.meta.url), 'utf8'))
    .replace("'./social-client.js'", JSON.stringify(transport))
    .replace("'../dom.js'", JSON.stringify(new URL('../dom.js', import.meta.url).href))
    .replace("'../../game/clock.js'", JSON.stringify(new URL('../../game/clock.js', import.meta.url).href));
  const app = (await import(url(source))).default.find(panel => panel.id === 'messages');
  const conv = { id: 'dm.me.peer', with: 'peer', name: 'Peer', kind: 'dm', members: [{id:'me'}, {id:'peer'}] };
  S.me.conversations = [conv]; S.threads.set(conv.id, {loaded:true,messages:[]});
  const view = {connected:true,params:{to:'peer'},social:{notices:[]}};
  const api = {view:()=>view,refresh(){}};
  class Field {
    constructor(value) { this.value=value;this.isConnected=true;this.disabled=false;this.events={};this.selectionStart=0;this.selectionEnd=0;this.selectionDirection='none'; }
    addEventListener(type, fn) { this.events[type]=fn; }
    focus() { document.activeElement=this;this.events.focus?.(); }
    setSelectionRange(start,end,direction='none') { this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction; }
    type(value) { this.value=value;this.events.input(); }
    detach() { this.events.blur?.();this.isConnected=false;if(document.activeElement===this)document.activeElement=null; }
  }
  const mount = value => {
    const field=new Field(value), form={events:{},addEventListener(type,fn){this.events[type]=fn;}};
    app.bind({querySelector:s=>s==='[data-m-compose] input'?field:null,querySelectorAll:s=>s==='[data-m-compose]'?[form]:[]},api);
    return {field,form};
  };
  app.render({},view);
  let {field}=mount('');field.type('Please meet me by the library');field.setSelectionRange(7,11,'backward');
  app.render({},view);field.detach();({field}=mount('Please meet me by the library'));
  assert.equal(document.activeElement,field,'incoming update keeps the reply field focused');
  assert.deepEqual([field.selectionStart,field.selectionEnd,field.selectionDirection],[7,11,'backward']);
  assert.equal(field.value,'Please meet me by the library');

  const outside={};document.activeElement=outside;field.events.blur();
  app.render({},view);field.detach();({field}=mount('Please meet me by the library'));
  assert.equal(document.activeElement,outside,'a later update must not steal focus back');

  field.focus();field.setSelectionRange(4,4);app.render({},view);field.detach();
  let mounted=mount('Please meet me by the library');mounted.form.events.submit({preventDefault(){}});
  assert.equal(calls.length,1);assert.equal(calls[0][2],'Please meet me by the library');
  app.render({},view);mounted.field.detach();({field}=mount(''));
  assert.equal(field.value,'');assert.deepEqual([field.selectionStart,field.selectionEnd],[0,0],'send clears draft and selection');

  field.type('Unsent old chat draft');field.setSelectionRange(3,7);
  app.render({}, {...view,params:{to:'another',name:'Another'}});field.detach();({field}=mount(''));
  assert.deepEqual([field.selectionStart,field.selectionEnd],[0,0],'changing conversation does not restore the old selection');
});
