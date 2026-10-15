# 中国人工数据管理页面开发设计

## 1. 文档目的

本设计为中国第一类人工维护数据规划一个基于 Vue 3 的内部管理页面。管理员可以按数据集检索、查看、创建、修改和删除数据；坐标和边界由地图交互编辑。修改直接写入后端使用的 `data/manual/china/` 源文件，并通过受控的发布步骤更新面向普通用户的目录和地图资源。

本设计只规划页面与接口，不在本阶段实现功能或改动数据。

## 2. 目标和范围

目标：

- 用统一入口查看中国人工数据的对象、字段和值，包括嵌套对象、数组、空值和类别专属字段。
- 用服务端分页和过滤读取数据，避免打开管理页面时下载完整发布目录或全部边界几何。
- 保存后直接更新 `data/manual/china/` 中的正式数据源，避免只在浏览器或数据库保存一份影子副本。
- 通过 MapLibre 地图添加或移动地点坐标，并编辑可编辑的边界规则几何。
- 防止未授权写入、并发覆盖、无意级联删除及无效 JSON/GeoJSON 落盘。
- 将人工源数据的保存与静态发布资源的重新构建分开，让管理员能看见当前源数据是否尚未发布。

第一版面向中国数据。其它国家的数据、OSM 下载与版本更新流程不纳入管理页面。

## 3. 当前架构和数据事实

- 前端为 Vue 3、Pinia、Vue Router hash 路由；页面入口在 `apps/web/src/app/router.ts`，导航在 `apps/web/src/components/AppHeader.vue`。
- 地图使用 `maplibre-gl`。现有地图场景和组件位于 `apps/web/src/features/maps/` 及 `apps/web/src/components/`。
- 后端为 NestJS，全局 API 前缀为 `/api/v1`。当前目录接口是 `GET /api/v1/catalog` 和 `GET /api/v1/catalog/geometry/:scope`。
- 中国人工数据位于 `data/manual/china/`。目录服务通过 `scripts/lib/assemble-manual-china.mjs` 将它与现有其它目录装配成前端使用的目录对象。
- 当前没有人工数据写入接口、管理员权限判断或管理页面。
- Better Auth 已提供登录会话；现有 `AuthGuard` 只验证登录与请求来源，不能当作管理员授权。
- 主要人工数据包括政区及按省拆分的 JSON 文件、类别及分类条目、地点、组成项和关系、来源、称号、待补位置、成就定义及边界规则。
- `manifest.json` 描述数据文件与数量。它应由服务端在数据保存后更新，不作为普通数据集直接编辑。
- `rules/boundary-assets.json` 体积较大，保存固定边界资产和变体引用。它不应随普通列表请求或管理页首屏载入。
- `rules/boundary-edits.json`、`boundary-options.json` 和 `boundary-policy.json` 保存规则元数据；OSM 边界源和固定资产几何需与可编辑规则明确区分。

## 4. 数据维护边界

管理页通过数据集注册表限定可读写的逻辑数据集和正式文件路径。浏览器不能提交任意路径或文件名。服务端也不接受由客户端自行定义的 schema。

| 数据集 | 正式来源 | 管理方式 |
| --- | --- | --- |
| 政区 | `regions.json` 索引及 `regions/*.json` | 按省/文件分页；维护政区基本字段、父子关系、称号引用和 Overpass 查询条件 |
| 类别 | `categories.json` | 小型表格与完整字段表单；类别 ID 创建后不可直接改名 |
| 分类条目 | `items/<category-id>.json` | 按类别分页；完整展示公共字段和该类别 `attributes` |
| 地点 | `places.json` | 地点表格及专用坐标地图编辑器 |
| 组成项、关系 | `components.json`、`relations.json` | 关系列表及对象引用选择器；检查双向/被引用关系 |
| 来源 | `sources.json` | 来源登记表；供 `sourceRefs` 等字段选择 |
| 称号 | `recognitions.json` | 分别编辑称号与继承规则 |
| 待补位置 | `pending/locations.json`、`pending/airport-locations.json` | 作为待处理队列显示；完成定位时写入正式 Place/Item 并同步移除已解决项 |
| 成就定义及策略 | `achievements/*.json` | 按文件类型展示并以字段 schema 编辑；大型表格按需载入 |
| 边界规则 | `rules/boundary-options.json`、`boundary-edits.json`、`boundary-policy.json` | 普通字段编辑与专用地图规则编辑；保留修改原因和来源 |
| 边界固定资产 | `rules/boundary-assets.json` | 第一版只读预览及来源信息；不得作为普通 JSON 表格编辑，也不得覆盖 OSM 输入 |
| 目录清单 | `manifest.json` | 服务端派生维护；只读展示版本、文件和数量 |

