# 中国边界共享边与版本更新扩展设计

## 1. 目标

当前县域几何通常由多条连续边组成，相邻县域共享同一条边。边界编辑不能把一个县的完整 Polygon 当作独立真相，否则手动细化西城区与东城区之间的边界后，会同时制造两份可能不一致的边界。扩展后的模型以“共享边”为最小可维护单元：一条边只保存一次，两个相邻政区通过有方向的引用共同使用它。

本设计覆盖第二类固定边界、第三类 OSM 边界，以及管理页面中的边界编辑和版本更新衔接。第一类政区名称、层级和归属仍由人工目录维护；边界几何不写回 `regions/*.json`。

## 2. 核心决策建议

建议采用三层数据：

1. **第三类来源版本**：每次 OSM 更新生成一份不可变的规范化边界图，保存完整 relation 结果、节点序列、规范化共享边和政区/边关系。它是本次更新的基础输入，不被管理页面直接修改。
2. **第二类固定资产/覆盖**：本地保存固定外部几何，以及从第三类边中冻结出来的人工共享边。冻结的是边或边片段，不是整县最终 Polygon。
3. **发布结果**：将当前第三类版本与第二类覆盖按规则合成，再派生县域 Polygon、MultiPolygon、显示层级和瓦片。发布结果可删除重建，不能作为下一次更新的输入。

如果一条共享边被手动修改，覆盖对象同时声明它替代哪一个来源边、位于哪两个政区之间、适用哪个边界层级和方向。更新 OSM 后，系统仍获取两个政区的完整新边界，但构建时排除该来源边在覆盖窗口内的部分，再插入本地边。西城与其它政区的边没有覆盖时继续使用新 OSM 版本。

## 3. 建议目录结构

```text
data/
  remote/china-boundaries/
    versions/<source-version>/manifest.json
    versions/<source-version>/relations/*.json
    versions/<source-version>/nodes/*.json
    versions/<source-version>/arcs/*.json
    current.json
  manual/china/
    boundaries/
      boundary-arcs.json
      edge-overrides.json
      boundary-paths.json
      profiles/
        boundary-profiles.json
        face-assignments.json
      edge-policies.json
  generated/
    boundaries/<build-version>/...
```

`remote` 只保存第三类当前正式版本和按政策保留的原始留档；`manual/china/boundaries` 只保存第二类资产、覆盖及其声明；`generated` 只保存可重建产物。实际路径可以沿用仓库现有 remote/fixed 目录，但三种职责不能混在一个发布 GeoJSON 中。

## 4. 对象模型

### 4.1 来源边 `SourceEdge`

```ts
interface SourceEdge {
  id: string;                    // 版本内稳定 ID，不能直接用数组下标
  sourceVersion: string;
  geometry: GeoJSON.LineString;
  start: [number, number];
  end: [number, number];
  leftRegionId: string | null;
  rightRegionId: string | null;
  level: 'county' | 'city' | 'province' | 'international';
  sourceRefs: string[];          // OSM relation/way/node 等来源事实
  matchKey: string;              // 跨版本匹配键，见第 6 节
}
```

一条边可以是拓扑切分后的连续片段。若同一物理边因三县交界、海岸或来源关系变化而需要分段，则每段有自己的 ID，但相邻区域引用同一段并采用相反方向。

### 4.2 政区边界引用 `RegionBoundary`

```ts
interface RegionBoundary {
  regionId: string;
  sourceVersion: string;
  level: 'county' | 'city' | 'province' | 'international';
  rings: Array<{
    role: 'outer' | 'inner';
    edges: Array<{ edgeId: string; direction: 1 | -1 }>;
  }>;
}
```

政区不复制边坐标，只保存环上的有向边引用。由环引用可重建 Polygon/MultiPolygon；孤立海岛、飞地和孔洞使用独立环。

### 4.3 本地覆盖 `EdgeOverride`

