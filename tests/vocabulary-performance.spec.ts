import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { emptyData } from '../src/types';
import { parseImport, commitImport } from '../src/library';
import { vocabularyIndex, vocabularyCounts, searchVocabulary, WORD_PAGE_SIZE } from '../src/vocabulary-index';
import { addDemo } from '../src/demo';

test('词库索引保留共享词条、独立义项和原顺序，计数与收藏正确且不修改个人数据',()=>{
 const d=emptyData();addDemo(d);const deck=d.decks[0].id,first=d.entries[0],other=d.entries[1];
 d.decks.push({...d.decks[0],id:'second',name:'第二库'});d.links.push({deckId:'second',entryId:first.id},{deckId:'second',entryId:other.id});
 d.cards.push({id:first.id+':en-zh',entryId:first.id,direction:'en-zh',fsrs:{dueAt:new Date(Date.now()-1000)}});
 d.notes.push({entryId:first.id,text:'保留笔记',favorite:true,reinforce:false});
 const before=structuredClone(d),index=vocabularyIndex(d);
 expect(vocabularyCounts(index).get(deck)).toEqual({all:120,fresh:119,learning:1,due:1});expect(vocabularyCounts(index).get('second')).toEqual({all:2,fresh:1,learning:1,due:1});
 expect(vocabularyCounts(index,Date.now()-60000).get(deck)?.due).toBe(0);
 expect(index.notes.get(first.id)?.text).toBe('保留笔记');expect(searchVocabulary(index,'second','').map(e=>e.id)).toEqual([first.id,other.id]);
 expect(searchVocabulary(index,'',' CAMPUS ').map(e=>e.id)).toEqual([first.id]);expect(searchVocabulary(index,'','校园').map(e=>e.id)).toEqual([first.id]);
 expect(searchVocabulary(index,'missing','')).toEqual([]);expect(searchVocabulary(index,'','大学生活').length).toBeGreaterThan(1);expect(d).toEqual(before);
});

test('真实18735词与全量测试卡片只扫描一次卡片，不按词库词数反复查找',async()=>{
 const lock=JSON.parse(readFileSync('content.lock.json','utf8')),d=emptyData();
 for(const s of [{...lock,asset:'builtin-cet4.pack'},...lock.additional])commitImport(d,await parseImport(new File([readFileSync('public/'+s.asset)],s.name+'.zip'),d));
 let visits=0;d.cards=d.entries.map(e=>({id:e.id+':en-zh',get entryId(){visits++;return e.id;},direction:'en-zh' as const,fsrs:{dueAt:new Date(Date.now()-1000)}}));
 const start=performance.now(),index=vocabularyIndex(d),indexMs=performance.now()-start;
 expect(visits).toBeLessThanOrEqual(d.entries.length*2);expect(index.linked.size).toBe(18735);expect(searchVocabulary(index,'','')).toHaveLength(18735);
 for(const deck of d.decks){const count=vocabularyCounts(index).get(deck.id)!;expect(count.learning).toBe(count.all);expect(count.fresh).toBe(0);expect(count.due).toBe(count.all);}
 writeFileSync('validation/vocabulary-index-benchmark.json',JSON.stringify({platform:'Desktop test runner; test-only synthetic cards, not Android performance or user history',entries:d.entries.length,cardPropertyReads:visits,indexMs,renderPageSize:WORD_PAGE_SIZE},null,2));
});

test('真实三库手机词条每页50条，可访问末页、收藏与全库搜索，切库回第一页',async({page})=>{
 await page.setViewportSize({width:390,height:844});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'SAT · 乱序词库',exact:true})).toBeVisible();
 const metadata=await page.evaluate(()=>new Promise<any>(resolve=>{const r=indexedDB.open('cijian-local-v1');r.onsuccess=()=>{const db=r.result,q=db.transaction('state').objectStore('state').get('root');q.onsuccess=()=>{resolve({last:q.result.entries.at(-1).word,total:q.result.entries.length});db.close();};};}));
 await page.getByRole('link',{name:'我的词库',exact:true}).click();const rows=page.locator('.entry-row'),pagination=page.getByRole('navigation',{name:'词条分页'});
 await expect(rows).toHaveCount(50);await expect(pagination).toContainText('共 18735 条');
 const first=await rows.first().locator('strong').textContent();await pagination.getByRole('button',{name:'词条下一页',exact:true}).click();await expect(rows.first().locator('strong')).not.toHaveText(first!);await expect(pagination).toContainText('第 2 / 375 页');
 await pagination.getByRole('button',{name:'词条末页',exact:true}).click();await expect(rows).toHaveCount(35);await expect(rows.last().locator('strong')).toHaveText(metadata.last);
 await rows.last().getByRole('button',{name:'收藏 '+metadata.last,exact:true}).click();await expect(rows.last().locator('svg[fill="#c59444"]')).toHaveCount(1);await expect(pagination).toContainText('第 375 / 375 页');
 await page.getByLabel('搜索词条',{exact:true}).fill(metadata.last);await expect(pagination).toContainText('第 1 /');await expect(rows.locator('strong').filter({hasText:metadata.last}).first()).toBeVisible();
 await page.getByLabel('搜索词条',{exact:true}).fill('');await expect(rows).toHaveCount(50);await expect(pagination).toContainText('第 1 / 375 页');
 const sat=page.locator('.library-card').filter({has:page.getByRole('heading',{name:'SAT · 乱序词库',exact:true})});await sat.getByRole('button',{name:'浏览词库 →',exact:true}).click();await expect(pagination).toContainText('共 8810 条');
 await pagination.getByRole('button',{name:'词条末页',exact:true}).click();await expect(rows).toHaveCount(10);
 const cet=page.locator('.library-card').filter({has:page.getByRole('heading',{name:'四级 · 乱序词库',exact:true})});await cet.getByRole('button',{name:'浏览词库 →',exact:true}).click();await expect(rows).toHaveCount(50);await expect(pagination).toContainText('共 4543 条 · 第 1 / 91 页');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
