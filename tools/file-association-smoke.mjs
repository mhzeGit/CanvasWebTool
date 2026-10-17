/** Verify the registered command's file activation and existing-window handoff without UI input. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {connectToApp} from '../lib/client.mjs';
import {emptyDocument} from '../lib/agent-document.mjs';

const directory=await mkdtemp(join(tmpdir(),'canvas-file-activation-'));
const executable=process.argv[2]??resolve('native/Canvas/bin/Debug/net8.0/Canvas.Native.exe');
const env={...process.env,CANVASWEBTOOL_STATE_DIR:directory};
const first=join(directory,'first document.cvdoc'),second=join(directory,'second document.CVDOC');
await writeFile(first,JSON.stringify(emptyDocument()));await writeFile(second,JSON.stringify(emptyDocument()));
const child=spawn(executable,['--background','--test-mode','--open',first],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});
let errorText='';child.stderr.on('data',b=>errorText+=b);let client;
try{
  let endpoint;
  for(let i=0;i<100;i++){try{endpoint=JSON.parse(await readFile(join(directory,'endpoint.json'),'utf8'));break;}catch{}if(child.exitCode!==null)throw new Error(errorText);await new Promise(r=>setTimeout(r,100));}
  assert.ok(endpoint,'Primary native instance ready');
  client=await connectToApp(endpoint);assert.equal((await client.request('agent.read')).file,first);
  const launch=spawn(executable,['--open',second],{env,windowsHide:true,stdio:'ignore'});
  const code=await new Promise((done,reject)=>{launch.once('error',reject);launch.once('close',done);});assert.equal(code,0);
  for(let i=0;i<50;i++){if((await client.request('agent.read')).file===second)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal((await client.request('agent.read')).file,second);
  assert.equal(JSON.parse(await readFile(join(directory,'endpoint.json'),'utf8')).pid,child.pid);
  console.log('PASS: file argument opens the document; second launch reuses the existing native process; spaces and uppercase extension work.');
}finally{
  if(client){try{await client.request('quit',{force:true});}catch{}client.close();}
  if(child.exitCode===null)await new Promise(done=>{const timer=setTimeout(()=>{child.kill();done();},1500);child.once('close',()=>{clearTimeout(timer);done();});});
  await rm(directory,{recursive:true,force:true});
}
