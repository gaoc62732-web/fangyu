# 第一轮迁移记录与开发操作

更新：2026-09-28。此轮是架构和源码迁移，允许破坏性变更。已经安装依赖；未启动应用/数据库、运行数据库迁移、生产构建或浏览器测试。

## 已完成的结构

前端使用 Vue 3、Vue Router、Pinia，页面覆盖中国、世界、日韩专题、要素、成就、导入、存档与帮助。领域规则、目录索引、地图绘制、文件格式处理和存储分别位于 packages 下，运行时不引用旧 HTML。

原单元格/名称字符串记录已改为有类型的结构化对象。public catalog 与个人记录分离；地区/项目有固定 ID，跨页面记录主体使用 recordId。旧标记清洗和 OOXML 模板修补链已经移除。

前端本地模式使用 Dexie/IndexedDB；服务端模式使用会话 HTTP API，后端使用真实 PostgreSQL 查询和事务。当前以 JSONB 快照保存个人记录，不是尚未实现的 repository 占位层，也不是完整的规范化目录数据库。

成就采用声明式目标与条件；数量、要素和卯分由 domain 计算。现有来源、固定榜单、历史口径、待核说明随迁移保留。

## 依赖安装

Windows 双击根目录“安装依赖.cmd”。安装器需要网络，使用官方 Node.js 和 npm 包仓库，下载 Node 时核验 SHA-256；已有满足要求的 Node 会直接复用。pnpm 锁定为 10.15.0，默认冻结 pnpm-lock.yaml。安装器也会完成 esbuild 的本机组件安装，并补齐 apps/web/.env 与 apps/api/.env。

手动安装：

```sh
node scripts/install.mjs
```

维护者修改依赖清单后更新锁文件：

```sh
node scripts/install.mjs --update-lockfile
```

.env 不纳入版本管理；安装器只填补缺失字段，保留已存在的配置。删除或留空 BETTER_AUTH_SECRET 时，重新安装会生成随机密钥，原会话将失效。

## 服务端初始化

以下步骤供后续联调执行，**本轮没有执行**。

1. 安装并启动 Docker Desktop，或自行提供 PostgreSQL 17 + PostGIS 3.5。
2. 使用开发用 Compose 创建数据库：

```sh
docker compose -f infra/docker-compose.yml up -d
```

开发默认账号、数据库名和密码均为 fangyu，数据库只绑定本机 5432；非本机环境必须设置自己的密码并同步修改 apps/api/.env 的 DATABASE_URL。

3. 在项目根目录初始化认证表和业务表：

```sh
npm run db:migrate
```

迁移脚本先调用 Better Auth 的 schema migration，再执行 infra/sql/0001_foundation.sql。该脚本用于当前开发版本的初始建表；后续结构变更应新增版本迁移，不能依赖 CREATE TABLE IF NOT EXISTS 自动升级旧表。

4. 创建测试账号。在 PowerShell 中运行：

```powershell
$Credential = Get-Credential -Message '输入测试账号邮箱和至少 12 位密码'
$env:FANGYU_ACCOUNT_EMAIL = $Credential.UserName
$env:FANGYU_ACCOUNT_PASSWORD = $Credential.GetNetworkCredential().Password
try {
    npm run create-user
} finally {
    Remove-Item Env:FANGYU_ACCOUNT_EMAIL, Env:FANGYU_ACCOUNT_PASSWORD -ErrorAction SilentlyContinue
}
```

按提示输入显示名称。账号创建使用 Better Auth 的密码处理；API 默认关闭公开注册。

5. 将 apps/web/.env 的 VITE_APP_MODE 改为 server，保留 VITE_API_BASE_URL=/api/v1。确认 API 的 WEB_ORIGIN 与前端实际地址一致，默认 http://localhost:5173 。
6. 双击“启动后端.cmd”和“启动前端.cmd”，或分别执行 npm run dev:api 与 npm run dev:web。前端 Vite 代理 /api 到 http://localhost:3000 。关闭进程窗口可停止服务。

认证密钥要求至少 32 字符，安装器生成 64 字符随机十六进制值。生产部署时 BETTER_AUTH_URL、WEB_ORIGIN、数据库连接及代理配置需要按真实 HTTPS 地址设置。

## 数据与维护

- data/catalog/catalog.json 是当前目录源；四个 .geo.json 是地图几何。
- data/catalog/manifest.json 记录目录版本及文件清单。
- data/references 保存已转为新版地区 ID 的 2025 赛迪固定榜单。
- data/fixtures/station-names.txt 是非个人记录的人工导入样例。
- npm run catalog:stats 查看数据规模；npm run catalog:check 检查 ID 与关系。
- 公共目录仍全量加载，约 25 MB；地图几何已按范围延迟加载。
- 解析器仍在主线程，二进制解析部分为有类型声明的可读 JavaScript；Worker 尚未实现。

完整 JSON 可以恢复个人新增项目和所有偏好。Excel 只合并已有 ID 对应的记录，不恢复不存在的个人项目，也不降低已有等级。共享项目仅导出一行，避免在不同页面重复编辑同一份记录。

## 检查结果与未验证事项

已完成依赖安装、workspace TypeScript/Vue 类型检查、Prettier 格式检查和目录引用静态检查。安装器自动下载 Node 的分支尚未在缺少 Node 的机器上实际验证，当前机器复用了已安装的 Node。

未执行生产构建、应用启动、数据库迁移、浏览器操作或自动化运行测试。后续应优先验证：

- 地图范围、点位选择、缩放和 PNG 内容。
- 主项/子项标记、跨页面关联、撤销、存档及手动降低状态。
- JSON/Excel 往返、同码机场、名称限定、Railtrack、OSM/PBF、照片导入。
- 登录会话、跨用户隔离、并发首写、修订冲突、失败后恢复与备份。
- 真实目录大小下的首屏、内存、文件解析、全量快照写入成本。
- 生产构建产物、静态资源路径、反向代理和数据库恢复。

旧功能替代依据是源码、数据和新入口覆盖，**没有声称动态行为已经逐项验证一致**。清理范围见 [替代矩阵](legacy-replacement-matrix.md)。