页面默认不提供修改生成结果的能力，包括 `data/generated/web/`、`data/catalog/*.geo.json`、瓦片、PMTiles 和构建缓存。用户编辑这些产物会在下一次构建时丢失。

## 5. 页面信息架构

增加管理区路由：

```text
/admin/data
/admin/data/:dataset
/admin/data/:dataset/:id
/admin/data/places/:id/map
/admin/data/boundaries/:regionId
```

页面由以下区域组成：

1. 顶部工具条：管理区标题、数据集、全局搜索、刷新、源数据修订、发布状态和退出。
2. 左侧数据集导航：按“政区、目录条目、点位与关系、来源、成就与规则”分组，显示记录数量及未发布状态。
3. 主列表：服务端分页表格、筛选器、排序、列选择器和新建操作。
4. 对象详情：选择记录后打开右侧详情面板；可进入独立详情路由编辑完整字段。
5. 地理编辑：点位编辑使用地图与字段面板并列；边界编辑使用较大地图画布和操作/校验面板。

布局需适配窄窗口。桌面端列表和详情可并排显示；小屏幕列表与详情切换为独立视图，不压缩地图到不可操作的尺寸。

导航入口仅在服务端确认当前用户为管理员后显示。直接输入管理路由仍由管理 API 再次授权，前端隐藏入口不构成安全控制。

## 6. 列表和详情交互

### 6.1 表格

- 默认每页 50 条，允许选择 25/50/100 条，接口上限 200 条。
- 首屏展示适合扫描的标识列，例如 ID、名称、类别/层级、关联政区、坐标状态、更新时间；默认列不是数据字段的上限。
- 列选择器从数据集 schema 读取所有字段。选择后可以查看任意标量字段；对象和数组列显示摘要并可展开。
- 每行的详情面板始终显示该对象的全部已定义字段和值。字段可按组折叠，但不能因列宽而丢失查看入口。
- 数组、对象、`null` 和空数组分别显示；不得把 `null`、`[]`、缺失字段折叠成同一个空白。
- 支持按 ID/名称快速查询，以及 schema 声明的类别、政区、层级、是否有坐标、来源等筛选条件。排序字段来自 schema 白名单。
- 列表可用 Vue 虚拟滚动，但分页由服务端负责；不能先拉取 14812 条条目再在浏览器过滤。

### 6.2 详情和字段编辑

详情表单按对象 schema 渲染完整字段，建议采用“字段名、当前值、编辑控件”布局：

- 字符串：单行文本；长说明：多行文本。
- 数字：带范围约束的数字输入；布尔值：开关；枚举：下拉选择。
- ID 引用：可搜索选择器，显示目标对象名称与 ID；允许查看被引用对象。
- 有顺序语义的数组：增删并可拖动排序；集合型 ID 数组：搜索添加/移除。
- 嵌套对象：按语义分组；大型对象提供折叠和结构化编辑。
- 类别专属 `attributes`：使用类别专属 schema 展开已知字段，同时提供 JSON 高级编辑器显示完整原始对象。未知字段必须保留并可见，编辑其它字段时不得丢弃。
- 来源引用显示来源名称、URL 与授权信息；实际存储仍使用 `sourceRefs` ID。
- 对象 ID 创建后视为稳定身份，不通过普通表单改写。`order`、别名、父级及关系字段按各自 schema 规则编辑。
- 保存前显示字段级校验错误；保存期间禁用重复提交。未保存离开时提示保留、放弃或继续编辑。

