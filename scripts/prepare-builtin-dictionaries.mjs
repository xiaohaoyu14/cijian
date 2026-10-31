import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { parseDictionary } from '../src/dictionary.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
const lock=JSON.parse(readFileSync('content.lock.json','utf8'));
const reports=[],additional=[];
for(const [file,id,name,tag] of [
 ['4 六级-乱序.txt','cet6-shuffled','六级 · 乱序词库','六级'],
 ['7 SAT-乱序.txt','sat-shuffled','SAT · 乱序词库','SAT'],
]){
 const source=readFileSync(file);const cleaned=parseDictionary(source.toString('utf8'));
 if(cleaned.words.length>10000)throw Error('词数超过每包上限');
 const entries=cleaned.words.map(w=>{const eid='text:'+sha(w.id);return {id:eid,word:w.word,phonetic:'',phrase:'',tags:[tag],senses:[{id:eid+':s1',pos:w.pos,zh:w.meaning,acceptedZh:[],variants:[],examples:[]}]};});
 const manifest={id,name,author:'未注明',version:'1.0',language:'en',source:'用户提供的 '+file,license:'原始文件未注明授权；由用户提供',tags:[tag]};
 const bytes=zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'entries.json':strToU8(JSON.stringify(entries))},{level:6});
 const asset='builtin-'+(id==='cet6-shuffled'?'cet6':'sat')+'.pack';
 writeFileSync('public/'+asset,bytes);
 additional.push({...manifest,entryCount:entries.length,bytes:bytes.length,sha256:sha(bytes),asset});
 reports.push({file,sourceSha256:sha(source),sourceBytes:source.length,valid:entries.length,blank:cleaned.blank,invalid:cleaned.invalid,duplicates:cleaned.duplicates,issues:cleaned.issues,missingPos:entries.filter(e=>!e.senses[0].pos).length});
}
lock.additional=additional;
const allSources=[{...lock,asset:'builtin-cet4.pack'},...additional];
const norm=s=>s.normalize('NFKC').trim().toLowerCase();
const identities=new Set();
for(const src of allSources){const entries=JSON.parse(strFromU8(unzipSync(readFileSync('public/'+src.asset))['entries.json']));for(const e of entries)identities.add(JSON.stringify([norm(e.word),e.senses.map(s=>[norm(s.pos),norm(s.zh)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));}
lock.combined={deckCount:3,links:allSources.reduce((n,s)=>n+s.entryCount,0),uniqueEntries:identities.size};
writeFileSync('content.lock.json',JSON.stringify(lock,null,2)+'\n');
writeFileSync('validation/builtin-conversion.json',JSON.stringify({sources:reports,combined:lock.combined},null,2)+'\n');
console.log(JSON.stringify({sources:reports,combined:lock.combined},null,2));
