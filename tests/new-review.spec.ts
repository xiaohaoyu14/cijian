import { test, expect, Page } from '@playwright/test';
import { emptyData, Data, isDue } from '../src/types';
import { addDemo } from '../src/demo';
import { selectStudy, pendingReview, pendingStudy, studyKey } from '../src/learning';
import { rate, applyRating } from '../src/scheduler';
import { commitStudyRating, commitStudyUndo, studyCursor } from '../src/study-actions';
import { backup, readBackup } from '../src/library';

function fixture(count=2){ const d=emptyData();addDemo(d);d.settings.daily=count;selectStudy(d,'new');return d; }
async function finish(d:Data){while(d.study!.index<d.study!.ids.length){const id=d.study!.ids[d.study!.index];commitStudyRating(d,studyCursor(d),await rate(d,id,4));}}

test('新词一轮完成即生成同批即时复习，不提前改写FSRS到期时间，不重复建卡',async()=>{
 const d=fixture(),ids=[...d.study!.ids];await finish(d);
 expect(d.cards.every(c=>!isDue(c))).toBe(true);const cards=structuredClone(d.cards),logs=structuredClone(d.logs);
 const pending=pendingReview(d,d.decks[0].id)!;expect(pending.ids).toEqual(ids);expect(pending.newReviewOf).toBe(d.study!.id);expect(pendingStudy(d)?.id).toBe(pending.id);
 selectStudy(d,'review');expect(d.study!.id).toBe(pending.id);expect(d.study!.index).toBe(0);expect(d.cards).toEqual(cards);expect(d.logs).toEqual(logs);
 const log=await rate(d,ids[0],3);expect(log.before.fsrs.reps).toBe(1);commitStudyRating(d,studyCursor(d),log);expect(d.cards).toHaveLength(2);expect(d.logs).toHaveLength(3);expect(d.study!.reviewLogIds).toEqual([log.id]);
 commitStudyUndo(d,studyCursor(d));expect(d.cards).toEqual(cards);expect(d.study!.index).toBe(0);
});

test('完成页撤销会撤回待开始的即时队列，重新评分再生成；完整备份可恢复',async()=>{
 const d=fixture();await finish(d);expect(Object.values(d.pausedStudies!)).toHaveLength(1);
 commitStudyUndo(d,studyCursor(d));expect(Object.values(d.pausedStudies!)).toHaveLength(0);expect(d.cards).toHaveLength(1);
 await finish(d);const restored=readBackup(backup(d));expect(pendingReview(restored,d.decks[0].id)!.ids).toEqual(d.study!.ids);selectStudy(restored,'review');expect(restored.study!.newReviewOf).toBe(d.study!.id);
 const cards=structuredClone(restored.cards);await finish(restored);expect(restored.cards).toHaveLength(cards.length);
 expect(()=>selectStudy(restored,'review')).toThrow('当前没有');
});

test('即时复习与旧到期任务分别保存，切换词库不混学，完成后继续旧任务',async()=>{
 const d=fixture(),deck=d.decks[0].id,old=d.entries[9].id;
 applyRating(d,await rate(d,old,4,new Date(Date.now()-14*86400000)));d.study!.index=0;delete d.study!.lastLog;
 const saved={id:'old-due',ids:[old],index:0,mode:'review' as const,deckId:deck,reviewLogIds:[]};d.pausedStudies={[studyKey('review',deck)]:structuredClone(saved)};
 await finish(d);selectStudy(d,'review');const immediate=structuredClone(d.study!);
 expect(d.study!.ids).not.toContain(old);expect(d.pausedStudies![studyKey('review',deck)]).toEqual(saved);
 d.decks.push({...d.decks[0],id:'other',name:'其他'});d.links.push({deckId:'other',entryId:d.entries[20].id});d.settings.studyDeckId='other';selectStudy(d,'new');expect(d.study!.ids).toEqual([d.entries[20].id]);
 d.settings.studyDeckId=deck;selectStudy(d,'review');expect(d.study).toEqual(immediate);await finish(d);selectStudy(d,'review');expect(d.study).toEqual(saved);
});

test('连续增加新词计划时各批即时复习独立排队，不覆盖未做批次',async()=>{
 const d=fixture(1);await finish(d);const first=pendingReview(d,d.decks[0].id)!;
 d.settings.daily=2;selectStudy(d,'new');await finish(d);expect(Object.values(d.pausedStudies!).filter(s=>s?.newReviewOf)).toHaveLength(2);
 selectStudy(d,'review');expect(d.study!.id).toBe(first.id);await finish(d);selectStudy(d,'review');expect(d.study!.ids).not.toEqual(first.ids);expect(d.study!.newReviewOf).toBeTruthy();
});

async function seed(page:Page,d:Data){
 await page.route('**/src/builtin.ts*',r=>r.fulfill({contentType:'text/javascript',body:'export async function installBuiltin(){return false;}'}));
 await page.route('**/new-review-fixture',r=>r.fulfill({contentType:'text/html',body:'<html>Test fixture</html>'}));await page.goto('/new-review-fixture');
 await page.evaluate(data=>new Promise<void>(resolve=>{const r=indexedDB.open('cijian-local-v1',2);r.onupgradeneeded=()=>{r.result.createObjectStore('state');r.result.createObjectStore('media');};r.onsuccess=()=>{const db=r.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put(data,'root');tx.oncomplete=()=>{db.close();resolve();};};}),JSON.parse(JSON.stringify(d)));await page.goto('/');
}

test('真实界面新词完成直接复习，暂停离线重开仍保持答案隐藏和相同进度',async({page,context})=>{
 const d=fixture(1);await seed(page,d);await page.getByRole('button',{name:'学习新词',exact:true}).click();await expect(page.locator('.study-answer')).toBeVisible();
 await page.getByRole('button',{name:'很熟悉'}).click();await expect(page.getByRole('button',{name:'立即复习这批新词'})).toBeVisible();
 await page.getByRole('button',{name:'立即复习这批新词'}).click();await expect(page.getByRole('heading',{name:'新词即时复习',exact:true})).toBeVisible();await expect(page.locator('.study-answer')).toHaveCount(0);
 await page.getByRole('button',{name:'暂停并保存'}).click();await expect(page.getByText('新词即时复习：还剩 1 词，无需等待到期')).toBeVisible();
 // The repeated review entry retains the existing 300ms leading-click guard.
 await page.waitForTimeout(320);
 await page.getByRole('button',{name:'开始复习',exact:true}).click();await expect(page.getByRole('heading',{name:'新词即时复习',exact:true})).toBeVisible();await expect(page.locator('.study-answer')).toHaveCount(0);
 await page.getByRole('button',{name:'暂停并保存'}).click();await page.reload();await page.getByRole('button',{name:'继续上次学习'}).click();await expect(page.getByRole('heading',{name:'新词即时复习',exact:true})).toBeVisible();
 await context.setOffline(true);await page.getByRole('button',{name:'查看答案',exact:true}).click();await expect(page.locator('.study-answer')).toBeVisible();await page.getByRole('button',{name:'3 记得',exact:true}).click();await expect(page.getByText('这一轮，完成了。')).toBeVisible();await context.setOffline(false);
});