schema 使用版本化 TypeScript/Zod 定义，服务端负责校验。数据集 schema 元数据至少包含字段名、中文说明、类型、是否必填、默认值、枚举、引用目标、可排序/筛选标志、是否可创建/修改和展示分组。前端按元数据生成通用编辑器，少数地理字段使用专用组件。

所有字段都必须可读。高级 JSON 编辑器是补充出口，不得作为唯一编辑方式，也不得格式化后静默删除 schema 未认识的字段。

## 7. 点位和坐标编辑

### 7.1 坐标存储原则

- 页面以 WGS84 经纬度显示与保存，位置结构继续采用 `Place.location`：`status`、`kind`、`position.longitude`、`position.latitude`、`sourceRef`、`method`、`note`、`visitorEntranceVerified`。
- 条目通过 `placeId` 引用地点。新增缺失坐标时，若该对象表示可复用地点，则创建 Place 并将条目链接到它；若对象是独立展示点且当前契约仍在条目 `attributes` 存坐标，则 schema 必须明确其坐标所有者，地图组件不得猜测。
- 当前目录装配逻辑会优先读取部分条目上的 `attributes.coordinates`，也会读取 `place.location.position`。实现前须为每类点对象登记唯一坐标所有者，避免同一对象出现两个互相覆盖的坐标。后续契约统一时可将场所型点坐标归一到 Place；路线/线状对象的路径几何仍作为其自身的线几何维护。
- 坐标缺失就是未定位；不能由名称、政区中心点或反向地理编码静默补齐。

### 7.2 地图操作

- 地图默认缩放到现有坐标或关联政区范围；无坐标时以关联政区定位地图，并显示“尚无坐标”。
- 点击地图新增坐标；已有点可拖动；提供撤销/重做、清除坐标、定位到坐标及全屏地图。
- 同步显示经度、纬度输入框。地图操作更新输入框，输入框也更新地图预览；超出经纬范围立即提示。
- 地图上显示当前点、精度/位置类型和可选政区边界。边界仅供定位参考，不自动改写 `regionIds`。
- 对机场、车站、遗址等地点，保留 `kind`、定位 `method`、`sourceRef`、`note` 和“入口已核实”字段；坐标变化不能默认把 `visitorEntranceVerified` 设为 true。
- 保存前显示变更前后坐标、坐标来源和定位说明。用户需选已有来源或明确记录人工实测/人工判读的来源方式；不得伪造来源 URL。
- 完成待补位置项时，按对象关系更新 Place/Item，并将该缺项从 pending 数据集中移除。涉及多个文件的操作作为一个服务端事务提交。

## 8. 边界编辑设计

边界编辑需将“边界源数据”和“人工编辑规则”分开。OSM relation/geometry 属于第三类版本化输入；固定外部几何属于固定资产；人工规则表达在基础边界上执行的覆盖或修正。管理页不把 OSM 原始数据或发布后的 GeoJSON 当作可写真相。

### 8.1 边界工作区

- 选择政区后按需请求其当前来源边界、有效结果和已有人工编辑；不预先下载全国完整 `boundary-assets.json`。
- 地图图层区分“来源边界（只读）”“已有规则结果”“本次草稿”。图例、线型及图层开关清楚说明当前显示的几何。
- 编辑工具支持选择对象、拖动顶点、在边中点插入点、删除顶点、画新环、移除环、绘制替换几何、撤销/重做。
- Polygon/MultiPolygon 支持外环与内环；LineString/MultiLineString 只在对应可编辑对象/schema 允许时开放线编辑。南海线等固定线资产保持只读，除非它作为专门的固定资产管理功能另行授权。
- 操作记录面板显示规则顺序、目标政区、操作类型、来源、修改原因、状态和创建/更新时间。