```ts
interface EdgeOverride {
  id: string;
  geometry: GeoJSON.LineString;
  operation: 'replace' | 'insert' | 'remove';
  applications: Array<{
    level: 'county' | 'city' | 'province' | 'international';
    regionIds: [string, string | null];
    replaces: Array<{
      sourceEdgeId?: string;
      sourceRefs: string[];
      matchKey: string;
      sourceVersion?: string;
      from: [number, number];
      to: [number, number];
    }>;
  }>;
  sourceRefs: string[];
  reason: string;
  status: 'draft' | 'active' | 'retired' | 'conflict';
  priority: number;
  createdAt: string;
  updatedAt: string;
}
```

`geometry` 是唯一保存的人工边几何；`applications` 显式列出它在哪些层级、哪些相邻政区对中生效。每个应用分别声明要裁掉的来源边窗口，因此同一物理线可以在县、市、省拓扑中分别绑定，不能隐式假定县级覆盖自动属于上级边界。`from`/`to` 是来源 LineString 上的线性参考位置，不是经纬度坐标。全局 `edge-policies.json` 规定 WGS84 地理距离 10 米的最大端点接续距离；每次候选构建把自动接续作为报告数据保存，不改写覆盖原件。

### 4.4 固定来源边和独立线

白云鄂博矿区、南海线、唐古拉名义界等固定来源几何也进入统一的 `BoundaryArc`/`BoundaryPath` 图。它们的 `origin` 为 `external-fixed`，`updatePolicy` 为 `fixed`，保留来源、转换、适用层级、许可证和原因；需要替换已有来源边的部分通过 `EdgeOverride` 连接。没有两个相邻政区的线使用 `lineOnly: true`，允许单侧或无侧引用，但不参与 OSM 跨版本匹配，也不参与县域 Polygon 闭合。这样编辑器可以统一选择、修改和审计所有边界线，同时不会把固定来源线误当成可更新的 OSM 边。

## 5. 更新和构建流程

1. Overpass 按政区中文名/别名查询 relation，生成新的原始响应和 `sourceVersion`。
2. 规范化 relation、way、node，构建节点图并在交界节点处切分为 `SourceEdge`。
3. 对每个 `applications` 目标，优先使用 OSM 来源对象 ID 匹配；ID 不再稳定时，按同层级相邻政区对及几何指纹寻找唯一候选。不能唯一匹配的应用进入冲突清单。
4. 将应用声明的来源边窗口从候选边中裁掉。裁剪按规范化的线性参考位置执行，并保留被裁来源边及版本信息。
5. 在每个已声明层级的拓扑中插入同一人工覆盖几何；覆盖端点距新来源相邻边端点不超过 10 米时，可按 WGS84 地理距离小幅接续。逐点记录原坐标、新坐标、距离、相连来源边及政区，并在地图和构建报告中展示。超过 10 米、邻接变化或调整会破坏拓扑时进入冲突清单。
6. 检查每个应用对应政区对的方向、闭合环和邻接一致性。未声明人工覆盖的上级边界由下级结果聚合派生；已显式声明市/省应用的，也必须与下级聚合几何保持拓扑一致。
7. 只有覆盖匹配、端点接续和拓扑构建均成功，才切换候选发布资产；否则保留当前正式版。

因此，更新 OSM 不会改写人工覆盖基础几何；覆盖只影响各 `applications` 声明的来源边窗口，其它边全部来自新版本。短距离端点接续是按候选版本生成的可追溯连接结果，不静默回写人工覆盖文件。若来源边消失、匹配失败、邻接政区变化、端点超过 10 米或覆盖与新边相交方式不再唯一，构建必须标记 `conflict` 并暂停发布。

## 6. 跨版本匹配

采用已确认的混合匹配。OSM way/relation ID 可作为首选，但不作为唯一长期身份。ID 发生变化时，`matchKey` 使用目标层级、规范化的左右政区 ID（按稳定顺序）、边端点/沿线采样指纹及来源关系事实产生候选。匹配过程如下：

1. 同一来源对象和同一版本内精确匹配。
2. 相同两侧政区、端点邻近、几何重叠度达到阈值的唯一候选。
3. 覆盖窗口与候选边有明确的线性参考关系。

