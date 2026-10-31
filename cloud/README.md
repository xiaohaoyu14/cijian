# 词间独立云存档服务（手动存档，3.3.0）

服务端可运行，未替用户部署到公网，也没有预置可用的公共云地址。本服务使用Node.js 24，不需要npm安装依赖。APK仅arm64-v8a；云功能需要你自己的HTTPS服务。

## 初始化和运行

从交付的服务端ZIP解压后，在该目录执行：

```sh
node server.mjs init
node server.mjs
```

完整项目中对应 `npm run cloud:init`、`npm run cloud:serve`。只初始化一次；再次init会拒绝覆盖已有配置和连接密钥。

默认私有数据目录为当前目录的`.cloud-private/`，含`config.json`、`access-key.txt`和`saves/`。它不是网页静态目录，不应对外公开、提交或放进APK。服务只监听127.0.0.1:8787，不会开放本机防火墙。需要改变私有目录时：

```powershell
# Windows PowerShell
$env:CIJIAN_CLOUD_DIR = 'D:\cijian-private'
node server.mjs init
node server.mjs
```

```sh
# Linux，目录需由运行服务的用户拥有
export CIJIAN_CLOUD_DIR=/var/lib/cijian-save
node server.mjs init
node server.mjs
```

`PORT`可改变监听端口。Node进程需作为长期服务运行；同一私有目录只运行一个进程，禁止直接启动多个副本共同写入。服务重启会从磁盘读取既有存档。

## HTTPS入口

准备自己的域名、服务器和可信TLS证书；APK不接受HTTP云地址，不关闭证书校验。可使用已有反向代理，或按`Caddyfile.example`将HTTPS入口转发到127.0.0.1:8787：

```caddyfile
save.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

将示例域名换成真实域名，DNS应指向服务器，代理所需80/443端口需由服务器管理者配置。Caddy的自动HTTPS条件及反向代理方法见[官方反向代理文档](https://caddyserver.com/docs/quick-starts/reverse-proxy)与[自动HTTPS文档](https://caddyserver.com/docs/automatic-https)。本项目没有替你安装Caddy、购买域名、开放端口或签发公网证书。

`config.json`中的`origins`默认仅`https://localhost`，对应当前安卓Capacitor应用的页面来源。浏览器开发测试如需连接，可增加明确的开发来源（例如`http://127.0.0.1:4173`），不要使用通配符。请求仍必须携带连接密钥；来源检查不替代鉴权。

## 手机连接

设置→云存档：

1. 填HTTPS服务地址（不含`/v1/backups`）、`access-key.txt`内的连接密钥、本机名称。
2. 点击「连接云存档」；连接成功只保存连接，不会上传学习记录。
3. 输入至少12字的存档密码并再次确认，点击「立即云备份」。
4. 第二台设备填写相同服务地址和连接密钥，刷新历史，输入对应存档密码，点击「预览恢复此存档」。
5. 对照预览后确认恢复。本机原数据先保存为保护备份，保护保存失败或恢复写入失败则不替换当前数据。

连接密钥只负责访问自己的一组存档；存档密码负责解密，二者不是同一用途。连接密钥保存在应用私有IndexedDB的独立vault中，不进入完整备份；第一版尚未使用安卓硬件密钥库。存档密码只在当前设置页面内存中使用，不保存、不发送给服务。遗忘存档密码无法找回密文内容。

## 容量和历史

默认每个连接身份最多10份、合计512MiB。满后拒绝新上传，不自动删旧存档，也不覆盖旧版本；可先下载加密文件再明确删除旧存档。`maxItems`可在配置中设为1–100，`quotaBytes`可设置空间上限。一次完整ZIP仍最大50MiB，解压100MiB、单文件10MiB，沿用应用原有限制；加密头另有少量空间。

服务按身份隔离目录。每次上传有独立UUID；相同UUID相同内容重试幂等，内容不同拒绝。文件SHA-256校验后，将密文与元数据写入临时目录并同步文件，再原子发布完整目录。失败时清理临时目录。服务不读取或解密词条/笔记；云端可见时间、设备名、应用版本、大小和文件摘要。服务数据持久保存在本机磁盘，服务器自身也应备份私有目录；这不是已有商业云托管服务。

## 文件与恢复

新版ZIP带`save-manifest.json`，记录来源设备、创建时间、应用版本、内容统计和各文件SHA-256。旧版`backup.json`格式仍可读，会明确提示缺少来源信息；结构校验仍执行。

云存档是客户端加密的`.cjsave`容器；下载后即使服务不可用，也能在「选择备份恢复」中选择该文件，输入密码，离线解密预览。使用Web Crypto的AES-256-GCM、随机16字节盐/12字节IV、PBKDF2-HMAC-SHA256 600000次派生，头信息参与认证。参考[MDN Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)和[OWASP工作因子建议](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。这不是声称通过第三方安全审计。

本机保护备份只保留最近一次恢复前的完整ZIP，存在`cijian-vault-v1/private/recovery`。它是本机恢复点，不代表已上传云端；可以查看、恢复或导出。卸载/清除数据也会删除它。恢复不合并两机记录，考试快照和原截止时间保留，原Piper模型随APK提供不上传。

## 已验证与未完成

已验证存档校验、旧文件兼容、错密码、密文篡改、身份隔离、并发容量、幂等、防覆盖、服务重建持久化、两份独立客户端恢复、保护备份、失败回滚与离线加密文件恢复。具体测试结果见主项目交付说明。

尚未提供自动备份、Wi-Fi调度、实时双向同步、账号注册/密码找回、服务多副本部署。本次公网部署和安卓真机跨设备恢复尚未实测。本机生产构建HTTPS测试使用仅测试环境信任的自签证书，不放宽APK的证书检查，也不把自签测试证书用于公网部署。
