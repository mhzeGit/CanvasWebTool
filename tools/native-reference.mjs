/** Capture the unchanged web UI with the same deterministic fixture used by native verification. */
import { app, BrowserWindow, Menu } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHandler, registerScheme, START_URL } from '../electron/protocol.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
app.commandLine.appendSwitch('force-device-scale-factor','1');
const out=resolve(root,'artifacts');
const fixture={format:'canvaswebtool-document',version:1,metadata:{},document:{viewport:{offsetX:0,offsetY:0,scale:1},settings:{},textBoxes:[
  {id:1,x:80,y:80,w:260,h:150,title:'Ingest',text:'Reads **.cvdoc** files\n- Native document editing',color:'#1a1a1a',borderColor:'#444',titleColor:'#e7e7e7',textColor:'#ddd',fontSize:14},
  {id:2,x:520,y:320,w:260,h:150,title:'Render',text:'Draws the canvas\n{blue:Connected to your ideas}',color:'#25322a',borderColor:'#444',titleColor:'#e7e7e7',textColor:'#ddd',fontSize:14}],
  shapes:[{id:1,x:520,y:80,w:160,h:160,shapeType:'circle',color:'#1d3b53',borderColor:'#6bb5ff',borderWidth:2},{id:2,x:80,y:370,w:140,h:100,shapeType:'diamond',color:'#30243b',borderColor:'#ba68c8',borderWidth:2},{id:3,x:290,y:540,w:160,h:100,shapeType:'triangle',color:'#332c1f',borderColor:'#ffb74d',borderWidth:2},{id:4,x:580,y:550,w:160,h:80,shapeType:'rectangle',color:'#2b2b2b',borderColor:'#6bb5ff',borderWidth:2,cornerRadius:12}],
  arrows:[{id:1,x1:340,y1:155,x2:520,y2:160,connectedFrom:0,connectedTo:0,connectedFromType:'textBox',connectedToType:'shape',color:'#6bb5ff',lineWidth:2,headSize:14}],connectors:[{id:1,x1:220,y1:420,x2:520,y2:395,color:'#81c784'}],connections:[{id:1,from:0,to:1,color:'#6bb5ff',text:'then'}]}};
registerScheme();
app.whenReady().then(async()=>{
  await mkdir(out,{recursive:true});await writeFile(resolve(out,'fixture.cvdoc'),JSON.stringify(fixture,null,2));
  Menu.setApplicationMenu(null);registerHandler(root);
  const size=(process.env.REFERENCE_SIZE||'1200,720').split(',').map(Number);
  const win=new BrowserWindow({width:size[0],height:size[1],useContentSize:true,show:false,backgroundColor:'#111',webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=2&&!message.includes('Electron Security Warning'))errors.push(message);});
  await win.loadURL(START_URL);await new Promise(r=>setTimeout(r,1000));
  await writeFile(resolve(out,'web-empty.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async()=>{const {state}=await import('./js/state.js');const {restoreDocumentState}=await import('./js/document.js');restoreDocumentState(${JSON.stringify(fixture.document)});state.connections.splice(0,state.connections.length,...${JSON.stringify(fixture.document.connections)});state.offsetX=state.targetOffsetX=0;state.offsetY=state.targetOffsetY=0;state.scale=state.targetScale=1;})()`);
  console.log('fixture state',await win.webContents.executeJavaScript(`(async()=>{const {state}=await import('./js/state.js');const {syncAllEntities}=await import('./js/dom-entities.js');syncAllEntities();return {textBoxes:state.textBoxes.length,shapes:state.shapes.length,entities:document.querySelectorAll('.entity').length,html:document.querySelector('.entity')?.outerHTML.slice(0,180)};})()`));
  await new Promise(r=>setTimeout(r,800));await win.webContents.capturePage();await new Promise(r=>setTimeout(r,200));await writeFile(resolve(out,'web-scene.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async()=>{const {state}=await import('./js/state.js');state.selectedShapes.clear();state.selectedTextBoxes.clear();state.selectedShapes.add(0);const {refreshSidePanel}=await import('./js/side-panel.js');refreshSidePanel();})()`);
  await new Promise(r=>setTimeout(r,300));await win.webContents.capturePage();await new Promise(r=>setTimeout(r,200));await writeFile(resolve(out,'web-properties.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`(async()=>{const {state}=await import('./js/state.js');state.selectedShapes.clear();const {refreshSidePanel}=await import('./js/side-panel.js');refreshSidePanel();const {setTheme}=await import('./js/settings.js');setTheme('light');})()`);await new Promise(r=>setTimeout(r,500));await win.webContents.capturePage();await new Promise(r=>setTimeout(r,200));await writeFile(resolve(out,'web-light.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({size,errors,fixture:resolve(out,'fixture.cvdoc')}));app.exit(errors.length?1:0);
}).catch(error=>{console.error(error);app.exit(1);});
