import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { emptyData } from '../src/types';
import { parseTxt } from '../src/txt-import';
import { readDictionaryFile } from '../src/dictionary';
import { parseImport, commitImport, backup, readBackup } from '../src/library';
import { createExam } from '../src/exam';
import { applyRating, rate } from '../src/scheduler';
const bundled = JSON.parse(readFileSync('content.lock.json', 'utf8'));

const sources=[{...bundled,asset:'builtin-cet4.pack'},...bundled.additional];
async function combined(){
 const d=emptyData();
 for(const s of sources)commitImport(d,await parseImport(new File([readFileSync('public/'+s.asset)],s.name+'.zip'),d));
 return d;
}
test('真实六级与SAT原始TXT清洗、转换包与原文件对应',async()=>{
 for(const [file,count,invalid,duplicates] of [['4 六级-乱序.txt',5617,0,34],['7 SAT-乱序.txt',8810,1,76]] as const){
  const clean=await readDictionaryFile(new File([readFileSync(file)],file));
  expect(clean.words).toHaveLength(count);expect(clean.invalid).toBe(invalid);expect(clean.duplicates).toBe(duplicates);
 }
 const sat=await readDictionaryFile(new File([readFileSync('7 SAT-乱序.txt')],'SAT.txt'));
 expect(sat.words.some(w=>w.word==='cliché')).toBe(true);
 expect(sat.words.find(w=>w.word==='account for')?.pos).toBe('');
 expect(sat.words.some(w=>w.word==='outright'&&w.pos==='adj./adv.')).toBe(true);
 for(const s of sources){
  const bytes=readFileSync('public/'+s.asset);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(s.sha256);
  const p=await parseImport(new File([bytes],s.name+'.zip'),emptyData());
  expect(p.errors).toEqual([]);expect(p.rows).toHaveLength(s.entryCount);
 }
});
test('三库18735条完整备份往返，共享词条不重建学习卡，可生成100词混合卷',async()=>{
 const start=performance.now(),d=await combined(),loadMs=performance.now()-start;
 expect(d.entries).toHaveLength(bundled.combined.uniqueEntries);expect(d.links).toHaveLength(bundled.combined.links);
 const shared=d.entries.find(e=>d.links.filter(l=>l.entryId===e.id).length>1)!;
 expect(shared).toBeTruthy();applyRating(d,await rate(d,shared.id,3));
 d.notes.push({entryId:shared.id,text:'三库共享笔记',favorite:true,reinforce:false});
 for(const source of sources.slice(1))commitImport(d,await parseImport(new File([readFileSync('public/'+source.asset)],source.name+'.zip'),d));
 expect(d.entries).toHaveLength(bundled.combined.uniqueEntries);expect(d.cards).toHaveLength(1);expect(d.logs).toHaveLength(1);
 for(const deck of d.decks){
  const exam=createExam(d,{decks:[deck.id],scope:'all',tag:'',count:100,type:'mixed',ratios:[25,25,25,25],minutes:0,practice:false});
  expect(new Set(exam.items.map(i=>i.entryId)).size).toBe(100);d.exams.push(exam);
 }
 const packed=backup(d),restored=readBackup(packed);
 expect(restored.entries).toEqual(d.entries);expect(restored.notes).toEqual(d.notes);expect(restored.cards).toEqual(JSON.parse(JSON.stringify(d.cards)));expect(restored.exams).toEqual(d.exams);
 writeFileSync('validation/three-deck-test.json',JSON.stringify({platform:'Desktop test runner, not Android',entries:d.entries.length,links:d.links.length,loadMs,backupBytes:packed.length,exams:d.exams.length},null,2));
});
test('SAT实际TXT手机预览分页、查找后全量导入，重开并生成100词卷',async({page})=>{
 test.setTimeout(60000);await page.setViewportSize({width:412,height:915});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('heading',{name:'SAT · 乱序词库',exact:true})).toBeVisible({timeout:20000});
 await page.getByRole('link',{name:'我的词库',exact:true}).click();
 await page.locator('input[type=file]').first().setInputFiles('7 SAT-乱序.txt');
 const dialog=page.getByRole('dialog',{name:'导入预览'});await expect(dialog).toBeVisible();
 await expect(dialog.locator('.preview-row')).toHaveCount(100);
 await dialog.getByRole('button',{name:'预览下一页',exact:true}).click();await expect(dialog.getByText('第 2 / 89 页',{exact:true})).toBeVisible();
 await dialog.getByLabel('查找预览词条').fill('cliché');await expect(dialog.locator('.preview-row')).toHaveCount(1);
 await dialog.getByRole('button',{name:'确认导入 8810 条',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:20000});
 await page.reload();await page.getByRole('link',{name:'个人考试',exact:true}).click();
 await page.getByRole('button',{name:'100 词',exact:true}).click();await page.getByRole('button',{name:'生成试卷并预览信息',exact:true}).click();await page.getByRole('button',{name:'开始考试',exact:true}).click();
 await expect(page.locator('.answer-grid button')).toHaveCount(100);expect(errors).toEqual([]);
});
