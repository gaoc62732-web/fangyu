# 第四项：已到访机场与世界遗产地图图层

2026-10-03。本报告依据当前工作区代码；验收结果待根代理补录。

## 需求与实际记录

地图新增“已到访机场”“已到访世界遗产”两个独立开关，默认关闭，保存到记录偏好 `mapLayers`。标记从实际手册记录派生：`session.view(entry)` 读取该条目的 `recordId`，已勾选或已有旧式子项记录时显示；后者保留“部分到访”状态。同一 `recordId` 的别名只画一次。目录名称和备注仍取用户记录覆盖值。

图层遵循当前国家及已知行政归属，独立于目录搜索、类别筛选和原有“显示点位”开关。不会从行政区到访推断景点到访，也不会把法定父项目到访传播给独立组成地点。本文只检查实现和静态目录，未读取用户实际到访数据。

## 显示与交互

机场使用原创飞机轮廓，世界遗产统一使用原创神庙建筑轮廓（包括自然遗产），未使用 UNESCO 徽标或航空公司标志。项目级代表位置以棕色虚线外圈区分。

MapLibre 瓦片引擎与 Canvas 降级引擎均接入同一批标记和图形。两者均聚合屏幕近邻点，显示数量并支持点击查看成员；同坐标记录仍可逐项选择。名称列表、详情、来源链接和到访复选框提供另一条操作路径。地图详情修改的是原条目的记录，不写入关联目标的记录。

缺坐标、仅有范围参考、身份或坐标有歧义的记录保留在“暂不能定位”列表。聚合数字表示当前可显示的到访记录数，不表示新增景点数。

## 坐标证据与限制

世遗父项目只接受可验证的 UNESCO DataHub 项目坐标，或同项目明确的 `official-project-geographical-row` 代表位置。代表点不表示入口，也不表示所有组成地点均已到访。不会任取一个组成地点补父项目坐标；被明确抑制或存疑的坐标不恢复。

中国机场目录共 313 条：17 条保留既有坐标，260 条通过原名称显式 IATA 等现有来源身份核对，补充独立地图关联，合计 **277 条具备定位资料，36 条待核**。此数不是用户已访数量，也不保证 277 座互不重复的机场；不同旧记录保留各自 ID。证据仅供地图定位，不合并记录、不继承世界目录到访状态。此次是现有目录来源的身份核对，**不是最新机场运营状况核查**；已发现迁址、代码重用或关闭冲突者暂缓。

中国世遗目录 245 条（61 个不同名称）在现有资料中 **0 条具有可靠的官方 ID 关联**：全部缺 `code`、`source` 和坐标，与重构首版 270220d 的记录完全一致。仓库根提交及重构前静态 HTML 的国内原始资料只有 E 列中文名单和行号；`itemMeta` 无 UNESCO 关联。世界目录另有 61 个官方项目 ID、60 个坐标，但两套记录没有共享 `recordId` 或原始跨表 ID 证据。不能仅凭同名套用世界代表点，更不能把跨地区父项目代表点当作国内成员位置。需要原条目到 UNESCO ID 的明确来源或经审计对照表；这不是声称全部外部官方渠道已穷尽。

证据文件：

- `data/extensions/research/china-airport-map-associations.json`
- `data/extensions/research/china-heritage-map-association-audit.json`（245 条逐项缺口及历史静态来源哈希；未生成猜测关联）

主要实现：`packages/domain/src/visited-map-markers.ts`、`apps/web/src/components/VisitedMapLayers.vue`、`apps/web/src/features/maps/use-tiled-map.ts`、`packages/map-renderer/src/visited-marker-icons.ts`、`packages/map-renderer/src/marker-clusters.ts`。

## 验证记录

| 项目                                               | 结果                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| 类型检查、构建                                     | 全工作区通过                                                         |
| 记录身份、关联证据、父子到访隔离                   | 合成及实际目录领域测试通过                                           |
| 两引擎图形、聚合、同坐标选择                       | 纯测试通过；1440/390 × 瓦片/Canvas真实聚合点击全部通过               |
| 浏览器：开关、搜索隔离、详情修改、空状态、不同尺寸 | 1440/390 × 瓦片/Canvas共28项通过，0页面异常                          |
| 浏览器：刷新偏好、旧记录兼容、截图路径             | 核心测试通过；最终聚合与PNG专项8项、原失败触点回归1项通过，0页面异常 |

审阅入口为开发预览 `http://localhost:5191/`。可用隔离测试记录开启两个开关，核对聚合、详情及不能定位列表。核心浏览器结果和截图位于 `data/generated/visited-map-ui/core/`，最终专项位于 `data/generated/visited-map-ui/touch-fixed/`，原失败触点复测位于 `data/generated/visited-map-ui/edge-fixed/`，总索引为 `data/generated/visited-map-ui/verification-summary.json`；领域测试位于 `data/generated/visited-map-markers/verification.json`；渲染器测试位于 `data/generated/visited-marker-renderer/pure-results.json`。此交付不推送远端（no push）。

实际浏览器发现并修复了 MapLibre 6.11.2 动态图标时序问题：`styleimagemissing` 事件时才添加图片会错过当前worker响应，改为库提供的 awaited `setMissingStyleImageResolver`。没有预生成所有数字图片。PNG使用同源原创图形，并明确项目代表位置不表示全部组成地点到访、聚合数字不表示项目完成数。最初失败及诊断证据保留，未以纯测试替代真实点击验收。

另修复了真实手机触控问题：Canvas在 `pointerup` 插入成员详情，随后的原生 `click` 会误落到新出现的单项按钮。现在 `pointerup` 只保存命中快照，在 Canvas 的 `click` 事件目标确定后提交一次选择；拖动、取消和重复事件有独立检查。旧失败坐标严格回归通过，并在原生点击后等待700ms确认仍保留全部成员。圆心通过没有被用作忽略旧失败的依据。修复后法国下钻7组、越南两尺寸Canvas行政点击／返回／PNG均重新通过。
