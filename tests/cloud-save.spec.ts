import { execFileSync } from "node:child_process";
import { test, expect, Page, Browser } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { zipSync, strToU8, strFromU8 } from 'fflate';
import { createCloudServer, hashToken } from '../cloud/server.mjs';
import { emptyData, Data } from '../src/types';
import { addDemo } from '../src/demo';
import { backup, parseImport, commitImport, unpack } from '../src/library';
import { createSave, inspectSave, sha256 } from '../src/archive';
import { encryptSave, decryptSave } from '../src/cloud-client';
import { selectStudy } from '../src/learning';
import { commitStudyRating, studyCursor } from '../src/study-actions';
import { rate } from '../src/scheduler';
import { createExam } from '../src/exam';

async function fixture(){const d=emptyData();addDemo(d);commitImport(d,await parseImport(new File([readFileSync('public/sample-media.pack')],'media.zip'),d));d.notes.push({entryId:d.entries[0].id,text:'PRIVATE-CLOUD-NOTE',favorite:true,reinforce:false});selectStudy(d,'new');commitStudyRating(d,studyCursor(d),await rate(d,d.study!.ids[0],3));d.exams.push(createExam(d,{decks:[],scope:'all',tag:'',count:3,type:'zh-en',ratios:[25,25,25,25],minutes:15,practice:false}));return d;}
const password='correct horse battery cloud';
async function removeTestRoot(root:string){if(!resolve(root).startsWith(resolve(tmpdir())+sep)||!basename(root).startsWith('cijian-cloud-test-'))throw Error('Unsafe test cleanup');await rm(root,{recursive:true,force:true});}
async function service(maxItems=10){const root=await mkdtemp(join(tmpdir(),'cijian-cloud-test-')),token=randomBytes(32).toString('base64url'),other=randomBytes(32).toString('base64url'),user=randomUUID();const config={root,tokens:{[hashToken(token)]:user,[hashToken(other)]:randomUUID()},origins:['http://127.0.0.1:4173'],maxItems};const server=createCloudServer(config);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return {root,token,other,user,server,config,url:'http://127.0.0.1:'+(server.address() as any).port,close:async()=>{server.closeAllConnections();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));await removeTestRoot(root);}};}

test('新存档完整往返含媒体、FSRS、暂停、考试快照；清单校验拒绝篡改和缺失，旧备份仍可读',async()=>{
 const d=await fixture(),zip=await createSave(d,{id:'test-device',name:'测试设备A'}),p=await inspectSave(zip);
 expect(p.data).toEqual(JSON.parse(JSON.stringify(d)));expect(p.manifest?.summary.media).toBeGreaterThan(0);expect(p.manifest?.deviceName).toBe('测试设备A');
 const files=unpack(zip),raw=JSON.parse(strFromU8(files['backup.json']));raw.data.notes[0].text='changed';files['backup.json']=strToU8(JSON.stringify(raw));await expect(inspectSave(zipSync(files))).rejects.toThrow('完整性校验失败');
 const missing=unpack(zip);delete missing[Object.keys(missing).find(k=>k.startsWith('media-data/'))!];await expect(inspectSave(zipSync(missing))).rejects.toThrow('清单不完整');
 expect((await inspectSave(backup(d))).manifest).toBeUndefined();expect((await inspectSave(backup(d))).data).toEqual(p.data);
});

test('存档客户端加密，随机盐/IV，正确密码恢复，错误密码/头/密文篡改均拒绝',async()=>{
 const d=await fixture(),zip=await createSave(d,{id:'test',name:'A'}),a=await encryptSave(zip,password,'A'),b=await encryptSave(zip,password,'A');
 expect(a.id).not.toBe(b.id);expect(a.bytes).not.toEqual(b.bytes);expect(new TextDecoder().decode(a.bytes)).not.toContain('PRIVATE-CLOUD-NOTE');
 expect(await decryptSave(a.bytes,password)).toEqual(zip);await expect(decryptSave(a.bytes,'wrong')).rejects.toThrow('密码不正确');
 const broken=a.bytes.slice();broken[broken.length-1]^=1;await expect(decryptSave(broken,password)).rejects.toThrow('密码不正确');
 const header=a.bytes.slice();header[25]^=1;await expect(decryptSave(header,password)).rejects.toThrow();
 await expect(encryptSave(zip,'short','A')).rejects.toThrow('12至256');
});