### 8.2 边界规则对象

当前边界规则结构不足以可靠表达任意地图编辑。实施时将可编辑边界修改收敛为显式对象，例如：

```ts
interface BoundaryEdit {
  id: string;
  targetRegionId: string;
  operation: 'replace' | 'union' | 'subtract' | 'add-ring' | 'remove-ring';
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  sourceRefs: string[];
  reason: string;
  status: 'draft' | 'active';
  createdAt: string;
  updatedAt: string;
}
```

上例是设计目标，不代表当前 `boundary-edits.json` 已使用该结构。具体动作应限制为能由服务端稳定重放的操作；不允许把一次 UI 操作存成不可解释的几何副本而丢失其作用意图。

### 8.3 编辑、预览和保存

1. 加载只读来源几何及当前规则结果。
2. 创建草稿规则，地图上仅改变草稿图层。
3. 客户端先做即时校验，服务端再对候选最终几何执行严格校验和规则重放。
4. 显示编辑前后叠图、面积/范围变化摘要及受影响的政区/层级；疑似超出目标政区或影响邻区时要求显式确认，不自动吸附或自动修复。
5. 保存后规则写入正式 `boundary-edits.json`，记录来源和修改原因；服务端更新源版本并将目录/地图构建标为待发布。
6. 发布预览使用相同的规则顺序和边界组装器生成候选结果；失败时不切换当前已发布资源。

校验至少包括：GeoJSON 类型与坐标维度、有限经纬度值、Polygon 环闭合、环坐标数、自相交、内环关系、空几何、非预期类型、有效规则引用和操作顺序冲突。校验错误定位到具体环/点并保留草稿供修复；不得因无法自动修复而丢弃编辑。

## 9. 管理 API

管理 API 放在现有 `/api/v1` 下，全部先登录再做管理员授权。管理服务按注册表访问 `data/manual/china/`，不通过静态发布目录编辑数据。

| 方法和路径 | 用途 |
| --- | --- |
| `GET /admin/manual/china/datasets` | 数据集列表、记录数、文件修订及发布状态 |
| `GET /admin/manual/china/datasets/:dataset/schema` | 字段和编辑器 schema |
| `GET /admin/manual/china/datasets/:dataset/rows` | 分页、过滤、排序列表 |
| `POST /admin/manual/china/datasets/:dataset/rows` | 新建对象 |
| `GET /admin/manual/china/datasets/:dataset/rows/:id` | 读取对象、revision、关联摘要 |
| `PATCH /admin/manual/china/datasets/:dataset/rows/:id` | 按字段修改对象，要求 `If-Match` |
| `POST /admin/manual/china/datasets/:dataset/delete-preview` | 预览删除影响和阻塞引用 |
| `DELETE /admin/manual/china/datasets/:dataset/rows/:id` | 删除对象，要求 revision 与明确确认 |
| `GET /admin/manual/china/places/:id/map` | 地点、来源和关联区域的地图数据 |
| `PUT /admin/manual/china/places/:id/location` | 写入或清除已确认的位置 |
| `GET /admin/manual/china/boundaries/:regionId/editor` | 按需读取来源几何、有效几何和编辑历史 |
| `POST /admin/manual/china/boundaries/:regionId/edits` | 新增边界草稿/规则 |
| `PATCH /admin/manual/china/boundaries/:regionId/edits/:editId` | 更新边界规则 |
| `DELETE /admin/manual/china/boundaries/:regionId/edits/:editId` | 删除边界规则，检查依赖和 revision |
| `GET /admin/manual/china/status` | 显示数据 revision、脏数据集、最近发布和发布任务 |
| `POST /admin/manual/china/publish` | 构建并原子发布候选数据包 |
| `GET /admin/manual/china/publish/:jobId` | 查询构建进度和错误 |

分页查询示例：

```text
GET /admin/manual/china/datasets/items-catalog/rows?page=1&pageSize=50&q=故宫&regionId=CN110101&hasLocation=true&sort=name&direction=asc
```