唯一匹配时自动关联；多候选、仅部分重合、政区身份/相邻关系变化时不得自动匹配，进入冲突队列，由维护者选择新来源边或重绘覆盖。10 米端点接续仅作用于已唯一匹配的覆盖，不能用来掩盖边对象匹配歧义。

## 7. 相邻县一致性

覆盖边是共享对象，不能只修改一个县。保存前必须验证：

- 每个 `applications` 项的 `regionIds` 两侧与对应层级的来源/目标政区一致；无第二侧时明确表示外边界或海岸边。
- 每个应用的两侧政区环引用都能采用相反方向使用同一覆盖几何。
- 替换后没有裂缝、重叠、重复边、未闭合环或孤立端点。
- 同一覆盖只有在 `applications` 中显式列出的层级生效；若同时声明县、市、省层级，三者均需单独做来源匹配和环拓扑校验。
- 与同一节点相连的其它边端点保持一致，必要时一组相邻边作为一个编辑事务保存。
- OSM 新版本下的小幅端点接续逐点记录；地图高亮并显示原坐标、新坐标、位移距离和受影响的相邻边。接续结果由候选构建生成，不修改人工覆盖原件。

如用户在地图上拖动公共顶点，编辑器显示受影响的两侧政区并同时更新共享边；不允许只保存单县版本。

## 8. 管理页面扩展

边界编辑器新增“边界来源/拓扑”视图：

- 显示当前政区的环、边列表、左右政区、来源版本、覆盖状态和匹配状态。
- 地图同时显示来源边、active 覆盖、草稿覆盖及相邻政区；选择一条共享边时高亮两侧区域。
- 编辑模式先选择“新建覆盖”“修改已有覆盖”“解除覆盖”，再编辑顶点/边，不直接修改来源图。
- 保存时显示覆盖窗口、被替换来源边、将继续使用 OSM 的相邻边数量，以及对相邻政区的影响。
- OSM 更新后，冲突队列显示来源边消失、匹配不唯一、邻接变化、端点超出自动连接距离和几何不连续；自动连接的端点也出现在变更摘要中，供维护者查看坐标和位移。
- “查看最终边界”展示来源边、覆盖边、固定资产和派生面四种图层，便于追溯。

建议新增页面路由：

```text
/admin/boundaries/edges
/admin/boundaries/edges/:edgeId
/admin/boundaries/conflicts
```

## 9. API 扩展

```text
GET  /admin/manual/china/boundaries/:regionId/topology
GET  /admin/manual/china/boundaries/edges/:edgeId
POST /admin/manual/china/boundaries/edges/overrides
PATCH /admin/manual/china/boundaries/edges/overrides/:overrideId
POST /admin/manual/china/boundaries/edges/overrides/:overrideId/retire
GET  /admin/manual/china/boundaries/conflicts
POST /admin/manual/china/boundaries/conflicts/:id/resolve
```

普通 `PATCH /boundaries/:regionId` 不再接受整县 Polygon 覆盖。所有边界写入都必须经过共享边服务，服务端根据 `sourceVersion` 和 `baseRevision` 做冲突控制。

## 10. 版本、删除和回退

- OSM 版本是不可变输入；更新成功后 `current.json` 原子切换。
- 第二类覆盖拥有独立状态和 revision。退休覆盖不会删除几何和审计记录，只是不再参与构建。
- 删除/退休覆盖前显示受影响的两侧政区、层级和最终几何；存在冲突时只能显式解决。
- 构建失败、覆盖匹配失败或拓扑检查失败时保留上一发布版本，并把候选版本标为不可发布。
- 管理页面可以把某条覆盖回退到上一个对象版本，但不能直接把当前发布 GeoJSON 写回人工源。

## 11. 已确认的边界决策

