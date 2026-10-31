import { test, expect } from '@playwright/test';
import { emptyData } from '../src/types';
import { addDemo } from '../src/demo';
import { selectStudy, selectedStudyDeck, pendingStudy } from '../src/learning';
import { applyRating, rate } from '../src/scheduler';
import { backup, readBackup } from '../src/library';

function fixture(){
 const d=emptyData();addDemo(d);const original=d.decks[0];
 d.decks=['a','b','c'].map(id=>({...original,id,name:id}));
 const [a,b,c,e]=d.entries;
 d.links=[{deckId:'a',entryId:a.id},{deckId:'a',entryId:b.id},{deckId:'b',entryId:b.id},{deckId:'b',entryId:c.id},{deckId:'c',entryId:e.id}];
 return d;
}
test('按词库抽新词和到期复习，切换后独立恢复，备份保留选择和队列',async()=>{
 const d=fixture();expect(selectedStudyDeck(d)).toBe('a');
 selectStudy(d,'new');const firstA=structuredClone(d.study!);
 expect(d.study!.ids).toEqual(d.links.filter(l=>l.deckId==='a').map(l=>l.entryId));
 applyRating(d,await rate(d,d.study!.ids[0],1));
 d.settings.studyDeckId='b';expect(pendingStudy(d)).toBeUndefined();selectStudy(d,'new');
 expect(d.study!.ids).toEqual(d.links.filter(l=>l.deckId==='b').map(l=>l.entryId));
 applyRating(d,await rate(d,d.study!.ids[0],3));const secondB=structuredClone(d.study!);
 d.settings.studyDeckId='a';expect(pendingStudy(d)?.index).toBe(1);selectStudy(d,'new');
 expect(d.study!.ids).toEqual(firstA.ids);expect(d.study!.index).toBe(1);expect(d.cards).toHaveLength(2);
 const restored=readBackup(backup(d));restored.settings.studyDeckId='b';selectStudy(restored,'new');
 expect(JSON.parse(JSON.stringify(restored.study))).toEqual(JSON.parse(JSON.stringify(secondB)));
 d.cards[0].fsrs.dueAt=new Date(Date.now()-1000);d.cards[1].fsrs.dueAt=new Date(Date.now()+86400000);
 d.settings.studyDeckId='b';expect(()=>selectStudy(d,'review')).toThrow('当前没有');
 d.settings.studyDeckId='a';selectStudy(d,'review');expect(d.study!.ids).toEqual([firstA.ids[0]]);
});
test('旧混合学习队列保留，选择全部词库后仍能续学；已删除词库选择自动回退',()=>{
 const d=fixture();const old={ids:d.entries.slice(0,8).map(e=>e.id),index:3,mode:'new' as const};d.study=old;
 selectStudy(d,'new');expect(d.study!.deckId).toBe('a');
 d.settings.studyDeckId='';selectStudy(d,'new');expect(d.study).toBe(old);expect(d.study!.index).toBe(3);
 d.settings.studyDeckId='deleted';expect(selectedStudyDeck(d)).toBe('a');
});
test('手机首页默认四级，可选择SAT和六级学新词，重开与切回保持各自进度',async({page})=>{
 test.setTimeout(60000);await page.setViewportSize({width:412,height:915});
 await page.goto('/');const picker=page.getByLabel('学习词库',{exact:true});await expect(picker).toBeVisible();
 const cet4=await picker.locator('option').filter({hasText:'四级 · 乱序词库'}).getAttribute('value');
 const cet6=await picker.locator('option').filter({hasText:'六级 · 乱序词库'}).getAttribute('value');
 const sat=await picker.locator('option').filter({hasText:'SAT · 乱序词库'}).getAttribute('value');
 await expect(picker).toHaveValue(cet4!);
 await expect(page.getByLabel('学习词库选择')).toContainText('4543 个词条');
 await picker.selectOption(sat!);await expect(page.getByLabel('学习词库选择')).toContainText('8810 个词条');
 await page.getByRole('button',{name:'学习新词',exact:true}).click();
 await expect(page.getByRole('button',{name:'朗读 pharmacy',exact:true})).toBeVisible();
 const inScope=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('cijian-local-v1');r.onsuccess=()=>{const db=r.result,q=db.transaction('state').objectStore('state').get('root');q.onsuccess=()=>{const d=q.result,allowed=new Set(d.links.filter((l:any)=>l.deckId===d.settings.studyDeckId).map((l:any)=>l.entryId));resolve(d.study.ids.every((id:string)=>allowed.has(id)));db.close();};};}));
 expect(inScope).toBe(true);
 await page.getByRole('button',{name:'3 记得',exact:true}).click();await page.getByRole('button',{name:'暂停并保存'}).click();
 await picker.selectOption(cet6!);await page.getByRole('button',{name:'学习新词',exact:true}).click();
 await expect(page.getByRole('button',{name:'朗读 consistent',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'暂停并保存'}).click();await picker.selectOption(sat!);
 await expect(page.getByLabel('学习词库选择')).toContainText('当前词库：SAT · 乱序词库');
 await page.reload();await expect(picker).toHaveValue(sat!);await page.getByRole('button',{name:'继续上次学习',exact:true}).click();
 await expect(page.getByText('2 / 20',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'暂停并保存'}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'deliverables/首页选择词库-手机.png',fullPage:true});
});
