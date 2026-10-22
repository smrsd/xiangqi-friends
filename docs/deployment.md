# 部署与维护

公网入口：https://xiangqi-friends-smrsd.thelittleprince.chatgpt.site/

Sites 托管 Cloudflare Worker 与 D1 数据库，站点允许公网访问，棋友在游戏内独立注册用户名和密码。无需朋友登录 ChatGPT。服务器不会使用客户端传来的用户 ID 授权操作；通过会话摘要查询身份，并验证房间成员、游戏 ID、当前回合与棋盘步数。

`node scripts/build.mjs` 将网页资源和规则/API 合成 `dist/server/index.js`，并将 `.openai/hosting.json` 与追加式 `drizzle` SQL 迁移放入部署产物。更新时使用 Sites 技能的源仓库与打包发布流程；必须先同步确切源码提交，再保存版本并发布。GitHub 推送会运行验证，**不会自动发布 Sites**。

数据库迁移已应用的文件不得修改，应新增 SQL 和 journal 条目。数据库不可存于浏览器 localStorage，也不能把内存状态当作持久存储。本地 SQLite 和公网 D1 是独立数据库。不要把本地 QA 账号迁入正式库。

密码使用随机盐 PBKDF2-SHA256（100,000 次），会话随机 256 位，仅 SHA256 摘要入库，7 天过期。浏览器令牌仅放在 sessionStorage，关闭标签页或应用进程需重新登录。API 限制请求大小、注册/登录/操作频率，数据库语句参数化；网页配置 CSP 并转义用户内容。站点仅通过 HTTPS 提供公网服务。

每位用户只能占据一个棋室，但浏览大厅不改变棋室归属。所有房间成员和游戏操作以同一 CAS 行序列化，避免并发入座或走棋相互覆盖。对局超时在下一次 API 同步时由服务端判定；无人在线时数据库中的超时状态在下次登录后补结算，胜负依据既定截止时间。

为小规模朋友局选择 2 秒轮询，暂不使用 WebSocket。超过 100 间房或需要大量在线用户时应分房间存储、引入推送和独立历史战绩库。账号目前没有自助找回，请提醒朋友牢记密码。

本地服务默认只监听 127.0.0.1:3100。如确需局域网访问，可设置 `HOST=0.0.0.0` 并配置本机防火墙；公网使用上述托管服务。

参考：[D1 官方 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Android WebView 官方说明](https://developer.android.com/develop/ui/views/layout/webapps/webview)。