1. 地图允许编辑任意连续子段；保存时自动切分所有受影响共享边，最终以唯一共享边几何和政区有向引用组装。
2. 跨版本采用混合匹配：来源对象 ID 优先；ID 不匹配时按同层级相邻政区与几何指纹自动匹配唯一候选；候选不唯一则进入冲突。
3. 一条覆盖可通过多条 `applications` 显式应用到县、市、省等多个层级。没有显式列出的层级按下级边界聚合派生；同时显式应用的层级必须和下级结果保持拓扑一致。
4. OSM 更新端点在 10 米内可按 WGS84 地理距离自动小幅接续，并逐点向维护者展示坐标变化、距离和相邻边；覆盖原始几何保持不变。
5. 来源匹配失败、端点超过 10 米或拓扑冲突时，不切换候选发布版，列出冲突供人工处理。
6. 固定资产、共享边覆盖和边界策略独立保存在 `data/manual/china/boundaries/` 下；OSM 版本和发布资产各自保持独立职责。

## 12. 现有边界资产的统一迁移计划

### 12.1 迁移目标和判定原则

本次迁移的统一对象是**边界拓扑和编辑方式**，不是把所有历史文件机械地合并成一个大 JSON。最终所有可编辑的边界线都使用 `BoundaryArc`/`BoundaryPath` 和 `EdgeOverride`；第三类 OSM 来源仍保存为不可变版本，第二类人工修改只保存实际修改的边段，构建时把两者合成同一张边图。

迁移时对每一段几何都按以下顺序判定：

1. 几何是否真的改变了政区边界。改变的部分才生成 `EdgeOverride`，并记录两侧政区、层级、来源窗口和来源证据。
2. 几何是否只是 OSM 中已有的海岸、岛屿或行政边。若没有人工修改，继续引用新的 OSM `SourceEdge`，不因为当前发布结果曾经被固化就永久冻结。
3. 变化是否只是把已有土地、岛屿或下级单元分配给另一个政区，或改变是否显示某个政区。此类变化保存为 `BoundaryProfile`/`FaceAssignment`，引用共享边和来源面，不复制整县 Polygon。
4. 几何是否是南海段线、唐古拉名义界、国界显示线等没有两个县级邻接面的独立线。此类几何仍创建统一的 `BoundaryArc`，但允许 `leftRegionId`、`rightRegionId` 为空，设置 `lineOnly: true`、`matchable: false`，不参与 OSM 边匹配。
5. 只有来源无法唯一对应、差分无法确定相邻政区或旧几何包含无法解释的整片重绘时，才建立迁移冲突；不得用整区覆盖作为默认兜底。

因此，“第二类”和“第三类”在构建图中不再是两种不同的边界格式。区别只保留在边的来源和更新策略：`updatePolicy: "osm"` 的边随新来源版本变化，`updatePolicy: "fixed"` 的边保留本地几何；二者都能被同一编辑器选择、切分、替换和追溯。

统一后的最小对象补充如下：

```ts
interface BoundaryArc {
  id: string;
  geometry: GeoJSON.LineString;
  level: 'county' | 'city' | 'province' | 'international';
  leftRegionId: string | null;
  rightRegionId: string | null;
  origin: 'osm' | 'external-fixed' | 'manual';
  updatePolicy: 'osm' | 'fixed';
  sourceVersion?: string;
  sourceRefs: string[];
  matchable: boolean;
  lineOnly?: boolean;
  boundaryKind?: 'administrative' | 'coast' | 'land' | 'maritime-dash' | 'nominal';
}

interface BoundaryProfile {
  id: string;
  baseSourceVersion: string;
  enabledByDefault: boolean;
  faceAssignments: Array<{
    sourceRef: string;
    fromRegionId: string | null;
    toRegionId: string | null;
    levels: Array<'county' | 'city' | 'province'>;
  }>;
  displayOperations: Array<{
    regionId: string;
    operation: 'show' | 'hide' | 'merge' | 'draw-line';
    displayAt: Array<'county' | 'city' | 'province'>;
  }>;
  edgeOverrideIds: string[];
}
```

`BoundaryArc` 是唯一存储一份的物理线；`BoundaryPath`/`RegionBoundary` 只保存有向引用；`BoundaryProfile` 只保存归属和显示操作。`BoundaryProfile` 不得直接嵌入 Polygon 坐标，必须引用来源面、共享边或 `EdgeOverride`。

### 12.2 现有文件到新对象的映射

