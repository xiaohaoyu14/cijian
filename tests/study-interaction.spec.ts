import { test, expect, Page } from '@playwright/test';
import { ActionGate, KeyedActionGate } from '../src/action-gate';
import { emptyData, Data } from '../src/types';
import { addDemo } from '../src/demo';
import { selectStudy } from '../src/learning';
import { rate } from '../src/scheduler';
import { studyCursor, commitStudyRating, commitStudyUndo } from '../src/study-actions';

test('300ms首击立即执行，期间交叉点击不执行，也不产生延迟尾随动作',async()=>{
 let now=0,count=0;const gate=new ActionGate(300,()=>now);
 expect(await gate.run(async()=>{count++;})).toBe(true);expect(count).toBe(1);
 for(let i=0;i<10;i++)expect(await gate.run(async()=>{count++;})).toBe(false);
 now=299;expect(await gate.run(async()=>{count++;})).toBe(false);
 now=300;expect(count).toBe(1);expect(await gate.run(async()=>{count++;})).toBe(true);expect(count).toBe(2);
});
test('异步处理中超过300ms仍不能重复，失败解锁后可重试',async()=>{
 let now=0,release!:()=>void,count=0;const gate=new ActionGate(300,()=>now);
 const first=gate.run(async()=>{count++;await new Promise<void>(r=>{release=r;});});
 now=1000;expect(gate.pending).toBe(true);expect(await gate.run(async()=>{count++;})).toBe(false);release();await first;
 await expect(gate.run(async()=>{throw Error('模拟保存失败');})).rejects.toThrow('模拟保存失败');expect(gate.pending).toBe(false);
 expect(await gate.run(async()=>{count++;})).toBe(true);expect(count).toBe(2);
});
test('写入前检查任务/词条/位置和卡片快照，旧评分不能命中新任务或重复记分',async()=>{
 const d=emptyData();addDemo(d);selectStudy(d,'new');const original=d.study!.id!,token=studyCursor(d),id=d.study!.ids[0],log=await rate(d,id,3);
 d.study!.id='replacement-task';let before=structuredClone(d);expect(()=>commitStudyRating(d,token,log)).toThrow('学习任务已更新');expect(d).toEqual(before);
 d.study!.id=original;commitStudyRating(d,token,log);expect(d.logs).toHaveLength(1);expect(d.study!.index).toBe(1);
 before=structuredClone(d);expect(()=>commitStudyRating(d,token,log)).toThrow();expect(d).toEqual(before);
 const undoToken=studyCursor(d);commitStudyUndo(d,undoToken);expect(d.study!.index).toBe(0);expect(d.cards).toHaveLength(0);
 before=structuredClone(d);expect(()=>commitStudyUndo(d,undoToken)).toThrow();expect(d).toEqual(before);
 const newer=await rate(d,id,3);d.cards.push({...newer.before,fsrs:{...newer.before.fsrs,reps:9}});before=structuredClone(d);
 expect(()=>commitStudyRating(d,studyCursor(d),newer)).toThrow('复习记录已改变');expect(d).toEqual(before);
});
async function seed(page:Page,d:Data){
 await page.route('**/src/builtin.ts*',r=>r.fulfill({contentType:'text/javascript',body:'export async function installBuiltin(){return false;}'}));
 await page.route('**/motion-fixture',r=>r.fulfill({contentType:'text/html',body:'<html>Isolated test fixture</html>'}));await page.goto('/motion-fixture');
 await page.evaluate(data=>new Promise<void>(resolve=>{const r=indexedDB.open('cijian-local-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('state');r.result.createObjectStore('media');};r.onsuccess=()=>{const db=r.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put(data,'root');tx.oncomplete=()=>{db.close();resolve();};};}),JSON.parse(JSON.stringify(d)));await page.goto('/');
}
async function inspect(page:Page){return page.evaluate(()=>new Promise<any>((resolve,reject)=>{const r=indexedDB.open('cijian-local-v1');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,q=db.transaction('state').objectStore('state').get('root');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const d=q.result;resolve({index:d.study?.index,mode:d.study?.mode,logs:d.logs.filter((l:any)=>!l.undone).length,cards:d.cards.length});db.close();};};}));}
async function burst(page:Page){await page.evaluate(()=>{const buttons=document.querySelectorAll<HTMLButtonElement>('.rating-buttons button');for(let i=0;i<3;i++)for(const b of buttons)b.click();});}

test('真实新词连点和交叉评分只走一词；300ms边界有效，撤销后可重新评分',async({page})=>{
 const fixed=new Date(2026,9,29,12);await page.clock.install({time:fixed});await page.clock.pauseAt(new Date(+fixed+1000));
 const d=emptyData();addDemo(d);await seed(page,d);
 await page.getByRole('button',{name:'学习新词',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();b.click();});
 await expect(page.getByRole('heading',{name:'学习新词',exact:true})).toBeVisible();
 await burst(page);await expect.poll(()=>inspect(page)).toMatchObject({index:1,logs:1,cards:1,mode:'new'});
 await burst(page);expect(await inspect(page)).toMatchObject({index:1,logs:1});
 await page.clock.fastForward(299);await burst(page);expect(await inspect(page)).toMatchObject({index:1,logs:1});
 await page.clock.fastForward(2);await burst(page);await expect.poll(()=>inspect(page)).toMatchObject({index:2,logs:2,cards:2});
 await page.getByRole('button',{name:'撤销上次评分'}).evaluate((b:HTMLButtonElement)=>{b.click();b.click();});await expect.poll(()=>inspect(page)).toMatchObject({index:1,logs:1,cards:1});
 await burst(page);await expect.poll(()=>inspect(page)).toMatchObject({index:2,logs:2,cards:2});
});
test('复习揭晓动画300ms，揭晓前无答案DOM，评分换词后不闪现旧答案',async({page})=>{
 const d=emptyData();addDemo(d);d.links=d.links.slice(0,3);
 for(const e of d.entries.slice(0,3)){const log=await rate(d,e.id,4,new Date(Date.now()-7*86400000));d.cards.push({...log.after,fsrs:{...log.after.fsrs,dueAt:new Date(Date.now()-60000),scheduleStatus:'review'}});d.logs.push(log);}
 await seed(page,d);await page.getByRole('button',{name:'开始复习',exact:true}).click();await expect(page.locator('.study-answer')).toHaveCount(0);
 await page.getByRole('button',{name:'查看答案',exact:true}).evaluate((b:HTMLButtonElement)=>b.click());
 const style=await page.locator('.answer-reveal').evaluate(el=>({name:getComputedStyle(el).animationName,duration:getComputedStyle(el).animationDuration}));expect(style).toEqual({name:'reveal-answer',duration:'0.3s'});
 await burst(page);await expect.poll(()=>inspect(page)).toMatchObject({index:1,logs:4});await expect(page.locator('.study-answer')).toHaveCount(0);await expect(page.getByRole('button',{name:'查看答案',exact:true})).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'查看答案',exact:true}).press('Enter');
 expect(await page.locator('.answer-reveal').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});


test('入口防抖区分学习意图：重复新词被拦截，完成后正常切换复习不受误拦',async()=>{
 let now=0,count=0,release!:()=>void;const gate=new KeyedActionGate(300,()=>now);
 expect(await gate.run('new:A',async()=>{count++;})).toBe(true);
 expect(await gate.run('new:A',async()=>{count++;})).toBe(false);
 expect(await gate.run('review:A',async()=>{count++;})).toBe(true);
 expect(await gate.run('new:A',async()=>{count++;})).toBe(false);
 now=300;const pending=gate.run('new:A',async()=>{count++;await new Promise<void>(r=>{release=r;});});
 expect(await gate.run('review:B',async()=>{count++;})).toBe(false);release();await pending;expect(count).toBe(3);
});
