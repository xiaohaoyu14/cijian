import { test, expect } from '@playwright/test';

test('首页后台预热不自动发声、不改学习记录，点读仍由用户触发',async({page})=>{
  await page.route('**/src/speech.ts*',r=>r.fulfill({contentType:'text/javascript',body:`
    window.__speechTrace=[];
    export async function initialize(warmup=false){window.__speechTrace.push({op:'initialize',warmup});return {sampleRate:22050};}
    export async function speak(text){window.__speechTrace.push({op:'speak',text});return {};}
    export async function stop(){}
  `}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'四级 · 乱序词库',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).__speechTrace.filter((x: any)=>x.op==='initialize'&&x.warmup===true).length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__speechTrace.filter((x: any)=>x.op==='speak').length)).toBe(0);
  const count=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('cijian-local-v1');r.onsuccess=()=>{const db=r.result;const q=db.transaction('state').objectStore('state').get('root');q.onsuccess=()=>{resolve(q.result.cards.length+q.result.logs.length);db.close();};};}));
  expect(count).toBe(0);
  await page.getByRole('button',{name:'学习新词',exact:true}).click();
  await page.getByRole('button',{name:'朗读 access',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__speechTrace.filter((x: any)=>x.op==='speak'&&x.text==='access').length)).toBe(1);
});