| 当前文件或目录 | 当前实际作用 | 迁移后的正式位置和对象 | 处理规则 |
| --- | --- | --- | --- |
| `data/boundaries/china-osm/*.geojson` 及 `raw/*.json` | 各省 OSM relation 结果和原始响应 | `data/remote/china-boundaries/versions/<version>/relations/`、`nodes/`、`arcs/`、`manifest.json` | 同一 `sourceVersion` 一次性规范化；原始响应只作版本留档，运行时只读取规范化图；所有省、县、市、省 relation 按中文名映射表获取，不再重复下载同一 relation。 |
| `data/boundaries/china-policy/published-overrides.json` | 约 397 条按整区保存的当前发布替换几何 | `data/manual/china/boundaries/edge-overrides.json` | 以对应 OSM 版本和旧几何做边界差分，只保存实际变化的连续边段；相邻区域相同边合并为一条覆盖；无法唯一匹配的整区行进入冲突清单。 |
| `data/boundaries/china-policy/reviewed-patches.json` | 约 69 条政策复核后的区域几何 | `edge-overrides.json`、`profiles/face-assignments.json` | 几何差异转 `EdgeOverride`；土地转移、行政归属和父级聚合转 `FaceAssignment`；不再作为整区优先覆盖输入。 |
| `data/manual/china/rules/boundary-assets.json` | 88 个几何、5 个变体组、1 个线组 | `boundary-arcs.json`、`profiles/boundary-profiles.json`、`edge-overrides.json` | 几何库先与 OSM 图做去重和差分；仅实际修改部分变成固定覆盖；开关变体改成 profile 操作；线组变成 `lineOnly` arc/path。 |
| `data/manual/china/rules/boundary-options.json` | 8 个区域归属/显示开关 | `profiles/boundary-profiles.json` | 不再生成一份几何副本；每个开关记录土地转移、隐藏/合并目标和显示层级。只有开关背后确有人工新边时，同时引用 `edgeOverrideIds`。 |
| `data/manual/china/rules/boundary-edits.json` | 55 条区域和原因记录 | `edge-overrides.json`、`profiles/face-assignments.json`、`migration-conflicts.json` | 逐条按语义分类，不按 `reason` 文本批量猜测；每条必须指向来源边、来源面或待人工处理冲突。 |
| `data/boundaries/china-policy/south-china-sea-lines.geojson` | 官方南海段线显示几何 | `boundary-arcs.json`/`boundary-paths.json` 中的固定 `lineOnly` arc | 作为统一边对象展示和编辑，`matchable: false`，无两侧县域，不参与 OSM 更新匹配。 |
| `prepare-osm-boundaries.mjs` 中 DataV 白云鄂博替换 | 构建时读取 DataV 文件替换白云面并替换达茂旗孔洞 | `edge-overrides.json` 中的固定覆盖 arc | 保存处理后的 WGS84 几何、原始 DataV 来源、坐标转换说明和白云/达茂应用；迁移完成后删除构建时 `applyDataVOverrides` 钩子及其运行时文件依赖。 |
| `applied.json` | 以 `regionId` 保护整区不被 OSM 重导入覆盖 | `migration-manifest.json` 和各覆盖的 `applications` | 只记录迁移来源版本、哈希和完成状态；运行时不得再按整个 `regionId` 保护 `published-overrides`。 |
| `land-mask.geojson`、`osm-land-outlines.geojson`、StatGIS/天地图下载和研究响应 | 海岸裁剪、证据或构建中间物 | `source-evidence/` 或 `coast-policy.json` | 能复现来源的保留哈希和引用；不作为最终区域几何直接供前端读取。迁移确认后清理仅用于研究/截图/临时转换的副本。 |

### 12.3 OSM 来源图迁移

第一步建立唯一的中国边界 `sourceVersion`。将当前 `china-osm` 中各省 relation、补充的唐古拉 relation、海岸线和岛屿 coastline 响应按来源时间、Overpass 查询和中文名称映射表登记到同一版本清单。relation、way、node 的原始 ID 和查询哈希全部保留，规范化后生成：