列表响应包含 `items`、`page`、`pageSize`、`total`、`datasetRevision`、`nextCursor`（若采用游标分页）和用于表格的字段摘要。详情响应包含完整 `item`、`revision` 和只读的关联摘要。GeoJSON 使用标准 GeoJSON 对象，地图请求按选中政区裁剪/选择，不返回整个全国集合。

错误响应采用稳定格式：`code`、`message`、字段级 `details`、当前 `revision`（冲突时）及必要时的依赖对象摘要。客户端不得依赖 NestJS 原始堆栈或英文错误文本。

## 10. 身份验证和权限

- 复用 Better Auth 会话及现有 `AuthGuard`，再增加 `DataAdminGuard`。普通登录用户不得读取或写入人工数据管理 API。
- 初版管理员身份使用服务端配置的显式用户 ID 白名单（如 `DATA_ADMIN_USER_IDS`）；服务启动时校验配置格式。客户端传入角色、隐藏按钮或本地状态都不是授权依据。
- 后续若管理员需频繁自助管理，可迁移到数据库角色字段/权限表；不在第一版为单一维护者引入复杂的角色层级。
- 所有写请求校验可信来源、会话、管理员权限、请求体大小和字段 schema。公开目录 API 不暴露本地路径、备份内容或管理审计记录。
- 管理列表/详情也受管理员限制，避免把未发布的人工信息暴露给任意登录用户。

## 11. 并发、写入和恢复

### 11.1 修订冲突

- 每个对象返回基于当前规范化 JSON 内容的 `revision`/ETag；写入需要 `If-Match`。
- 服务端针对目标数据文件使用串行文件锁。锁内重新读取最新文件、验证目标对象 revision、合并指定字段、再校验关联。
- 同一对象被其它窗口修改时返回 `409 Conflict` 和服务器当前对象/revision。前端提供重新载入与字段差异查看，不能静默覆盖。
- 同一文件的不同对象可依次更新并各自合并，不因文件 revision 变化把其它行的有效修改覆盖掉。
- 列表缓存以源文件指纹失效；关联索引仅失效受影响数据集。

### 11.2 文件提交

正式源数据仍为 JSON 文件。服务端完成下列过程后才确认保存成功：

1. 解析及 schema 校验请求；确认目标 dataset、对象 ID、所有外键和删除影响。
2. 锁定目标文件；重新读取并验证 `If-Match`。
3. 为多文件改动（例如新增 Place 并链接 Item）建立事务日志与同目录暂存文件；验证所有候选文件可解析。
4. 保存旧文件备份，然后以平台支持的原子替换方式逐一提交暂存文件；若步骤失败，依据事务日志恢复旧版本。
5. 全部成功后更新 `manifest.json` 中的文件记录和 revision，再提交事务日志。
6. 失效管理员查询索引及 `CatalogService` 装配缓存；记下需要重新构建的发布资源。

备份存放在被 Git 忽略的管理历史目录，按文件保留有限数量的快照；审计记录只保存管理员 ID、时间、dataset、对象 ID、操作类型、前后 hash 和原因，不重复写入大型 GeoJSON。写失败必须返回错误，不能显示“保存成功”。

### 11.3 删除策略

- 删除前查询 `regionIds`、`parentId`、`placeId`、`componentIds`、关系、成就目标和来源引用等依赖。
- 有有效引用时默认阻止删除，并显示引用位置及跳转链接。明确提供必要的解除引用/重分配编辑后才能删除，不执行隐式级联。
- 已无引用对象的删除仍显示名称、ID 和依赖摘要二次确认。删除后保留文件备份和审计条目以便恢复。
- 关键字数据集（例如来源、类别）在被引用时不允许删除，只允许修正可修改字段或先替换引用。

## 12. 查询和性能方案