test('真实服务鉴权隔离、校验、幂等、容量与并发写入，不覆盖历史或留下半份存档',async()=>{
 const s=await service(2),d=await fixture(),zip=await createSave(d,{id:'test',name:'A'});
 const put=async(e:Awaited<ReturnType<typeof encryptSave>>)=>fetch(s.url+'/v1/backups/'+e.id,{method:'PUT',headers:{Authorization:'Bearer '+s.token,'Content-Type':'application/octet-stream','X-Content-SHA256':await sha256(e.bytes)},body:e.bytes as BodyInit});
 try{
  expect((await fetch(s.url+'/v1/backups')).status).toBe(401);expect((await fetch(s.url+'/v1/backups',{headers:{Authorization:'Bearer '+s.token,Origin:'https://unknown.invalid'}})).status).toBe(403);
  const a=await encryptSave(zip,password,'A');expect((await put(a)).status).toBe(201);expect((await put(a)).status).toBe(201);
  const bad={...a,bytes:a.bytes.slice()};bad.bytes[bad.bytes.length-1]^=1;expect((await put(bad)).status).toBe(409);
  const list=await (await fetch(s.url+'/v1/backups',{headers:{Authorization:'Bearer '+s.token}})).json();expect(list.items).toHaveLength(1);
  const stored=new Uint8Array(await (await fetch(s.url+'/v1/backups/'+a.id,{headers:{Authorization:'Bearer '+s.token}})).arrayBuffer());expect(stored).toEqual(a.bytes);
  expect((await (await fetch(s.url+'/v1/backups',{headers:{Authorization:'Bearer '+s.other}})).json()).items).toEqual([]);
  expect((await fetch(s.url+'/v1/backups/'+a.id,{headers:{Authorization:'Bearer '+s.other}})).status).toBe(404);
  const b=await encryptSave(zip,password,'B'),c=await encryptSave(zip,password,'C');const statuses=await Promise.all([put(b).then(r=>r.status),put(c).then(r=>r.status)]);expect(statuses.sort()).toEqual([201,507]);
  const names=await readdir(join(s.root,s.user));expect(names).toHaveLength(2);expect(names.every(n=>!n.startsWith('.tmp'))).toBe(true);
  expect((await fetch(s.url+'/v1/backups/'+a.id,{method:'DELETE',headers:{Authorization:'Bearer '+s.token}})).status).toBe(204);
 }finally{await s.close();}
});