- 每个 relation 的完整环和 `RegionBoundary`；
- 在端点、三县交界、来源关系变化处切分的 `SourceEdge`；
- 相邻政区反向引用同一条边；
- 海岸、外边界、岛屿轮廓和独立显示线的单侧/无侧引用；
- 每条边的 `matchKey`、来源 relation/way/node 引用和几何指纹。

各省文件不再互相复制同一 relation。省级、市级和县级 relation 若表达的是不同层级边界，分别保留层级引用，但相同物理线只在弧表保存一次。OSM 海岸线作为 `updatePolicy: "osm"` 的来源边进入图；是否把海域裁掉由 `coast-policy` 和 profile 控制，不把裁剪后的全国面反写为 OSM 来源边。

### 12.4 整区覆盖和复核补丁的边差分迁移

对 `published-overrides.json` 和 `reviewed-patches.json` 逐行执行同一迁移流程，禁止直接复制为新格式：

1. 用行中的 `regionId`、`level` 和生成时间找到它对应的旧 OSM `RegionBoundary`，保存旧几何哈希和来源版本。
2. 将旧几何和当前替换几何的外环、内环分别与来源边图匹配，计算边界对称差和连续变化区间。
3. 每个变化区间寻找同层级相邻政区；若两侧唯一，建立一个共享 `EdgeOverride`，两侧环分别引用正/反方向；若只有外部或海岸一侧，使用 `rightRegionId: null`。
4. 相邻区域的补丁若描述同一物理线，只保留一份几何和一个覆盖 ID，追加多个 `applications`；不得保留“西区一份、东区一份”的重复线。
5. 不改变的 OSM 边完全不进入覆盖，下一次 OSM 版本直接替换；岛屿土地转移、隐藏或合并只写入 profile/face assignment。
6. 变化涉及整片无法对应来源边的重绘、来源边匹配多候选、邻接政区改变或差分无法闭合时，写入 `migration-conflicts.json`，不猜测切割点，不生成假覆盖。

迁移工具应同时输出每条覆盖的 `sourceVersion`、来源 relation/way、被裁窗口、相邻政区、差分面积/长度、固定原因和待处理状态。旧整区文件在迁移确认前只读保留，不能继续作为新版本发布输入。

### 12.5 `boundary-assets` 五组变体的具体迁移

`boundary-assets.json` 的 5 个几何组不是 5 套永久边界真相。每组先选当前默认开关对应的结果作为对照，再与 OSM 源图逐边比较：

| 组 | 现有内容 | 迁移结果 |
| --- | --- | --- |
| 苏州工业园区 | 园区与虎丘区的显示/归属切换 | 园区本身的来源边继续跟随 OSM；若只是并入虎丘，写 `FaceAssignment` 和显示 profile；确有新管理边才写覆盖。 |
| 呼中区、新林区、加格达奇区、松岭区 | 关闭时并入呼玛县/鄂伦春自治旗的多个面变体 | OSM 面和边只保存一次；关闭开关写土地归属和隐藏目标 profile；各真实修改的接缝分别转共享覆盖。 |
| 深汕特别合作区 | 深汕与海丰、汕尾/深圳的显示归属切换 | 以 OSM 基础边为来源；合作区归属和显示写 profile；人工调整的接缝才固定。 |
| 连江县、金门县 | 马祖、金门、乌丘、东碇的岛屿转移和合并显示 | 岛屿 coastline 作为 OSM 来源弧；岛屿去向写 `FaceAssignment`；合并显示写 profile；不固化整块福建或台湾 Polygon。 |
| 唐古拉开关 | 青海/西藏县、市、省的正式边界变体和名义虚线 | 新 OSM relation 作为来源版本；天地图/正式资料确实改变的接缝转固定覆盖；名义界转 `lineOnly` 固定弧，`matchable: false`；开关本身只控制归属和显示。 |

5 组中由同一坐标生成的重复几何必须按几何指纹和来源引用去重。变体文件不再作为前端边界数据直接发布；前端请求 profile 后由当前来源图和覆盖即时组装。