- 管理页面不请求 `GET /catalog` 作为表格数据来源，也不下载 `catalog.json.gz` 后在浏览器查询。
- 首次打开只取数据集清单、每个数据集计数、schema 和 revision；表格按页读取，打开详情时再读取完整对象。
- 后端为轻量字段构建索引：ID、名称、别名、类别、政区 ID、层级、坐标状态、来源 ID。大型 geometry 不进入文本搜索索引。
- 单个 JSON 数据文件首次访问后按文件指纹缓存解析结果；查询返回小页数据，更新时只失效受影响的文件和关联索引。若数据文件后续增长到单文件加载影响延迟，再将条目按稳定键分片；第一版不为此先引入数据库迁移。
- 输入搜索防抖约 200 ms；分页返回最多 200 项；常用索引字段限制排序和过滤，避免对任意深层 JSON 做全量扫描。
- `boundary-assets.json`、OSM 几何和候选构建按选中政区/图层懒加载。地图只请求当前视口所需边界；坐标点以 GeoJSON Source 更新，不因拖动重复请求目录。
- 静态发布资源按构建版本缓存。管理页编辑后显示 source revision 和 `dirty` 状态；普通用户发布版本不会在后台被无提示地部分覆盖。

## 13. 保存与发布模型

“保存”表示人工源 JSON 已经持久化，管理页可以立刻重新读到新值。它不承诺已生成的静态站点目录、压缩目录、瓦片和 PMTiles 同步完成。

- 每次源文件变更立即让后端人工数据查询缓存和通过人工目录装配的 API 目录缓存失效。
- 静态前端资源使用显式“发布”操作或可见的后台发布队列；多个连续编辑可以合并成一次构建，避免每改一个字段就重建完整地图。
- 发布在独立 staging 目录构建；成功后原子切换 manifest/发布入口。失败保留上次成功版本，管理页显示阶段、错误和重试入口。
- 发布状态至少包括 `clean`、`dirty`、`building`、`published`、`failed`。管理页须区分“已保存到人工源”和“已对普通用户发布”。
- 不联网更新 OSM，不从任何外部网站拉取数据；管理员修改 boundary edit 只更改本地规则，不替换 OSM 来源版本。

## 14. 前端实现划分

建议新增功能目录：

```text
apps/web/src/features/admin-data/
  client.ts                 # 管理 API 客户端和错误转换
  schema.ts                 # 前端 schema 元数据类型
  use-dataset.ts            # 列表分页、筛选、revision 状态
  components/
    DatasetTable.vue
    RecordDetailPanel.vue
    SchemaFieldEditor.vue
    JsonObjectEditor.vue
    ReferencePicker.vue
    PlaceMapEditor.vue
    BoundaryMapEditor.vue
    PublishStatus.vue
  pages/
    AdminDataPage.vue
    DatasetPage.vue
    PlaceMapPage.vue
    BoundaryEditorPage.vue
```

路由懒加载；通用表格/字段编辑器按 API schema 工作。点位和边界地图编辑器是明确的专用交互，不把地理几何简化成普通 JSON 文本框。地图库继续使用 MapLibre；完整顶点/边编辑可选用与 MapLibre 兼容的绘制库，实施时先确认其对直接选点、插入边中点、孔洞和 MultiPolygon 的支持，再决定依赖，不从零实现整套几何拓扑交互。

Pinia 仅保留当前用户的管理权限、当前 dataset/筛选和轻量请求状态。分页结果可按 dataset key 缓存，写入成功后精确失效相关查询；坐标拖动草稿、地图 feature state 保持在页面局部状态，避免把大几何复制到全局 store。

## 15. 后端实现划分

建议新增 NestJS 模块 `apps/api/src/modules/admin-manual-data/`：

- Controller：路由、参数、HTTP 状态、`If-Match` 与 schema 输入。
- `DataAdminGuard`：在登录会话之上验证管理员权限。
- Dataset registry：稳定 ID 到可读写文件、schema、分页/索引策略的静态映射。
- Service：分页读取、关联查询、依赖检查、revision、写锁、原子写入和备份。
- Geo service：坐标变更与边界规则预览、GeoJSON 校验/规则重放。
- Publish service：异步构建、状态查询和 staging 目录原子发布。

