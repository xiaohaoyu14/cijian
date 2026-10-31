import { test, expect, Page } from '@playwright/test';
import { emptyData, Data, today } from '../src/types';
import { addDemo } from '../src/demo';
import { applyRating, rate, undoRating, reviewPreview, memoryPrediction } from '../src/scheduler';
import { reviewPlan, reviewHistory, memoryStage, roundResults, dayStart } from '../src/review-plan';
import { selectStudy } from '../src/learning';
import { backup, readBackup } from '../src/library';

const ago=(now:Date,days:number,hour=9)=>new Date(now.getFullYear(),now.getMonth(),now.getDate()-days,hour);
async function fixture(count=5,now=new Date(2026,9,29,12)){
 const d=emptyData();addDemo(d);d.links=d.links.slice(0,count);d.entries=d.entries.slice(0,count);
 for(const e of d.entries)applyRating(d,await rate(d,e.id,4,ago(now,14)));
 return d;
}
test('复习计划按所选词库去重：逾期、稍后到期、七天分布和同词多反馈',async()=>{
 const now=new Date(2026,9,29,12),d=await fixture(5,now),deck=d.decks[0].id;
 d.decks.push({...d.decks[0],id:'other',name:'其他'});d.links[4].deckId='other';d.links.push({deckId:'other',entryId:d.entries[0].id});
 const a=d.entries[0].id,b=d.entries[1].id;
 applyRating(d,await rate(d,a,1,ago(now,0,9)));applyRating(d,await rate(d,a,3,ago(now,0,10)));
 d.cards[0].fsrs.dueAt=ago(now,1);d.cards[0].fsrs.scheduleStatus='review';
 d.cards[1].fsrs.dueAt=ago(now,0,11);d.cards[1].fsrs.scheduleStatus='relearning';
 d.cards[2].fsrs.dueAt=ago(now,0,18);d.cards[3].fsrs.dueAt=new Date(dayStart(now,3));d.cards[4].fsrs.dueAt=ago(now,1);
 const p=reviewPlan(d,deck,now);
 expect(p.rows).toHaveLength(4);expect(p.due.map(r=>r.entry.id)).toEqual([b,a]);expect(p.overdue).toBe(1);expect(p.relearning).toBe(1);expect(p.later).toHaveLength(1);
 expect(p.doneWords).toBe(1);expect(p.feedbacks).toBe(2);expect(p.forecast.map(f=>f.count)).toEqual([3,0,0,1,0,0,0]);expect(p.origins[3].count).toBe(2);
 expect(reviewPlan(d,'',now).rows).toHaveLength(5);
 const log=await rate(d,a,3,ago(now,0,11));d.study={mode:'review',ids:[a],index:0,deckId:deck,reviewLogIds:[]};applyRating(d,log);
 expect(roundResults(d,d.study).words).toBe(1);undoRating(d);
 expect(roundResults(d,d.study).words).toBe(0);expect(reviewPlan(d,deck,now).feedbacks).toBe(2);
});
test('分钟与跨午夜边界不丢到期词，未来分布只数当前一次到期',async()=>{
 const now=new Date(2026,9,29,23,59,30),d=await fixture(3,now);
 d.cards[0].fsrs.dueAt=now;d.cards[1].fsrs.dueAt=new Date(+now+10000);d.cards[2].fsrs.dueAt=new Date(dayStart(now,1));
 const p=reviewPlan(d,d.decks[0].id,now);expect(p.due).toHaveLength(1);expect(p.later).toHaveLength(1);expect(p.forecast[0].count).toBe(2);expect(p.forecast[1].count).toBe(1);
 const tomorrow=reviewPlan(d,d.decks[0].id,new Date(dayStart(now,1)));expect(tomorrow.due).toHaveLength(3);expect(tomorrow.overdue).toBe(2);
});
test('较稳固需要不同日期的真实成功，今日重复不冒充跨日，忘记后重新累计',async()=>{
 const now=new Date(2026,9,29,12),d=await fixture(1,now),id=d.entries[0].id;
 for(let i=0;i<8;i++)applyRating(d,await rate(d,id,3,new Date(+ago(now,0,9)+i*600000)));
 d.cards[0].fsrs.scheduleStatus='review';d.cards[0].fsrs.stability=60;
 let h=reviewHistory(d.logs);expect(h.successDays).toBe(1);expect(memoryStage(d.cards[0],h)).toBe('building');
 applyRating(d,await rate(d,id,3,ago(now,-1)));applyRating(d,await rate(d,id,2,ago(now,-2)));
 d.cards[0].fsrs.stability=60;d.cards[0].fsrs.scheduleStatus='review';h=reviewHistory(d.logs);expect(h.streakDays).toBe(3);expect(memoryStage(d.cards[0],h)).toBe('steady');
 applyRating(d,await rate(d,id,1,ago(now,-3)));h=reviewHistory(d.logs);expect(h.streakDays).toBe(0);expect(memoryStage(d.cards[0],h)).toBe('relearning');
 d.logs.at(-1)!.undone=true;expect(reviewHistory(d.logs).streakDays).toBe(3);
});
test('官方四档预览等于同一时刻实际调度；预测和浏览不写卡片或日志',async()=>{
 const now=new Date(2026,9,29,12),d=await fixture(1,now),id=d.entries[0].id;
 applyRating(d,await rate(d,id,3,ago(now,7)));const before=structuredClone(d);
 const preview=await reviewPreview(d.cards[0],d.settings.retention,now);expect(preview).toHaveLength(4);
 for(const item of preview)expect(item.dueAt).toBe(new Date((await rate(d,id,item.grade,now)).after.fsrs.dueAt).toISOString());
 const curve=await memoryPrediction(d.cards[0],d.settings.retention,now);expect(curve).toHaveLength(8);expect(curve!.every(p=>p.probability>=0&&p.probability<=1)).toBe(true);expect(curve![7].probability).toBeLessThan(curve![0].probability);
 reviewPlan(d,d.decks[0].id,now);expect(d).toEqual(before);
});
test('20/50/全部只限制每轮，不抹掉积压；暂停与备份保留本轮日志并可撤销',async()=>{
 const now=new Date(),d=await fixture(120,now),deck=d.decks[0].id;
 for(const card of d.cards){card.fsrs.dueAt=new Date(+now-3600000);card.fsrs.scheduleStatus='review';}
 selectStudy(d,'review');expect(d.study!.ids).toHaveLength(20);
 applyRating(d,await rate(d,d.study!.ids[0],4));d.settings.reviewBatch=50;selectStudy(d,'review');expect(d.study!.ids).toHaveLength(20);expect(d.study!.index).toBe(1);
 for(let i=1;i<20;i++)applyRating(d,await rate(d,d.study!.ids[d.study!.index],4));
 expect(roundResults(d,d.study!).words).toBe(20);expect(reviewPlan(d,deck).due).toHaveLength(100);
 selectStudy(d,'review');expect(d.study!.ids).toHaveLength(50);const selected=d.study!.ids[0];applyRating(d,await rate(d,selected,3));
 const restored=readBackup(backup(d));expect(restored.settings.reviewBatch).toBe(50);expect(restored.study!.reviewLogIds).toHaveLength(1);undoRating(restored);expect(restored.study!.index).toBe(0);expect(reviewPlan(restored,deck).due).toHaveLength(100);
 d.study=undefined;d.pausedStudies={};d.settings.reviewBatch=0;selectStudy(d,'review');expect(d.study!.ids).toHaveLength(99);
});
async function seed(page:Page,d:Data){
 await page.route('**/src/builtin.ts*',r=>r.fulfill({contentType:'text/javascript',body:'export async function installBuiltin(){return false;}'}));
 await page.route('**/review-fixture',r=>r.fulfill({contentType:'text/html',body:'<html>Isolated review test data</html>'}));
 await page.goto('/review-fixture');await page.evaluate(data=>new Promise<void>((resolve,reject)=>{const r=indexedDB.open('cijian-local-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('state');r.result.createObjectStore('media');};r.onsuccess=()=>{const db=r.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put(data,'root');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}),JSON.parse(JSON.stringify(d)));
 await page.goto('/');
}
test('真实复习界面：20词一轮、隐藏答案、预览、暂停重开、下一轮与记忆曲线',async({page})=>{
 test.setTimeout(90000);const now=new Date(),d=await fixture(55,now);
 for(const card of d.cards){card.fsrs.dueAt=new Date(+now-60000);card.fsrs.scheduleStatus='review';}
 await seed(page,d);await page.getByRole('button',{name:'查看复习计划 →',exact:true}).click();await expect(page.getByTestId('review-due')).toHaveText('55');
 await page.getByRole('button',{name:'开始计划复习',exact:true}).click();
 await expect(page.getByRole('button',{name:'查看答案',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'n. 校园',exact:true})).not.toBeVisible();
 for(let i=0;i<20;i++){
  if(i===3){await page.getByRole('button',{name:'暂停并保存',exact:true}).click();await page.reload();await page.getByRole('button',{name:'查看复习计划 →',exact:true}).click();await expect(page.getByTestId('review-due')).toHaveText('52');await page.getByRole('button',{name:'继续本轮复习',exact:true}).click();await expect(page.getByText('4 / 20',{exact:true})).toBeVisible();}
  await page.getByRole('button',{name:'查看答案',exact:true}).click();
  await expect(page.getByText('选择反馈后，预计下次复习',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'4 很熟悉',exact:true}).click();
 }
 await expect(page.getByText('本轮已处理 20 个不同词。',{exact:true})).toBeVisible();await expect(page.getByText('现在仍有')).toContainText('35');
 await page.getByRole('button',{name:'查看复习计划',exact:true}).click();await expect(page.getByTestId('review-due')).toHaveText('35');await expect(page.getByTestId('review-done')).toHaveText('20');
 await page.getByRole('button',{name:'全部已学',exact:true}).click();await page.getByLabel('查找复习单词').fill('campus');await page.getByRole('button',{name:'查看记忆档案 campus',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'单词记忆档案'})).toBeVisible();await expect(page.getByRole('img',{name:'未来七天不复习的FSRS模型回忆概率估计'})).toBeVisible();
 await page.getByRole('button',{name:'关闭记忆档案'}).click();await page.getByRole('button',{name:'现在到期',exact:true}).click();await page.getByLabel('查找复习单词').fill('');await page.getByRole('button',{name:'开始计划复习',exact:true}).click();await expect(page.getByText('1 / 20',{exact:true})).toBeVisible();
});
test('手机复习空状态不生成学习数据，七天日历和记忆档案正常布局',async({page})=>{
 await page.setViewportSize({width:412,height:915});const d=emptyData();addDemo(d);await seed(page,d);
 await page.getByRole('button',{name:'查看复习计划 →',exact:true}).click();await expect(page.getByTestId('review-due')).toHaveText('0');await expect(page.getByRole('button',{name:'开始计划复习',exact:true})).toBeDisabled();
 await expect(page.getByText('现在没有到期词。',{exact:false})).toBeVisible();await page.getByRole('button',{name:'查看明天到期词',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'deliverables/复习计划-手机空状态.png',fullPage:true});
});

test('旧复习任务升级后仅记录后半轮，不把部分明细当作完整成绩',async()=>{
 const d=await fixture(3),ids=d.entries.map(e=>e.id);
 d.study={ids,index:2,mode:'review',deckId:d.decks[0].id};
 applyRating(d,await rate(d,ids[2],3));
 const r=roundResults(d,d.study);expect(r.recorded).toBe(true);expect(r.partial).toBe(true);expect(r.words).toBe(1);
 const restored=readBackup(backup(d));expect(roundResults(restored,restored.study!)).toEqual(r);
});
test('忘记后遵守FSRS短期重学时间，到期前不提前补题，到期后能开始下一批',async({page})=>{
 const now=new Date(2026,9,29,10);await page.clock.install({time:now});
 const d=await fixture(1,now);d.cards[0].fsrs.scheduleStatus='review';d.cards[0].fsrs.dueAt=new Date(+now-60000);
 await seed(page,d);await page.getByRole('button',{name:'查看复习计划 →',exact:true}).click();await page.getByRole('button',{name:'开始计划复习',exact:true}).click();
 await page.getByRole('button',{name:'查看答案',exact:true}).click();await page.getByRole('button',{name:'1 忘记了',exact:true}).click();
 await expect(page.getByRole('button',{name:'继续下一批复习',exact:true})).toBeDisabled();
 await expect(page.getByText('现在仍有')).toContainText('今天稍后还有 1 词到期');
 const wait = await page.evaluate(() => new Promise<number>(resolve => { const request = indexedDB.open("cijian-local-v1"); request.onsuccess = () => { const db = request.result, q = db.transaction("state").objectStore("state").get("root"); q.onsuccess = () => { resolve(+new Date(q.result.cards[0].fsrs.dueAt) - Date.now()); db.close(); }; }; }));
 expect(wait).toBeGreaterThan(0); expect(wait).toBeLessThan(86400000);
 await page.clock.fastForward(wait + 16000);
 await expect(page.getByRole('button',{name:'继续下一批复习',exact:true})).toBeEnabled();await page.getByRole('button',{name:'继续下一批复习',exact:true}).click();
 await expect(page.getByRole('button',{name:'查看答案',exact:true})).toBeVisible();await expect(page.getByText('1 / 1',{exact:true})).toBeVisible();
});