### 12.6 `boundary-edits` 逐类迁移规则

现有 55 条记录必须保留原 `regionId`、原因、证据和历史时间，但目标对象按以下规则生成：

- **汉南/蔡甸、文登/环翠**：OSM 下级街道/乡镇边界继续是来源边；正式行政归属造成的变化生成接缝 `EdgeOverride`，街道或乡镇整体归属写 `FaceAssignment`，父级区域由子级聚合，不再冻结两个整区。
- **西藏印度/不丹审核窗口及父级轮廓**：天地图正式县、市、省边界中与 OSM 不同的窗口生成多层级覆盖；同一物理线通过多个 `applications` 显式绑定，窗口外继续使用 OSM。
- **唐古拉正式县界和省界**：保留已获取的唐古拉 OSM relation 作为来源版本；官方资料改变的青海/西藏接缝生成固定弧，唐古拉名义界另存单侧或无侧 line-only 弧；不再用“保护整区”阻止 OSM 更新。
- **黑瞎子岛**：河流中线确认为人工固定的县/省/国界线时，保存为同一组固定共享弧，并按层级建立应用；其余抚远及黑龙江边界继续使用 OSM。
- **三沙、南沙、西沙和海岛归属**：实际岛屿陆地边缘优先使用 OSM coastline；行政归属、合并显示和层级聚合写 profile。南海段线使用无侧固定 line-only 弧，不与岛屿面混为一条边。
- **连江、乌丘、东碇、东沙、钓鱼岛等岛屿转移**：来源海岸边继续更新，只有人工确认的位置/形状改动生成覆盖；归属变化不复制完整省、市、县几何。
- **其它原因**：按“几何差异 / 面归属 / 显示策略 / 证据未决”四类逐条归档。无法证明是几何修改的记录不得自动变成固定边。

### 12.7 DataV、海岸线、国界线和独立线的迁移

1. **白云鄂博和达茂旗孔洞**：将已转换为 WGS84 的 DataV 几何固化为一条或一组固定覆盖弧，记录原始 GCJ-02 来源、转换工具版本、来源文件哈希和应用层级。白云与达茂共同使用的物理线只保存一份。迁移后构建只读取覆盖表。
2. **普通海岸线和岛屿轮廓**：把 OSM `natural=coastline` 规范化为来源弧，按陆地/海域 profile 组装；当前海岸补洞、裁剪和闭合策略记录为 `coast-policy`，不把完整 `land-mask` 当作某个县的固定覆盖。
3. **国家陆地边界显示线**：若能由当前来源边图连续组装，则保存为由弧引用组成的 `BoundaryPath`；只有官方固定且无法从层级边界派生的片段才成为 `external-fixed` 弧。
4. **南海段线**：迁移 `south-china-sea-lines.geojson` 的十段线为固定 `lineOnly` 弧，保留官方来源、显示层级和 `boundaryKind: "maritime-dash"`；不参与 OSM relation 匹配，也不参与县域 Polygon 闭合。
5. **唐古拉名义界及其它虚线**：使用同一 line-only 对象模型，允许单侧或无侧政区；保留 `boundaryKind: "nominal"`、显示层级和原因。编辑器可以修改其顶点，但发布前必须明确它是显示线而不是行政面边。

### 12.8 迁移阶段和切换顺序

**阶段 A：冻结清单，不删除文件。**

登记当前 OSM 文件、397 条整区发布覆盖、69 条复核补丁、55 条人工规则、8 个开关、88 个几何和 5 个变体组的哈希、来源版本和现有发布入口。为每个旧对象分配迁移 ID，记录是否属于几何、归属、显示或证据。

**阶段 B：建立第三类共享边版本。**

从中文名称映射出发一次获取并固化所有 OSM relation、补充 coastline 和唐古拉等特殊 relation，生成不可变 `sourceVersion`、共享弧、环引用和来源 manifest。该版本只读，不带入人工覆盖。

**阶段 C：迁移真实几何差异。**

依次处理 DataV 白云/达茂、现有整区发布覆盖、复核补丁、唐古拉/黑瞎子岛/西藏审核窗口和其它固定线。每次只生成变化边段；同一物理边去重并补充多层级 `applications`。差分不唯一就暂停该对象并进入冲突清单。

