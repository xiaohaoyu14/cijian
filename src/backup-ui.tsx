import { useEffect, useRef, useState } from "react";
import type { Actions } from "./main";
import { Data, today } from "./types";
import { download, MAX_ARCHIVE } from "./library";
import { getData, hydrateMedia, restoreWithRecovery } from "./store";
import { createSave, inspectSave, SavePreview, saveSummary } from "./archive";
import { deviceInfo, renameDevice, loadConnection, saveConnection, forgetConnection, loadRecovery, lastCloudBackup, markCloudBackup, CloudConnection } from "./vault";
import { cloudUrl, listCloud, uploadCloud, downloadCloud, encryptSave, decryptSave, deleteCloud, CloudItem, MAX_CLOUD_BYTES } from "./cloud-client";

function useExclusive(a: Actions) {
  const [working, setWorking] = useState(false), lock = useRef(false);
  return { working, run: async (fn: () => Promise<unknown>, message?: string) => {
    if (lock.current) return;
    lock.current = true; setWorking(true);
    try { await a.run(fn, message); } finally { lock.current = false; setWorking(false); }
  } };
}
const time = (value?: string) => value ? new Date(value).toLocaleString("zh-CN") : "暂无";
export function BackupPanel({ d, a }: { d: Data; a: Actions }) {
  const [restore, setRestore] = useState<SavePreview>(), [hasRecovery, setHasRecovery] = useState(false);
  const [encrypted, setEncrypted] = useState<Uint8Array>(), [filePassword, setFilePassword] = useState("");
  const file = useRef<HTMLInputElement>(null), task = useExclusive(a);
  useEffect(() => { void loadRecovery().then(r => setHasRecovery(!!r)); }, []);
  const count = restore && saveSummary(restore.data);
  return <>
    <section className="panel">
      <div className="section-title"><h2>完整备份与恢复</h2></div>
      <p>完整备份包含词库、媒体、笔记、收藏、复习历史、学习暂停队列及所有考试快照。恢复前会先自动保存本机保护备份；校验和保护备份成功后才替换数据。</p>
      <p className="subtle">本机保留最近一次恢复前的保护备份；卸载应用也会删除它，请按需导出到应用外。</p>
      <div className="button-row">
        <button disabled={task.working} onClick={() => task.run(async () => download(`词间完整备份-${today()}.zip`, await createSave(await hydrateMedia(getData()), await deviceInfo())))}>导出完整备份</button>
        <button className="outline" disabled={task.working} onClick={() => file.current?.click()}>选择备份恢复</button>
        {hasRecovery && <button className="outline" disabled={task.working} onClick={() => task.run(async () => { const r = await loadRecovery(); if (r) setRestore(await inspectSave(r.bytes)); })}>查看上次保护备份</button>}
        {hasRecovery && <button className="text-button" disabled={task.working} onClick={() => task.run(async () => { const r = await loadRecovery(); if (r) await download(`词间保护备份-${r.at.slice(0, 10)}.zip`, r.bytes); })}>导出保护备份</button>}
        <input hidden ref={file} type="file" accept=".zip,.cjsave" onChange={e => {
          const f = e.target.files?.[0]; setRestore(undefined); setEncrypted(undefined); setFilePassword("");
          if (f) void task.run(async () => {
            if (f.size > MAX_CLOUD_BYTES) throw Error("备份最大50 MB（加密存档允许少量头信息）");
            const bytes = new Uint8Array(await f.arrayBuffer());
            if (/\.cjsave$/i.test(f.name)) setEncrypted(bytes); else setRestore(await inspectSave(bytes));
          });
          e.target.value = "";
        }} />
      </div>
      {encrypted && <div className="notice"><label>加密文件密码<input type="password" aria-label="加密文件密码" value={filePassword} onChange={e => setFilePassword(e.target.value)} /></label><div className="button-row">
        <button disabled={task.working} onClick={() => task.run(async () => { setRestore(await inspectSave(await decryptSave(encrypted, filePassword))); setEncrypted(undefined); setFilePassword(""); })}>解密并预览文件</button>
        <button className="outline" disabled={task.working} onClick={() => { setEncrypted(undefined); setFilePassword(""); }}>取消解密</button>
      </div></div>}
      {restore && count && <div className="notice" role="region" aria-label="恢复预览">
        <h3>待恢复备份</h3>
        {restore.manifest ? <p>创建时间：{time(restore.manifest.created)} · 来源：{restore.manifest.deviceName} · 版本：{restore.manifest.appVersion} · 文件完整性校验通过</p> : <p>旧版备份：未记录创建时间和来源设备，已通过内容结构校验。</p>}
        <p>{count.decks} 本词库，{count.entries} 个词条，{count.cards} 张学习卡片，{count.reviews} 条复习记录，{count.exams} 场考试，{count.media} 个媒体，{count.paused} 个未完成学习任务。</p>
        <p>将替换本机当前 {d.entries.length} 个词条和 {d.cards.length} 张卡片。考试原截止时间保留，不会重新计时。云连接密钥和存档密码不在备份中。</p>
        <div className="button-row"><button className="danger" disabled={task.working} onClick={() => task.run(async () => {
          await restoreWithRecovery(restore.data, getData()); setRestore(undefined); setHasRecovery(true);
        }, "完整备份已恢复，原本机数据已保存为保护备份")}>确认替换当前全部数据</button>
        <button className="outline" disabled={task.working} onClick={() => setRestore(undefined)}>取消</button></div>
      </div>}
    </section>
    <CloudPanel a={a} preview={setRestore} />
  </>;
}
function CloudPanel({ a, preview }: { a: Actions; preview: (p: SavePreview) => void }) {
  const [connection, setConnection] = useState<CloudConnection>(), [url, setUrl] = useState(""), [token, setToken] = useState("");
  const [name, setName] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [items, setItems] = useState<CloudItem[]>([]), [last, setLast] = useState<string>(), [remove, setRemove] = useState<CloudItem>();
  const task = useExclusive(a);
  useEffect(() => {
    let active = true;
    void Promise.all([loadConnection(), deviceInfo(), lastCloudBackup()]).then(([c, device, last]) => {
      if (!active) return;
      setName(device.name); setLast(last?.at);
      if (c) { setUrl(c.url); setToken(c.token); setConnection(c); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <section className="panel cloud-panel">
    <h2>云存档（手动备份）</h2>
    <p>连接你自己的存档服务后，可以加密上传和跨设备恢复。未连接时不发起云请求，全部本地功能正常使用。</p>
    <p className="subtle">第一版不自动上传或合并记录。每次上传独立保存，空白新手机不会自动覆盖旧存档。</p>
    <div className="cloud-fields">
      <label>云服务地址<input aria-label="云服务地址" placeholder="https://你的存档服务地址" value={url} onChange={e => setUrl(e.target.value)} disabled={task.working || !!connection} /></label>
      <label>连接密钥<input aria-label="云连接密钥" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} disabled={task.working || !!connection} /></label>
      <label>本机名称<input aria-label="本机名称" maxLength={80} value={name} onChange={e => setName(e.target.value)} disabled={task.working} /></label>
    </div>
    <div className="button-row">
      {!connection ? <button disabled={task.working || !url || !token} onClick={() => task.run(async () => {
        const c = { url: cloudUrl(url), token: token.trim() }; const rows = await listCloud(c);
        await saveConnection(c); await renameDevice(name); setConnection(c); setItems(rows);
      }, "云服务已连接，尚未上传本机记录")}>连接云存档</button> : <>
        <button className="outline" disabled={task.working} onClick={() => task.run(async () => setItems(await listCloud(connection)))}>刷新云存档</button>
        <button className="text-button" disabled={task.working} onClick={() => task.run(async () => { await forgetConnection(); setConnection(undefined); setToken(""); setItems([]); setPassword(""); setConfirm(""); setRemove(undefined); })}>断开云连接</button>
      </>}
    </div>
    <p role="status">{connection ? "已保存连接，可手动刷新列表" : "尚未连接云服务"} · 本机最近成功上传：{time(last)}</p>
    {connection && <>
      <div className="cloud-fields">
        <label>存档密码<input aria-label="存档密码" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} disabled={task.working} /></label>
        <label>再次输入存档密码（上传时）<input aria-label="确认存档密码" type="password" autoComplete="off" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={task.working} /></label>
      </div>
      <p>密码至少12字，可用一段长短语。密码只在本次页面内存中使用，不保存、不上传；换手机恢复时需要相同密码，遗忘后无法解密。云端可看到存档时间、设备名称、版本与文件大小，词库和个人记录均已加密。</p>
      <button disabled={task.working} onClick={() => task.run(async () => {
        if (password !== confirm) throw Error("两次存档密码不一致");
        if (!name.trim()) throw Error("请填写本机名称");
        const device = await renameDevice(name), data = await hydrateMedia(getData());
        const encrypted = await encryptSave(await createSave(data, device), password, device.name);
        const item = await uploadCloud(connection, encrypted.id, encrypted.bytes);
        await markCloudBackup({ at: item.created, id: item.id }); setLast(item.created);
        setItems(await listCloud(connection)); setPassword(""); setConfirm("");
      }, "加密存档已上传；上传之后的新操作仍需再次备份")}>立即云备份</button>
      {task.working && <p role="status">正在连接、校验或处理存档，请稍候…</p>}
      <h3>历史云存档</h3>
      {!items.length && <p>列表尚无存档；可先刷新，或手动备份本机记录。</p>}
      <div className="cloud-history">{items.map(item => <article key={item.id} className="cloud-save">
        <p><strong>{item.deviceName}</strong> · {time(item.created)}</p><p className="subtle">版本 {item.appVersion} · {(item.bytes / 1024 / 1024).toFixed(2)} MB · {item.id.slice(0, 8)}</p>
        <div className="button-row"><button className="outline small" disabled={task.working} onClick={() => task.run(async () => {
          const bytes = await downloadCloud(connection, item), zip = await decryptSave(bytes, password);
          preview(await inspectSave(zip)); setPassword(""); setConfirm("");
        }, "云存档已校验解密，请在上方确认恢复；本机数据尚未替换")}>预览恢复此存档</button>
        <button className="text-button" disabled={task.working} onClick={() => task.run(async () => download(`词间加密存档-${item.id}.cjsave`, await downloadCloud(connection, item), "application/octet-stream"))}>下载加密文件</button>
        <button className="text-button" disabled={task.working} onClick={() => setRemove(item)}>删除云存档</button></div>
      </article>)}</div>
      {remove && <div className="notice"><p>删除 {remove.deviceName} 在 {time(remove.created)} 的这一份云存档？本机学习记录不受影响，云端文件删除后无法找回。</p><div className="button-row">
        <button className="danger" disabled={task.working} onClick={() => task.run(async () => { await deleteCloud(connection, remove.id); setRemove(undefined); setItems(await listCloud(connection)); }, "已删除所选云存档")}>确认删除云存档</button>
        <button className="outline" disabled={task.working} onClick={() => setRemove(undefined)}>取消删除</button>
      </div></div>}
    </>}
  </section>;
}
