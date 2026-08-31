# 开发与发布

## 环境约定

| 用途 | 代码分支 | 启动命令 | 默认端口 | SQLite | 构建目录 |
| --- | --- | --- | --- | --- | --- |
| 日常开发 / 手工测试 | `dev` | `npm run dev` | 3001 | `data/development/app.db` | `.next-dev/` |
| 正式使用 / 发布 | `master` | `npm run build` 后 `npm start` | 3000 | `data/production/app.db` | `.next-prod/` |
| 自动化回归 | 任意待验收分支 | `npm test`（先构建） | 临时随机端口 | 系统临时目录，每次独立创建 | 复用生产构建 |

分支管理代码，启动命令决定运行环境：切换 Git 分支本身不会切换数据库。`npm run dev` 固定进入开发环境，`npm start` 固定进入正式环境；不要用 `npm start` 做日常手工测试。

原 `main` 分支保留作为历史基线，不再用于开发或运行。`dev` 与 `master` 是本地分支；本次没有配置远程部署、推送分支或增加公网入口。

## 数据隔离

- 数据库、上传截图、Web Push 密钥均保存在各自环境目录内。
- 正式库承接已有个人数据。开发库从空库开始，不复制个人记录、图片或提醒订阅。
- 开发 / 自动化测试界面显示“测试数据”标记，安装的 PWA 也命名为“安放测试”。
- 开发与测试环境禁止 Web Push 订阅和后台发送，避免测试时真的提醒。
- 各环境目录内的 `.anfang-environment.json` 标记该目录用途，启动时校验；错误的环境标记、同目录 / 嵌套目录、符号链接绕过、共享数据库硬链接都会被拒绝。
- 没有环境标记的既有数据库不会自动当作新库打开，避免把私人数据库误当测试数据。
- 构建不启动提醒服务，也不创建或改写正式数据库。
- `npm run build` 会检查部署文件清单，排除私人数据与环境配置引用（包含框架未自动过滤的提醒服务清单）。当前只支持 `npm start` 运行，不生成未经核验的 standalone 独立部署包。
- 开发与正式构建缓存分开，可以同时运行；重新发布生产构建时仍需先停止正式服务。两者当前使用同一代码目录，未来部署到独立服务器时应使用独立检出与持久化数据卷。

## 配置文件

共享配置放在 `.env.local`（已有 DeepSeek Key 仍可使用）。不同环境的覆盖配置分别放在 `.env.development.local` 和 `.env.production.local`。

```dotenv
# .env.local：共享默认值
DATA_ROOT=./data
DEEPSEEK_API_KEY=填写自己的Key
```

```dotenv
# .env.development.local：可选的开发环境覆盖
DEVELOPMENT_DATA_DIR=./data/development
# DEEPSEEK_API_KEY=单独的开发Key
```

```dotenv
# .env.production.local：可选的正式环境覆盖
PRODUCTION_DATA_DIR=./data/production
ENABLE_REMINDERS=true
# DEEPSEEK_API_KEY=单独的正式Key
```

环境专属文件优先于共享 `.env.local`，shell 环境变量优先级最高。`*_DATA_DIR` 优先于 `DATA_ROOT` 下的默认子目录；如需整体迁移数据根目录，需同时检查这些覆盖项。Key、数据库与备份均不提交到 Git。

旧版 `DATA_DIR` 已停用，升级时需将 `.env.local` 中的 `DATA_DIR=./data` 改为 `DATA_ROOT=./data`。首次配置可参考仓库内三个 `.env*.example` 文件，不要用示例文件覆盖已经配置好的 Key。

## 从旧版数据库迁移

本机已执行迁移。下面的步骤适用于其他旧版本安装：

1. 停止所有仍使用旧库的服务，避免备份之后又产生新输入。
2. 将共享 `DATA_DIR` 改为 `DATA_ROOT`，检查正式库目标目录尚不存在。
3. 执行 `npm run db:migrate -- --confirm-stopped`。
4. 启动正式服务，核对事项、截图、话题、笔记与提醒。

迁移使用 SQLite 备份机制读取完整旧库，单独备份到 `data/backups/before-environment-split-*/app.db`；复制并校验所有已登记截图，更新正式库中的图片路径，保留 Web Push 密钥与订阅。完整性校验通过后才启用新的目录。

旧的 `data/app.db`、`data/uploads/`、`data/vapid.json` 均保留，仅作回退资料，后续输入只写入 `data/production/`。请勿再启动旧 `main` 分支连接旧库，以免产生两份不同进度的数据。脚本不会覆盖已有正式库，重复成功执行不会重新导入。

## 日常开发

```bash
git switch dev
npm run dev
```

访问 `http://localhost:3001`。同一局域网的手机使用开发机器 IP 加 `:3001`。确认页面显示“开发环境 · 测试数据”后再进行手工测试。

自动化回归：

```bash
npm run lint
npm run build
npm test
```

测试使用模拟模型，不消耗真实 DeepSeek 额度；开发页面手工输入会使用当前开发环境配置的 Key。想完全离线测试，可在 `.env.development.local` 设置空的 `DEEPSEEK_API_KEY=`。

## 发布到 master

1. 在 `dev` 完成修改并提交，确认工作区干净。
2. 停止当前正式服务。
3. 验收通过后，快进合并发布：

```bash
git switch master
git merge --ff-only dev
npm run lint
npm run build
npm test
npm start
```

如不能快进合并，应先核对分支差异，不要强制覆盖。构建或测试失败时不要启动该版本。

正式服务访问 `http://localhost:3000`；可在另一个终端切回 `dev` 开始下一轮开发，已启动的服务使用验收过的生产构建。数据不随代码合并、切换分支或重新构建而覆盖。单目录方式适合当前私有 MVP，独立主机发布建议只从 `master` 检出并挂载单独数据目录。

## 主题

导航底部（手机右上角）的月亮 / 太阳按钮切换浅色与深色。默认保持浅色；深色恢复原夜航设计的深蓝底、淡网格、荧光黄绿与青色提示。

主题选择只保存在当前浏览器，刷新保留，同源多个页面同步；不写数据库。不同手机、不同浏览器、以及 `3000` / `3001` 两个站点各自保存选择。禁止浏览器存储时仍可切换，但关闭页面后可能不保留。