**阶段 D：迁移归属和显示策略。**

把 `boundary-options`、`boundary-assets` 变体以及岛屿、园区、管理区开关转换成 profile/face assignment。默认 profile 必须重建当前前端显示；其它 profile 只保存操作，不保存重复几何。

**阶段 E：重建和人工对照。**

仅使用 `sourceVersion`、`edge-overrides`、固定 line-only 弧、profile 和第一类政区目录，重建当前发布边界。将每个旧发布要素关联到新生成要素；重点对照西藏审核窗口、唐古拉、黑瞎子岛、汉南/文登、岛屿转移、白云鄂博、南海线和海岸裁剪。任何无法关联的旧要素都进入迁移冲突，而不是产生兼容副本。

**阶段 F：切换运行时并清理。**

前端和构建只读取新共享边图及 profile；旧 `published-overrides`、`reviewed-patches`、`boundary-assets` 和 DataV 构建钩子先标记为 legacy，确认新发布结果后再移出运行时。原始 OSM 响应、官方证据和审计报告按版本留档；临时截图、重复下载、未被 manifest 引用的转换中间物最后清理。

### 12.9 迁移冲突和不可自动化部分

以下情况必须列入 `migration-conflicts.json` 并由维护者选定来源边或重绘覆盖：

- 一个旧整区几何同时对应多条候选 OSM relation/边，无法唯一确定窗口；
- 旧补丁改变了政区邻接关系，或两侧区域在新目录中已不存在；
- 旧几何是完整面替换，没有可追溯的原始边和来源证据；
- 同一物理线在不同文件中坐标不一致，10 米端点容差也无法确定唯一接续；
- DataV/天地图/StatGIS 只提供面或证据截图，无法证明哪一段是人工修改；
- 某个开关同时改变几何、归属和显示，差分不能拆成独立操作；
- 南海、唐古拉等线被误当作县域 Polygon 的一部分，无法直接闭合行政环。

冲突解决前，相关覆盖不进入 `active`，候选发布版不替换当前正式版。冲突记录保留旧文件 ID、候选来源、差分图和维护者决定；解决后只写新对象，不回写旧整区格式。

### 12.10 迁移完成判据

- 每一个当前前端显示的边界要素都能追溯到一个 OSM `SourceEdge`、固定 `BoundaryArc`、`EdgeOverride`、`BoundaryProfile` 或明确的迁移冲突。
- 任意共享物理边在弧表中只有一个几何对象；相邻区域和不同层级通过有向引用或显式 `applications` 使用它。
- 当前固定结果中未实际改动的 OSM 海岸、岛屿和行政边在新版本中继续更新；只有人工差异留在本地覆盖。
- 8 个开关和 5 组变体不再保存重复完整 Polygon；切换 profile 可以从同一来源图重建各显示结果。
- 白云鄂博、唐古拉、黑瞎子岛、南海线等特殊来源都有明确的来源、转换、更新策略和是否参与匹配的声明。
- 新构建不读取旧整区保护机制；任一来源匹配、端点接续或拓扑冲突都会阻止发布切换并给出可定位的冲突。
- 删除旧运行时输入后，只用三类正式输入和版本证据即可重建当前前端边界结果。

## 13. 验收标准

- 西城区与东城区之间的边只保存一份；两个县的结果引用同一覆盖边且方向相反。
- 修改该共享边后，西城与其它区的边仍来自当前 OSM 版本。
- OSM 更新后，已冻结边在所有显式声明层级继续使用同一份本地几何；10 米内接续端点逐点报告；未冻结边采用新版本；匹配或拓扑冲突时不切换发布版。
- 相邻县不会出现一侧更新、一侧未更新造成的缝隙或重叠。
- 管理页可以看到每条边的来源版本、覆盖状态、匹配依据、左右政区和最终生效几何。
- 固定外部几何与 OSM 覆盖不会互相覆盖，生成目录删除后可以仅凭三类正式输入重建。
