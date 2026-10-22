# 验证记录

日期：2026-10-23（Asia/Shanghai）。

- Node.js 24：19 项测试通过，覆盖规则、将死/困毙、和棋、随机合法对局、鉴权、双向好友、并发入房、重复提交、旧局操作、返回大厅不退局、超时与请求校验。
- 本地 HTTP：主页与规则模块响应 200。
- Android：28 项服务器地址校验通过；SDK 35 + JDK 17 构建调试 APK；apksigner v2/v3 验签与 zipalign 检查通过。

- 浏览器：两个独立会话验证注册、在线列表、发送/接受好友申请、创建/加入房间、双方准备、红炮走棋、黑马应手，以及对局中返回大厅再回棋室。分别检查了手机宽度和桌面宽度布局。

- Sites 第 1 版部署返回 `succeeded`，公开网址已配置；D1 的 `users`、`sessions`、`friend_requests`、`app_state`、`rate_limits` 表已确认存在。
- 当前验证网络访问新站点和原有豆友站点均返回 Cloudflare 403 HTML，未能完成生产注册/对局冒烟测试，不将部署成功等同于当前网络访问验收通过。可在可达网络运行 `SITE_URL` 指向公网的 `scripts/smoke.mjs`；它会创建两个离线 QA 账号，结束并退出测试房间，令牌不落盘。
- GitHub Actions 作业未开始，annotations 明确提示：`The job was not started because your account is locked due to a billing issue.` 需要仓库所有者处理 GitHub 账单限制后重新运行；没有把这次 CI 标为通过。
- ADB 仅发现 `emulator-5554 offline`，没有可用设备，未做真机安装测试。

本地结果不能替代真机验收。公网访问和 CI 的上述外部限制已单独记录。
