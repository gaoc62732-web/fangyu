# 分块地图本地整合与验收

本轮接续本地 UI 整合提交 `72bc03698b7348a6bd14a11b76decdbb98baff93`，分支为 `integrate/tiled-map-first-screen-20261002`。用户主界面来源 `dev/new@f097c232342746c1a43173c5f6fcc1413f802d46`；成就界面及本轮地图资源生成、MVT 架构参考来源 `dev/simo@51f582ba85ea7c86955ce40e4e4d2e3d728d049e`。来源核验见先前 UI 整合说明。

本轮是选择性接入协作者的 MapLibre/分块资源方案，没有合并其整套主界面或修改目录、记录模型、成就计算、卯分与个人记录。未推送、合并远端或部署。

## 修改与数据边界

- `prepare-web.mjs` 从现有目录生成压缩目录、索引、四个地图的 MVT、显示用简化几何和原始几何副本。构建及开发启动自动执行，输出在被忽略的 `data/generated/web`。
- 首屏读取 gzip 目录并按版本缓存；地图仅请求当前范围、当前显示层级及边界瓦片。中国原始几何从 29,034,849 字节的首屏请求移到 GPS/线路导入需要时读取。
- 保持原主导航、左右栏、显示层级、类别、选择、到访着色、点位、缩放、导出和成就往返。新增简短地图状态和重试入口。
- 区划点击和着色使用原 `regionId`；原始几何逐字节复制到 `geometry/`，供原 `CountySpatialIndex` 使用。简化几何和 MVT 仅用于显示，不用于 GPS 判断、历史映射、记录或成就计算。底图与区划沿用已有经纬度；未声称数据具有测绘精度。
- MapLibre 失败或缺少 WebGL 自动转 Canvas 简化地图；全部资源失败有明确提示和重试。切换范围时中止旧请求、释放地图与 Worker 相关资源；Canvas 调整尺寸保留当前视图。
- 可选 `VITE_TIANDITU_KEY` 为空时不请求第三方服务。有密钥时采用天地图 `vec_w/cva_w`，保留署名；底图错误时保留本地区划。浏览器密钥应由用户自行在供应商控制台限制域名，不应当作服务端秘密。
- PNG 使用本地区划和原图例，独立于在线底图；初始化时同步设置画布尺寸，避免导出空白小图。

## 验证与证据

Windows / Node 24.19.0 / pnpm 10.15.0 / 本机 Chrome；使用隔离浏览器和合成记录。测试脚本不读取用户浏览器资料或本机个人记录。

- 全工作区类型检查、目录引用校验、生产构建通过。仍有大于 500 kB 的分包提示，主要是 MapLibre 和既有导入代码；不影响构建成功。
- `scripts/verify-map-assets.mts`：四套原始几何与源文件逐字节一致；z0 各层共 3306 个瓦片要素 ID 与原几何对应；8 套含/不含供应商样式通过 MapLibre 校验；子路径占位符、无密钥行为、gzip/已解压目录/空响应检查通过。
- `scripts/verify-tiled-map.mjs`：首屏、按需切层、真实地图悬浮和点击、缩放及调整尺寸、PNG 导出、瓦片失败降级、无 WebGL 降级、全地图失败提示和恢复重试。结果与截图保存于 `data/generated/tiled-map-checks/`。
- `scripts/verify-ui-integration.mjs`：原有 9 组界面回归继续通过，包括两页导航/返回、空状态、连续点击、合成记录新增与撤销同步成就、CSV、四个尺寸、夜间模式、键盘与历史导航。截图在 `data/generated/tiled-ui-regression/`。
- 当前机器无压缩静态预览的隔离冷启动首屏：14 个资源请求，其中 4 个瓦片请求，资源 transferSize 合计约 5.10 MB。没有原始几何、简化整图、原始目录、省市未显示层级或外部底图请求。这是单机资源采样，不是公网延迟或跨设备性能承诺。
- 生成的 gzip 目录约 2.84 MB；资源总计 1164 个瓦片。原目录内容仍在客户端完整解码，因此此轮改善传输和绘图，不代表消除了目录解析成本。

未验证：真实天地图账号/配额/跨域/网络、公网 CDN 和另一台设备、移动端真机、生产数据库。没有现成密钥，未申请或创建密钥。GPS 算法未修改且输入字节一致，但本轮未对真实个人轨迹做端到端导入。浏览器视窗检查不能替代全部设备的性能测试。

运行示例（项目根目录）：

```powershell
node node_modules/pnpm/bin/pnpm.cjs -r typecheck
node scripts/verify-catalog.mjs
node node_modules/pnpm/bin/pnpm.cjs build
node apps/api/node_modules/tsx/dist/cli.mjs scripts/verify-map-assets.mts
# 设置 PLAYWRIGHT_MODULE 为已有 Playwright 的 index.mjs 绝对路径
$env:UI_BASE_URL='http://localhost:5190'
node scripts/verify-tiled-map.mjs
node scripts/verify-ui-integration.mjs
```

本机审阅：运行工作目录的 `打开方舆整合预览.cmd`，浏览器访问 `http://localhost:5190`。服务仅监听本机 IPv4/IPv6 回环；此地址不能用于其他设备。该启动器位于仓库外，服务实际读取本仓库 `apps/web/dist`。

## 建议优先级（未额外实施）

1. P0：上线前配置供应商域名限制并实测失败、配额与署名；分别验证 `geometry`、MVT 和底图在已知控制点的对齐。继续保留原始导入几何。
2. P1：目录按国家/类别拆分与延迟装载，缩小主地图模块与 Worker 首次加载体积；部署静态压缩及长期资源缓存后，再采集公网冷/热启动指标。
3. P1：增加瓦片切换后的真实到访颜色像素验收，以及固定公开轨迹样例的导入对照；完善数据源授权、版本、历史边界与现行边界说明。
4. P2：按独立国家专题扩展区划与 POI，先配置化范围，保持世界目录和专题共用记录 ID。具体设计见国家扩展建议，未导入新数据。