async function seed(page:Page,d:Data){await page.route('**/src/builtin.ts*',r=>r.fulfill({contentType:'text/javascript',body:'export async function installBuiltin(){return false;}'}));await page.route('**/cloud-fixture',r=>r.fulfill({contentType:'text/html',body:'<html>Isolated cloud test</html>'}));await page.goto('/cloud-fixture');await page.evaluate(data=>new Promise<void>(resolve=>{const r=indexedDB.open('cijian-local-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('state');r.result.createObjectStore('media');};r.onsuccess=()=>{const db=r.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put(data,'root');tx.oncomplete=()=>{db.close();resolve();};};}),JSON.parse(JSON.stringify(d)));await page.goto('/#settings');await expect(page.getByRole('heading',{name:'偏好设置',exact:true})).toBeVisible();}
async function state(page:Page){return page.evaluate(()=>new Promise<any>(resolve=>{const r=indexedDB.open('cijian-local-v1');r.onsuccess=()=>{const db=r.result,q=db.transaction('state').objectStore('state').get('root');q.onsuccess=()=>{resolve(q.result);db.close();};};}));}
async function connect(page:Page,url:string,token:string,name:string){await page.getByLabel('云服务地址',{exact:true}).fill(url);await page.getByLabel('云连接密钥',{exact:true}).fill(token);await page.getByLabel('本机名称',{exact:true}).fill(name);await page.getByRole('button',{name:'连接云存档',exact:true}).click();await expect(page.getByRole('button',{name:'立即云备份',exact:true})).toBeVisible();}

test('两个独立客户端真实上传恢复：错密码/断网不改数据，双击只恢复一次，保护备份可找回原记录',async({browser})=>{
 test.setTimeout(60000);const s=await service(),ca=await browser.newContext(),cb=await browser.newContext(),a=await ca.newPage(),b=await cb.newPage(),source=await fixture(),original=emptyData();addDemo(original);original.notes.push({entryId:original.entries[0].id,text:'B-ORIGINAL-KEEP',favorite:false,reinforce:false});
 try{
  await seed(a,source);await connect(a,s.url,s.token,'设备A');await a.getByLabel('存档密码',{exact:true}).fill(password);await a.getByLabel('确认存档密码',{exact:true}).fill(password);await a.getByRole('button',{name:'立即云备份',exact:true}).click();await expect(a.locator('.cloud-save')).toHaveCount(1);
  await seed(b,original);await connect(b,s.url,s.token,'设备B');const before=await state(b);
  await b.getByLabel('存档密码',{exact:true}).fill('wrong');await b.getByRole('button',{name:'预览恢复此存档',exact:true}).click();await expect(b.getByText('存档密码不正确，或文件已损坏；本机数据未改动',{exact:true})).toBeVisible();expect(await state(b)).toEqual(before);
  await cb.setOffline(true);await b.getByRole('button',{name:'刷新云存档',exact:true}).click();await expect(b.getByText('无法连接云服务，请检查网络、地址和服务配置；本机记录保留',{exact:true})).toBeVisible();expect(await state(b)).toEqual(before);await cb.setOffline(false);
  await b.getByLabel('存档密码',{exact:true}).fill(password);await b.getByRole('button',{name:'预览恢复此存档',exact:true}).click();await expect(b.getByRole('region',{name:'恢复预览'})).toContainText('来源：设备A');expect(await state(b)).toEqual(before);
  await b.getByRole('button',{name:'确认替换当前全部数据',exact:true}).evaluate((el:HTMLButtonElement)=>{el.click();el.click();});await expect(b.getByRole('region',{name:'恢复预览'})).toHaveCount(0);
  const restored=await state(b);expect(restored.notes).toEqual(source.notes);expect(restored.cards).toEqual(JSON.parse(JSON.stringify(source.cards)));expect(restored.exams).toEqual(source.exams);expect(restored.study).toEqual(source.study);
  const downloadPromise=b.waitForEvent('download');await b.getByRole('button',{name:'导出保护备份',exact:true}).click();const file=await (await downloadPromise).path();const recovery=await inspectSave(new Uint8Array(await readFile(file!)));expect(recovery.data.notes).toEqual(original.notes);expect(recovery.data.cards).toHaveLength(0);
  await b.reload();await b.getByRole('button',{name:'刷新云存档',exact:true}).click();await expect(b.locator('.cloud-save')).toHaveCount(1);
  await b.getByRole('button',{name:'查看上次保护备份',exact:true}).click();await expect(b.getByRole('region',{name:'恢复预览'})).toBeVisible();await b.getByRole('button',{name:'确认替换当前全部数据',exact:true}).click();await expect.poll(async()=> (await state(b)).notes).toEqual(original.notes);
 }finally{await ca.close();await cb.close();await s.close();}
});

test('保护备份存储失败和恢复事务中途异常均保留原数据与媒体',async({page})=>{
 const original=await fixture(),candidate=await fixture();candidate.notes[0].text='NEW-CANDIDATE';await seed(page,original);
 await page.locator('input[type=file]').setInputFiles({name:'new-save.zip',mimeType:'application/zip',buffer:Buffer.from(await createSave(candidate,{id:'test',name:'其他设备'}))});await expect(page.getByRole('region',{name:'恢复预览'})).toBeVisible();
 const before=await state(page),mediaBefore=await page.evaluate(()=>new Promise<any>(resolve=>{const r=indexedDB.open('cijian-local-v1');r.onsuccess=()=>{const q=r.result.transaction('media').objectStore('media').getAll();q.onsuccess=()=>{resolve(q.result);r.result.close();};};}));
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;(window as any).testStorageFailure='recovery';IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){const key=args[1],mode=(window as any).testStorageFailure;if((mode==='recovery'&&this.transaction.db.name==='cijian-vault-v1'&&key==='recovery')||(mode==='active'&&this.transaction.db.name==='cijian-local-v1'&&this.name==='state'))throw new DOMException('Injected test failure','QuotaExceededError');return put.apply(this,args);};});
 await page.getByRole('button',{name:'确认替换当前全部数据',exact:true}).click();await expect(page.getByText('无法保存本机保护备份，可能存储空间不足；恢复已停止，当前数据未改动',{exact:true})).toBeVisible();expect(await state(page)).toEqual(before);
 await page.evaluate(()=>{(window as any).testStorageFailure='active';});await page.getByRole('button',{name:'确认替换当前全部数据',exact:true}).click();await expect(page.getByText('恢复写入失败，当前记录和媒体未替换，保护备份已保留',{exact:true})).toBeVisible();expect(await state(page)).toEqual(before);
 const mediaAfter=await page.evaluate(()=>new Promise<any>(resolve=>{const r=indexedDB.open('cijian-local-v1');r.onsuccess=()=>{const q=r.result.transaction('media').objectStore('media').getAll();q.onsuccess=()=>{resolve(q.result);r.result.close();};};}));expect(mediaAfter).toEqual(mediaBefore);
});

test('下载的加密存档可脱离云服务离线导入并预览恢复',async({page,context})=>{
 const source=await fixture(),original=emptyData();addDemo(original);await seed(page,original);
 const encrypted=await encryptSave(await createSave(source,{id:'test',name:'离线文件来源'}),password,'离线文件来源');
 await context.setOffline(true);await page.locator('input[type=file]').setInputFiles({name:'save.cjsave',mimeType:'application/octet-stream',buffer:Buffer.from(encrypted.bytes)});
 await page.getByLabel('加密文件密码',{exact:true}).fill(password);await page.getByRole('button',{name:'解密并预览文件',exact:true}).click();await expect(page.getByRole('region',{name:'恢复预览'})).toContainText('离线文件来源');
 await page.getByRole('button',{name:'确认替换当前全部数据',exact:true}).click();await expect.poll(async()=> (await state(page)).notes).toEqual(source.notes);await context.setOffline(false);
});


test('服务初始化不覆盖私钥配置，服务重新创建后历史存档仍存在',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cijian-cloud-test-'));let server:ReturnType<typeof createCloudServer>|undefined;
 try{
  const cli=resolve('cloud/server.mjs'),env={...process.env,CIJIAN_CLOUD_DIR:root};
  execFileSync(process.execPath,[cli,'init'],{env,stdio:'pipe'});
  const config=JSON.parse(await readFile(join(root,'config.json'),'utf8')),token=await readFile(join(root,'access-key.txt'),'utf8');
  expect(()=>execFileSync(process.execPath,[cli,'init'],{env,stdio:'pipe'})).toThrow();expect(await readFile(join(root,'access-key.txt'),'utf8')).toBe(token);
  const start=async()=>{server=createCloudServer({...config,root:join(root,'saves')});await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+(server!.address() as any).port;};
  let url=await start();const saved=await encryptSave(await createSave(await fixture(),{id:'test',name:'持久化测试'}),password,'持久化测试');
  expect((await fetch(url+'/v1/backups/'+saved.id,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','X-Content-SHA256':await sha256(saved.bytes)},body:saved.bytes as BodyInit})).status).toBe(201);
  server!.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));url=await start();
  const list=await (await fetch(url+'/v1/backups',{headers:{Authorization:'Bearer '+token}})).json();expect(list.items.map((i:any)=>i.id)).toEqual([saved.id]);
 }finally{if(server?.listening){server.closeAllConnections();await new Promise<void>(r=>server!.close(()=>r()));}await removeTestRoot(root);}
});
