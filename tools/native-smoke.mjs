/** Live native smoke tests via the existing CLI transport; captures shared fixture screenshots. */
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readEndpoint } from '../shared/endpoint.mjs';
import { connectToApp } from '../lib/client.mjs';
const out=resolve('artifacts');await mkdir(out,{recursive:true});
const endpoint=await readEndpoint();assert.equal(endpoint?.runtime,'Avalonia 11.2.7','native endpoint');
const client=await connectToApp(endpoint);let checks=0;
const check=(label,condition)=>{assert.ok(condition,label);console.log('PASS:',label);checks++;};
try{
  // Preserve any manual exploration of this test instance before replacing it with fixtures.
  await writeFile(resolve(out,'native-session-before.json'),JSON.stringify(await client.request('read'),null,2));
  await client.request('new',{force:true});await client.request('set-tool',{tool:'cursor'});
  await client.request('resize-window',{width:1200,height:720});
  await client.request('screenshot',{path:resolve(out,'native-empty.png')});
  await client.request('open',{path:resolve(out,'fixture.cvdoc'),force:true});
  let doc=await client.request('read');check('fixture has all entity types',Object.values(doc.entities).every(a=>a.length>0));
  await client.request('screenshot',{path:resolve(out,'native-scene.png')});
  await client.request('set-theme',{theme:'light'});await client.request('screenshot',{path:resolve(out,'native-light.png')});await client.request('set-theme',{theme:'dark'});
  await client.request('select',{ids:['shp-1']});await client.request('screenshot',{path:resolve(out,'native-properties.png')});
  const box=await client.request('add',{type:'textBox',props:{title:'Native smoke',content:'**Bold** and _italic_',position:{x:100,y:250},size:{w:240,h:140}}});check('live creation returns portable id',/^tb-/.test(box.id));
  const changed=await client.request('update',{id:box.id,props:{title:'Updated',style:{backgroundColor:'#213a2b'}}});check('property update reported',changed.changed.includes('title'));
  await client.request('undo');check('live undo restores title',(await client.request('get',{id:box.id})).title==='Native smoke');await client.request('redo');check('live redo restores title',(await client.request('get',{id:box.id})).title==='Updated');
  const curve=await client.request('connect',{from:'tb-1',to:box.id,kind:'connection',label:'native'});check('live Bézier created',curve.from==='tb-1'&&curve.to===box.id);
  const saved=resolve(out,'native-smoke.cvdoc');await client.request('save',{path:saved});await client.request('open',{path:saved,force:true});doc=await client.request('read');check('curves survive native file save/open',doc.entities.connections.length===2);
  await client.request('delete',{id:'tb-1'});check('deletion removes dependent curves',(await client.request('read')).entities.connections.length===0);await client.request('undo');check('undo restores curves',(await client.request('read')).entities.connections.length===2);
  try{await client.request('update',{id:box.id,props:{size:{w:-1}}});assert.fail('invalid update accepted');}catch(e){check('invalid update rejected',e.code==='EINVAL');}
  const png=await readFile(resolve('favicon.png'));const portable=await client.request('read');portable.entities.shapes[0].image={src:'data:image/png;base64,'+png.toString('base64'),fileName:'favicon.png',x:10,y:10,w:100,h:100,keepRatio:true};
  await client.request('import',{document:portable,force:true});await client.request('save',{path:resolve(out,'native-images.cvdoc')});await client.request('open',{path:resolve(out,'native-images.cvdoc'),force:true});check('native image persisted',(await client.request('read')).entities.shapes[0].image.src.startsWith('data:'));
  await client.request('open',{path:resolve(out,'fixture.cvdoc'),force:true});await client.request('select',{ids:[]});
  await writeFile(resolve(out,'native-smoke-results.json'),JSON.stringify({checks,passed:true},null,2));console.log(`Native live checks passed: ${checks}`);
}finally{client.close();}
