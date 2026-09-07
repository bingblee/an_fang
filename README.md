# Personal Life Copilot

一个面向个人使用的 AI 外部大脑。

当用户突然想到一件暂时无法处理的事情时，可以立即把文字、截图或链接交给系统。系统负责保存原始信息、理解其中的事项，并在适合执行的时候重新提醒。随着使用深入，系统还可以在用户授权下了解其生活习惯、重要关系、日程约束和个人偏好，从而给出更合适的生活安排与提醒。

## 当前产品承诺

> 用户只需要在想到事情时告诉系统一次。此后，记住它、整理它，并在合适的时候让它重新出现，是系统的责任。

## 文档

- [产品愿景与原则](docs/product-vision.md)
- [MVP 产品需求](docs/mvp-spec.md)
- [个人上下文与生活关系](docs/personal-context.md)
- [试用与迭代路线](docs/iteration-roadmap.md)
- [MVP 验收记录](docs/mvp-review.md)
- [话题与事项归属](docs/topics.md)
- [标题编辑与分类合集](docs/categories-and-editing.md)
- [“稍后”与任务状态](docs/later-and-status.md)
- [开发环境、数据库隔离与发布流程](docs/development-and-release.md)
- [登录与会话安全](docs/authentication.md)

## 当前阶段

项目已完成第一版可试用 MVP。当前支持：

1. 输入文字、截图和链接；
2. 使用 DeepSeek 从文字或截图中提取事项、人物、场景和提醒时间；
3. 新输入可以自动补充或更正近期已有事项，避免生成重复待办；
4. “查找方法、给我建议、列清单”等输入会生成建议便笺并附到相关事项，而不是变成一条孤立待办；
5. 对确实存在知识缺口的事项选择性主动建议，简单琐事保持安静；
6. 点击事项时间即可修改或清除，新的时间会同步更新提醒触发器；
7. AI 建议可以删除，或复制一份到“笔记本”长期保存；笔记副本可以独立编辑和删除；
8. 原始内容、AI 解析结果、正式事项、建议和笔记分层保存在本地 SQLite；
9. 今日、顺手处理、等待中和稍后队列；
10. 完成、延后、等待和放弃；
11. PWA 安装和后台 Web Push 提醒。
12. 创建话题 / 主题 / 专题，一个话题收纳多个事项；输入时手动选择或由 AI 自动判断，已有事项可以重新归类。
13. 深浅两套主题，一键切换并记住浏览器偏好。
14. 点击事项标题可单独改名，不改变提醒或完成状态；点击“购物／工作”等分类可查看跨话题合集，分类也能手动调整。
15. “稍后”事项不会永久沉底：有明确时间的按时回来，无时间的按 1／3／7／14／30 天复盘节奏回到今日；任务状态区分新任务、进行中、等待中和已完成。
16. 多用户账号与注册：启动时自动创建 `bingbing` 并归入无归属的历史数据，其他用户可从登录页注册独立账号；每个账号的数据完全隔离，可选择在当前设备记住登录 30 天。

例如输入“请创建一个关于星河项目的话题”，或进入“话题 → 新建话题”。在话题页记录内容会默认归入该话题；填写话题描述可以帮助 AI 判断归属。

## 本地运行

要求 Node.js 22 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

开发环境打开 `http://localhost:3001`，使用独立测试数据库。已有 `.env.local` 时不要重复复制示例文件覆盖 Key。

在 `.env.local` 中配置 `DEEPSEEK_API_KEY` 后启用 AI 整理；未配置时会自动使用本地规则，不会丢失输入。

首次启动会自动创建账号 `bingbing`，将无归属的历史数据一次性归入该账号。初始密码随机生成，保存在当前环境目录的 `initial-account.json` 中（正式环境默认为 `data/production/initial-account.json`，仅当前系统用户可读写），不会显示在网页或日志中。打开 `/login`，用该账号和初始密码登录，再从左侧栏底部的账号入口输入当前密码和新密码进行修改；修改成功后初始密码文件自动清理，其他设备自动退出。其他用户可从登录页自助注册独立账号。

忘记密码时在服务器运行 `npm run auth:reset -- --env production --username bingbing`，按提示输入两次新密码（输入不显示）。开发环境使用 `--env development`。不再需要 `AUTH_SETUP_TOKEN`，旧 `/setup` 和 `/recover` 页面会转到登录页。详细说明见 [登录与会话](docs/authentication.md)。

生产模式：

```bash
npm run build
npm start
```

正式环境打开 `http://localhost:3000`。开发用 `dev` 分支，发布用 `master` 分支；原 `main` 只保留为历史基线。数据库不会随 Git 切换而改变，由启动命令选择。

旧项目升级：把 `.env.local` 的 `DATA_DIR` 改为 `DATA_ROOT`，停止旧服务后运行 `npm run db:migrate -- --confirm-stopped`。本机已完成迁移，原数据和截图仍保留作备份。

回归测试（先构建）：`npm run build && npm test`。测试使用临时数据库和模拟模型，不会修改个人数据或消耗 DeepSeek 额度。

## 数据与隐私

- 正式数据保存在 `data/production/app.db`，测试 / 开发数据保存在 `data/development/app.db`；
- 截图和 Web Push 密钥存放在对应环境目录的 `uploads/` 和 `vapid.json`；开发与自动化测试不发送提醒；
- DeepSeek Key 保存在 `.env.local`，也可在 `.env.development.local` / `.env.production.local` 分别覆盖；
- `data/`、真实环境配置和构建缓存均已加入 `.gitignore`，不随代码发布；
- 用户账号、密码哈希和服务端会话保存在当前环境的 SQLite 中；所有业务数据带有账号归属并在接口层强制过滤；浏览器 Cookie 为 HttpOnly、SameSite=Lax，HTTPS 部署时自动启用 Secure；
- 调用 DeepSeek 整理输入时只发送当前账号的输入、最多六条本地预筛选的相关未完成事项摘要，以及最多 40 个当前账号的话题名称与描述，用于判断事项关联和话题归属；不会发送完整数据库或其他用户的数据。
- 生成建议时只发送目标事项的标题、备注、时间和来源摘要。当前建议基于模型知识，不代表已经联网检索或核验；实时搜索与来源引用留待后续版本。

部署到非本机地址时必须启用 HTTPS，并在反向代理中正确传递 `Host`、`X-Forwarded-Host` 与 `X-Forwarded-Proto`。
