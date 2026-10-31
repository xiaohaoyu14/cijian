import { test, expect, Page } from '@playwright/test';

async function open(page:Page){
 await page.route('**/src/builtin.ts*',r=>r.fulfill({contentType:'text/javascript',body:'export async function installBuiltin(){return false;}'}));
 await page.addInitScript(()=>{
   const original=Element.prototype.animate;
   Element.prototype.animate=function(...args:Parameters<Element['animate']>){
     const animation=original.apply(this,args);
     // Freeze page motion so input can be tested while a transition is in progress.
     if(this.matches('main.content'))animation.pause();
     return animation;
   };
 });
 await page.goto('/');await page.getByRole('button',{name:'添加示例',exact:true}).click();
 await expect(page.getByRole('heading',{name:'四级起步 · 示例词库',exact:true})).toBeVisible();
}
async function motion(page:Page){return page.locator('main.content').evaluate(el=>{
 const a=el.getAnimations().find(a=>a.id==='page-slide');const e=a?.effect as KeyframeEffect|undefined;
 return a&&e?{state:a.playState,duration:e.getTiming().duration,frames:e.getKeyframes().map(f=>f.transform)}:null;
});}

test('页面滑入220ms；转场中仍可输入与开弹窗，不重复挂载或重启动画',async({page})=>{
 await open(page);await page.getByRole('link',{name:'偏好设置',exact:true}).click();
 await expect.poll(()=>motion(page)).toMatchObject({duration:220,frames:['translateX(16px)','none']});
 await expect(page.locator('main.content')).toHaveCount(1);
 const input=page.locator('input[type="number"]').first();await input.fill('17');await expect(input).toHaveValue('17');
 await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(input).toHaveValue('17');expect(await motion(page)).toBeNull();
 await page.getByRole('link',{name:'我的词库',exact:true}).click();await expect.poll(()=>motion(page)).toMatchObject({frames:['translateX(-16px)','none']});
 await page.getByRole('button',{name:/^编辑词库 /}).first().click();expect(await motion(page)).toBeNull();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 const backdrop=await page.locator('.modal-backdrop').boundingBox(),viewport=page.viewportSize()!;
 expect(backdrop!.x).toBe(0);expect(backdrop!.y).toBe(0);expect(backdrop!.width).toBe(viewport.width);expect(backdrop!.height).toBe(viewport.height);
});

test('按压缩放仅在按下期间生效，松开恢复；减少动画立即取消转场和缩放',async({page})=>{
 await open(page);const button=page.getByRole('button',{name:'学习新词',exact:true});
 const bounds=(await button.boundingBox())!;await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();
 await expect.poll(()=>button.evaluate(el=>getComputedStyle(el).transform)).toBe('matrix(0.95, 0, 0, 0.95, 0, 0)');
 await page.mouse.move(1,1);await page.mouse.up();await expect.poll(()=>button.evaluate(el=>getComputedStyle(el).transform)).toBe('none');
 await page.getByRole('link',{name:'偏好设置',exact:true}).click();await expect.poll(()=>motion(page)).not.toBeNull();
 await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>motion(page)).toBeNull();
 await page.getByRole('link',{name:'今日学习',exact:true}).click();expect(await motion(page)).toBeNull();
 await button.focus();await page.keyboard.down('Space');expect(await button.evaluate(el=>getComputedStyle(el).transform)).toBe('none');await page.keyboard.up('Space');
});

test('手机连续切页与浏览器返回保持单页，转场可立即打断并学习新词',async({page})=>{
 await page.setViewportSize({width:390,height:844});await open(page);
 for(const name of ['个人考试','学习统计','偏好设置'])await page.getByRole('link',{name,exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goBack();await expect(page.getByRole('heading',{name:'学习统计',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'今日学习',exact:true}).click();
 await page.getByRole('button',{name:'学习新词',exact:true}).click();await expect(page.getByRole('heading',{name:'学习新词',exact:true})).toBeVisible();
 await expect(page.locator('main.content')).toHaveCount(1);await expect(page.locator('.study-card')).toHaveCount(1);
 await page.getByRole('button',{name:'3 记得',exact:true}).click();await expect(page.getByText('2 / 20',{exact:true})).toBeVisible();expect(await motion(page)).toBeNull();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