不得通过 `resolve(manualRoot, clientDataset)` 拼接客户端路径。先在注册表中解析有限 dataset ID，再使用固定文件映射；对文件根目录做最终路径校验。读操作返回结构化 DTO，不返回文件系统路径。

管理服务与 `CatalogService` 共享人工数据根目录定位方式。保存后调用显式缓存失效方法，不重启 API、不要求前端重载整个页面才能看到新数据。

## 16. 验收标准

1. 只有管理员可打开数据管理接口；非管理员的直接 API 请求得到 `403`。
2. 管理员打开管理区不会下载整份前端 catalog 或全国 boundary-assets；列表支持服务端分页、搜索及规定筛选。
3. 每个数据集详情都能查看其 schema 声明字段和未知 JSON 字段；`null`、空数组和缺失字段语义可区分；编辑某字段保留其它字段。
4. 新增、修改和删除后，正式 `data/manual/china/` 源文件发生对应变化，manifest 与 revision 更新，后端目录缓存失效。
5. 两个窗口修改同一对象时后保存的一方收到 409 和当前对象；不能静默丢失修改。
6. 引用中的政区、类别、来源、地点等不能被隐式级联删除；删除前能查看影响。
7. 无坐标地点可以在地图点击定位；已有坐标可拖动，也可数值编辑；错误坐标无法保存；来源和定位说明可以单独维护。
8. 点位 schema 有唯一坐标所有者，保存后地图和目录装配读取到同一坐标，不出现 attributes/place 双值互相覆盖。
9. 边界工作区可区分只读来源、已生效规则和当前草稿；能编辑顶点、插入/删除顶点、处理环并查看前后叠图。
10. 无效或冲突边界无法进入已生效规则；服务端解释校验问题；编辑草稿仍可恢复。
11. 保存源数据和发布状态分离显示；构建成功才切换前端发布版本，构建失败仍可用上次成功发布结果。
12. 边界固定资产、OSM 输入及生成产物不会被普通条目编辑接口覆盖。

## 17. 开发顺序

### 阶段 A：契约和授权

建立数据集注册表、字段 schema、revision 规则、管理员 allowlist 和只读分页 API。先覆盖 regions、categories、items、places、components、relations、sources。

### 阶段 B：通用表格和字段编辑

完成数据集导航、服务端分页/搜索、完整对象详情、schema 控件、JSON 高级编辑和原子源文件写入。加入冲突提示、删除预览、备份与审计。

### 阶段 C：点位地图编辑

为每类可显示点对象明确坐标所有者，接入 MapLibre 地图选择、添加、拖动及数值编辑；将 pending 完成操作设计成多文件服务端事务。

### 阶段 D：边界规则工作区

扩展结构化 BoundaryEdit、加载单个政区来源与有效结果、加入顶点/环工具、前后预览和服务端校验。只编辑规则，保持 OSM/固定源只读。

### 阶段 E：发布和全面覆盖

接入 staging 发布流程，完成成就、称号、pending 和人工规则数据集。发布成功后验证普通前端目录、点位和地图使用新版本，再逐项移除旧的仅管理用途入口或重复写入方式。

## 18. 本设计明确不做的事

- 不在浏览器直接读写工作区文件，也不把浏览器缓存作为正式数据。
- 不把完整 `catalog.json.gz` 作为管理 API 的读写源。
- 不从管理页面下载或更新 OSM，不用编辑结果替换第三类原始版本。
- 不直接修改生成目录、瓦片或压缩发布包。
- 不自动猜坐标、反向地理编码、吸附边界、修复自相交几何或级联删除关联数据。
- 不在第一阶段迁移到数据库存储所有人工条目；JSON 文件继续是人工维护的正式来源。
- 不承诺每次单字段保存都同步重建全国静态地图资源；源保存、动态 API 缓存和静态发布状态分别显示。
