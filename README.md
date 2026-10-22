# 棋友 · Xiangqi Friends

中国象棋朋友棋室，网页和 Android 客户端共用账号、好友和棋局。

网址：https://xiangqi-friends-smrsd.thelittleprince.chatgpt.site/

## 一起下棋

1. 每位朋友打开网址，分别注册账号并登录。
2. 一人创建棋室，把六位房间码发给另一人。
3. 另一人在大厅点击“房间码加入”，双方准备后自动开局。
4. 点击自己的棋子，再点击绿色提示位置落子。红先黑后。
5. 对局中可以返回大厅、查看在线用户和好友；棋局保留，计时继续。

支持好友申请与双向确认、通过用户名添加离线好友、全部在线用户、房间闲聊、断线续局、棋谱、和棋、认输与交换红黑再来一局。

## 本地运行

需要 Node.js 24+，无运行时 npm 依赖。

```powershell
cd D:\CodeInD\xiangqi-friends
D:\Dev\nodejs\node.exe scripts/dev.mjs
```

打开 http://127.0.0.1:3100/ 。账号、好友和棋局保存在 `.data/xiangqi.sqlite`；重启保留。多人本地测试使用不同浏览器或不同标签页，登录凭证存于各标签页的 sessionStorage。

```powershell
node --test tests/*.test.mjs
node scripts/build.mjs
node scripts/validate-artifact.mjs
.\android\test.ps1
.\android\build.ps1
```

Android 安装包：`android/build/xiangqifriends-debug.apk`，是原生 Java WebView 客户端，需要联网，默认连接上面的公网网址。当前为调试签名，可侧载；Google Play 发布需配置自己的正式签名与发布流程。没有真机连接时不宣称已通过真机测试。

## 规则约定

服务端校验车、马、象、士、将、炮、兵走法、蹩马腿、塞象眼、九宫、过河、将帅照面和应将。将死、困毙、认输或超时判负。每步 5 分钟，离线或返回大厅时继续计时。三次重复局面、连续 120 个半回合未吃子自动和棋；长将长捉也按此朋友局约定处理，未实现正式比赛裁决体系。双方可提议并确认和棋。

## 结构

- `src/game.mjs`：纯象棋规则与终局判定。
- `src/api.mjs`：账号、好友、在线用户、房间和服务端操作校验。
- `public/`：中文响应式网页与棋盘。
- `scripts/`：Node SQLite 开发服务和单文件 Worker 构建。
- `drizzle/`：追加式数据库迁移。
- `android/`：原生 Android 客户端、Gradle 项目与独立 SDK 构建脚本。
- `tests/`：规则测试与 API 集成测试。
- `.github/workflows/ci.yml`：网页验证和 APK 构建。

架构及部署见 [docs/deployment.md](docs/deployment.md)，安卓见 [docs/android.md](docs/android.md)，验证记录见 [docs/verification.md](docs/verification.md)。

## Git 管理

`main` 保持可运行；后续功能使用 `codex/feat-name`，修复使用 `codex/fix-name`，通过 PR 合并。提交按 `feat:`、`fix:`、`test:`、`docs:` 分组。发布以版本标签管理；CI 通过后再合并。不要提交数据库、密码、会话、签名密钥、构建产物或托管凭证。

GitHub： https://github.com/smrsd/xiangqi-friends

本项目面向几位朋友。房间与游戏用数据库单行版本比较更新（CAS）保证并发一致，最多 100 间棋室，闲置 24 小时清理；账号和好友保留。每 2 秒同步，在线状态约 35 秒过期。暂不含密码找回、邮箱验证、AI 对手、旁观或独立历史战绩库。
