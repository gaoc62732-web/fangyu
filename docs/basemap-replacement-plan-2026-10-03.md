# 底图样式更换与边界精度升级方案

调查与修订日期：2026-10-03。本次范围是**底图样式、底图供应方式和行政边界**。STELE 的“理想状态”特指其底图；遗产点、项目点的图标、名称、聚合和数据维护不属于本次改造范围。敏感数据处置暂不纳入本轮技术选型。

## 一、建议采用的路线

先用 **OpenFreeMap Bright 矢量底图 + Maputnik 样式编辑 + 项目现有 MapLibre** 做样式试点，同时独立升级本项目行政区几何与瓦片精度。这样可以直接调整道路、水体、建筑、普通地名和底图自带 POI 的显示，不必先搭建完整的 OSM 数据处理流水线。后续如需自行控制数据版本，再换成自托管的 OpenMapTiles schema 瓦片；自己制作时可使用 Planetiler。Protomaps/PMTiles 仍是另一条可行路线，但其字段结构不同，不能直接套用 OpenMapTiles 样式。

本次已确认 STELE 主要采用 **多份 GeoJSON → Tippecanoe → MBTiles 中的 PBF 矢量瓦片 → 自有瓦片服务 → 自定义 GL Style JSON → Mapbox GL JS 浏览器绘制**。上游 OSM 如何转成这些 GeoJSON，以及具体服务端软件，仍没有足够证据。它的道路样式与开源 OSM Bright 有很强的相似性；适合以 OSM Bright 为本项目的现成起点，但目前不能断言作者就是从该仓库某个版本修改而来。

## 二、STELE 实际使用的技术：本次新增证据

本次读取了站点公开的应用脚本、普通/规划样式和 TileJSON 正文，证据已比上一版仅观察请求地址更充分。以下是当前线上版本的结果；截图没有明确拍摄日期和缩放级别，不能保证与截图时刻逐项相同。

| 环节           | 已读到的证据                                                                                                              | 可以确认的结论                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 浏览器绘制     | 页面加载 Mapbox GL JS 1.7.0；应用脚本调用 `new mapboxgl.Map({..., style:this.getMapStyle(), ...})`                        | 使用 GL 客户端渲染，底图样式由 style JSON 控制                                             |
| 样式选择       | 应用脚本在 `cn7-hcsite-general-zhcn/style.json` 与 `cn7-hcsite-planning-zhcn/style.json` 之间选择，并调用 `setStyle(...)` | 普通/规划视图通过切换样式文件实现                                                          |
| 样式格式       | 普通样式 `version:8`、`name:"CN7 HC"`、`metadata.owner:"PKKJ"`，包含 140 条绘制规则                                       | 使用 GL Style Specification v8；140 是整份样式的规则数，包含本次不研究的专题部分           |
| 数据源         | `sources.openmaptiles.type:"vector"`，URL 指向 `/data/cnpoi-hcsite-20260602.json`                                         | 底图来自矢量瓦片源；`openmaptiles` 在此首先是作者选择的 source 名称                        |
| 瓦片描述       | 上述 JSON 为 `tilejson:"2.0.0"`，`format:"pbf"`，`tiles:[.../{z}/{x}/{y}.pbf]`                                            | 这是 TileJSON 瓦片元数据，不是普通点位 GeoJSON                                             |
| 瓦片生成       | `generator:"tippecanoe v1.36.0"`；`generator_options` 明确记载输入 GeoJSON、输出 `cnpoi-hcsite.mbtiles` 和制图参数        | 发布数据的元数据明确记录使用 Tippecanoe 生成 MBTiles                                       |
| 覆盖与层级     | `minzoom:1`、`maxzoom:16`、`bounds:[45,0,149.999999,65]`，47 个数据层                                                     | 当前这份瓦片覆盖亚洲一带的矩形范围，不是完整全球包；maxzoom 也不保证每处都有同等源数据细节 |
| 字体与图标资源 | `glyphs:.../fonts/{fontstack}/{range}.pbf` 与样式目录下的 sprite                                                          | 配套供应字体字形和符号资源，浏览器完成文字/符号绘制                                        |
| 边界数据       | TileJSON 的 `admin2b`、`admin4b` 几何类型均为 `LineString`                                                                | 这些是制图边界线，不能直接替代本项目按地区点击、填色所需的完整行政区面                     |

原始公开证据：

- [普通样式 JSON](http://143.198.141.10:8080/styles/cn7-hcsite-general-zhcn/style.json)
- [规划样式 JSON](http://143.198.141.10:8080/styles/cn7-hcsite-planning-zhcn/style.json)
- [TileJSON 元数据](http://143.198.141.10:8080/data/cnpoi-hcsite-20260602.json)
- [部署中的应用脚本](http://stele.geogv.org/dist/app.js)
- [STELE 中文页面](http://stele.geogv.org/zhcn/)

元数据记录的构建命令可概括为以下形式，省略号代表多份实际输入文件，**不是可直接执行的完整命令**：

```text
tippecanoe -o cnpoi-hcsite.mbtiles
  features_0.geojson admin2_border.geojson admin4_border.geojson
  ocean-detail-full.geojson ocean-simple-full.geojson
  test_output*.geojson asiaexpand-*.geojson rail.geojson
  -Z 1 -z 16 -D 10 --clip-bounding-box=45,0,150,65 --read-parallel
```

元数据中的实际输入是逐个列出的文件名；上面用通配符缩写以便阅读。它证明了“已整理的 GeoJSON 再切矢量瓦片”这一段，不证明这些 GeoJSON 由 QGIS、PostGIS、osmium 或其他具体工具生成。也不应直接照抄这组参数作为本项目边界精度设置。

**更正上一版调查：** `cnpoi-hcsite-20260602.json` 不是“单独加载的遗产点数据文件”。它描述的同一份 MBTiles 包含 `highway`、`water`、`waterway`、`landuse`、`building`、`admin2b`、`admin4b` 等底图数据层，也包含专题层。这里仅研究其中的底图与边界。

服务路径与 TileServer GL 的常见接口形式一致，官方 TileServer GL 也能够供应 MBTiles、style、字体和 sprite；但站点未公开服务端身份，**尚不能把“STELE 使用 TileServer GL”列为已确认事实**。之前检查开发者 [GitHub](https://github.com/pkkj)及站点域名仓库搜索，未找到应用原始源码仓库；本次读到的是公开部署脚本及配置，不能等同于找到完整开源项目。

## 三、截图中的底图效果是如何做出来的

普通样式中的真实参数已经足以解释其主要视觉效果。

| 底图元素      | STELE 普通样式中的参数/规则                                                                                       | 对视觉的作用                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 陆地背景      | z9 为 `#F3F1ED`，z10 为 `#EBE8DE`                                                                                 | 使用米灰底色，近景稍加深               |
| 水体与河流    | `#AACEFD`；河流和细小水道单独设置线宽                                                                             | 水系清楚，同时不占据文字层的视觉权重   |
| 公园等用地    | 公园 `#d8e8c8`、居住用地 `#e2e2e2`                                                                                | 以低饱和色块提供环境结构               |
| 高速道路      | 填色 `#ffcc88`，道路描边 `#e9ac77`                                                                                | 橙色主路形成交通骨架                   |
| 主要道路      | 填色 `#fea`（即 `#ffeeaa`），单独的 casing 描边层                                                                 | 浅黄路面与较深边缘形成清晰道路         |
| 次要道路/小路 | secondary 为 `#F7FABF`，minor 为白色；线宽随缩放改变                                                              | 降低次要道路的干扰，放大后逐渐显出细节 |
| 桥梁和隧道    | 按 `brunnel` 属性分别过滤，设独立层序、描边和虚线                                                                 | 桥、隧道与普通地面道路各有表现         |
| 道路名称      | motorway 从 z11、primary/trunk 从 z12、secondary/tertiary 从 z13、minor 从 z15、service/footway/track 从 z16 显示 | 区域尺度仍能看见路网，但不出现满屏路名 |
| 建筑          | 建筑面使用随缩放变化的浅棕灰色                                                                                    | 近景补充形态，避免高对比建筑填色       |
| 行政线        | `admin2b` 和 `admin4b` 分层；后者为灰色及 `[3,1,1,1]` 虚线节奏                                                    | 边界作为辅助线索呈现                   |

道路通常由两条线叠画：先画较宽的描边，再画较窄的路面。线宽采用随 zoom 变化的函数；名称则有独立的起显级别。因此，要实现用户希望的密度，关键是分别控制**道路几何、道路名称、地名和底图普通 POI**，而不是只降低整张地图的透明度。

### 与 OSM Bright 的关系：很强的相似线索，尚无谱系证明

本次直接比较了 [OSM Bright 的 style.json](https://github.com/openmaptiles/osm-bright-gl-style/blob/master/style.json)：

- 两者都有 `highway-primary-casing`、`highway-primary`、`highway-motorway`、`highway-minor` 等对应图层。
- 主要道路描边都使用 `#e9ac77`，主要道路填色都使用 `#fea`，高速填色分别写作 `#fc8` 和等价的 `#ffcc88`。
- 都采用道路描边/路面分层、桥隧分类、随缩放变化的线宽及独立路名层。
- STELE 改了背景/水体/建筑颜色、部分线宽和起显级别，也改了数据层和字段。

这些共同细节支持“借鉴或改造 OSM Bright 一类 GL 样式”的推断；没有作者说明或提交历史，不能证明原始模板版本。对本项目而言，**OSM Bright 已经是能直接编辑的合适起点**，不需要依赖找到 STELE 全部源码。

尤其不能因为 source 叫 `openmaptiles` 就把它当作标准 OpenMapTiles 数据结构：

| 内容     | STELE 已观察到的结构                           | OSM Bright 对应的 OpenMapTiles 结构           |
| -------- | ---------------------------------------------- | --------------------------------------------- |
| 道路几何 | `highway`，字段含 `class`、`brunnel`           | `transportation`                              |
| 道路名称 | `highway.name`                                 | `transportation_name`，其样式使用相应名称字段 |
| 行政边界 | 独立 `admin2b`、`admin4b`                      | `boundary`，按 `admin_level` 等属性筛选       |
| 地名     | 多个 `admin*_poi`、`settlement_poi` 等自定义层 | 使用 OpenMapTiles schema 定义的地点层         |

因此，不能把 STELE 样式的瓦片 URL 换成 Protomaps 或 OpenFreeMap 就期待正常显示；必须使用匹配的样式与数据字段，或做完整映射。

## 四、现成做法与本项目的选择

| 方法                      | 具体组合                                                                              | 自己需要做什么                                          | 本次建议                                           |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| 直接编辑现成矢量底图      | **OpenFreeMap Bright + Maputnik + MapLibre**                                          | 调整样式并在本项目发布 style JSON；数据更新由服务方处理 | **第一试点优先**，最直接验证截图风格和信息密度     |
| 自托管已有矢量数据包      | OpenMapTiles schema 的 MBTiles + TileServer GL Light + OSM Bright/自有样式            | 供应瓦片、字体、sprite，定期更换数据包                  | 需要自行控制版本或服务稳定性时采用                 |
| 自己从 OSM 制图           | **Planetiler 的 OpenMapTiles profile** + 区域 OSM PBF → MBTiles/PMTiles，再接匹配样式 | 获取源快照、运行生成、检查区域数据与部署                | 比从零写 GeoJSON 提取流程更现成；先区域试验        |
| 按 STELE 已确认链路做定制 | 自定义 GeoJSON → **Tippecanoe** → MBTiles → 瓦片服务 → 自有 GL 样式                   | 自己定义图层、提取与简化规则、名称字段和更新流程        | 当标准 schema 缺少必要字段时再考虑，前期工作量较大 |
| 静态 PMTiles 路线         | Protomaps basemap + 对应样式 + PMTiles/MapLibre                                       | 调整其匹配样式，配置支持 Range 的静态托管               | 可行备选，不能直接套用 OSM Bright 的 schema        |

### 最快的样式试点：OpenFreeMap Bright + Maputnik

[OpenFreeMap 官方快速入门](https://openfreemap.org/quick_start/)明确提供 Bright、Liberty、Positron 等底图，并说明可用 Maputnik 删除标签/普通 POI、修改颜色，将定制后的 JSON 放在自己的站点，继续使用其矢量数据源。

建议步骤：

1. 在 [Maputnik](https://www.maplibre.org/maputnik/) 导入官方 Bright 样式 URL：`https://tiles.openfreemap.org/styles/bright`。官方也提供[直接定制 Bright 的入口](https://maputnik.github.io/editor?style=https://tiles.openfreemap.org/styles/bright)。
2. 先调整背景、水体、道路描边/填色、铁路和建筑；使用上一节颜色作为初始参照，再用杭州/绍兴同尺度视窗检查。
3. 默认关闭底图自带的商店、餐馆等生活服务 POI；城市/区域地名保留。将道路几何与道路名称分组，分别控制显隐。
4. 以 STELE 的路名起显级别为初始参照，调整 z8/z10/z12/z14/z16 的密度；所有地方同一规则，避免只对一张截图调参。
5. 导出 style JSON，纳入仓库版本管理。可以作为前端模块导入；若以 URL 供应，则由构建流程复制到 `data/generated/web/map-styles/`。本项目 Vite 的 `publicDir` 已指向 `data/generated/web`，不应误放到未生效的默认 public 目录。
6. 在现有 MapLibre 中组合该底图样式与项目行政区层：行政填色放在道路以下，自己的行政边界按需覆盖底图边界；先消除双重行政线的视觉干扰。
7. 单独保存底图的预设和密度偏好，切换样式时恢复行政区 feature-state、选择和相机。

**通常仅改 style JSON，无需重新下载 OSM 或重切瓦片。** 只有当要显示的几何/属性根本不在数据源里，或数据质量、版本不合要求时，才需要换源或重建数据包。样式不能补回源数据缺失的道路，也不能恢复已经概化掉的行政边界细节。

OpenFreeMap [官网](https://openfreemap.org/)当前说明其公共实例无需注册/API key，提供每周全球数据包，支持自托管；其 schema 是 OpenMapTiles。官网同时说明当前无 SLA。上述为官方能力声明，本轮没有对中国各运营商和本项目真实发布域名做性能验证，正式选用前仍需实测。它与 OSMF 公共标准瓦片服务是不同的服务，不能把二者的供应规则混为一谈。

### 自托管与生成工具的职责

[TileServer GL / Light](https://github.com/maptiler/tileserver-gl)可以读取 MBTiles 并供应矢量瓦片；Light 不包含服务器端栅格化，适合浏览器已有 MapLibre 的场景。重现 STELE 这种客户端矢量样式效果，不要求安装服务端图像渲染组件。若采用 PMTiles 静态供应，则是另一种部署结构，需要 HTTP Range、CORS 和对应协议接入。

[Planetiler](https://github.com/onthegomap/planetiler)官方文档提供 OpenMapTiles profile，可直接处理区域 `.osm.pbf`，输出 MBTiles 或 PMTiles，不需要先自建 PostGIS 数据库。其演示从小区域开始，全球构建仍涉及较大的输入、存储与计算，不能把“现成工具”理解为零维护。优先区域验证，再决定是否自行生成全球包。

[Tippecanoe](https://github.com/felt/tippecanoe)是已经整理好的 GeoJSON 等要素集合到矢量瓦片的生成器；它不是一键提取全部 OSM 道路、水体、地名并自动设计底图样式的工具。STELE 的定制工作很可能主要集中在 GeoJSON 生成/筛选以及 style JSON 两端，中间切瓦片使用现成工具。前半段具体程序仍未确认。

## 五、调查开始时的项目现状与边界改造

以下为改造前核对的代码和数据现状；本次落地结果见第八节。底图与边界的改造对象已经具备清晰分层。

| 现状                                                                                                  | 改造含义                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [types.ts](../apps/web/src/features/maps/types.ts) 把天地图 `vec_w/cva_w`、`img_w/cia_w` 作为栅格供应 | 底图配置需增加完整矢量 style/source 的支持，不能只换现有 raster URL                        |
| [style.ts](../apps/web/src/features/maps/style.ts) 在天地图栅格之上绘制项目行政区 MVT                 | 复用 MapLibre；新矢量样式按稳定图层锚点插入行政面和描边                                    |
| [prepare-web.mjs](../scripts/prepare-web.mjs) 从项目几何生成 MVT                                      | 中国省/市/县最高数据 z5/6/7、世界 z3，继续放大会放大量化/概化误差；法国局部已有 z9/12 策略 |
| [既有边界核查](map-verification-and-boundaries-2026-09-30.md)记录东城区原始面仅 12 点                 | 提高瓦片 maxzoom 只能保留源细节，不能恢复不存在的弯曲边界                                  |
| [data-notices.md](data-notices.md)列出各国不同边界来源                                                | 法国、美国、越南及部分 OSM 来源边界应分别评估，不统一覆盖成一个来源                        |
| [use-tiled-map.ts](../apps/web/src/features/maps/use-tiled-map.ts)有 MapLibre、Canvas 降级和 PNG 路径 | 显示几何与边界样式需兼顾三条路径；PNG 目前不包含在线底图                                   |
| [Vite 配置](../apps/web/vite.config.ts)使用生成目录作为静态资源目录                                   | 样式源文件应有正式仓库位置，再由构建复制或模块导入；大型瓦片生成不放进每次前端 dev/build   |

本项目用于点击/填色的边界应继续使用完整 Polygon/MultiPolygon 和稳定 `regionId`。STELE 公开瓦片中看到的是 `admin2b/admin4b` 边界线，且并未证明包含本项目需要的全部省、市、县面。借鉴其制图方式不会自动解决行政区面的数据来源问题。

边界升级按以下顺序进行：

1. **统一坐标和版本。** 对每个来源登记原始 CRS、日期和处理步骤。内部经纬度与底图坐标基准一致，再交给 MapLibre 投影；不能把 Web Mercator 当作自动纠偏。用道路交叉点、河岸等可核实对象排查系统性偏移，并把坐标基准差异与源几何粗糙分别记录。
2. **按范围选取更细的源面。** 中国比较现有面、可取得的官方/开放资料和 OSM 行政关系样本；国外保留已核实的数据源。geoBoundaries 可提供来源索引，但不预设所有国家层级都足够细。OSM 的 admin_level 不直接等于本项目的省/市/县层级，外部 ID 要明确映射到 `regionId`。
3. **从共享边生成多尺度显示。** 检查闭环、飞地、孔洞、跨 180° 经线和相邻面共边；共享弧段统一简化，避免每个 Polygon 独立简化后开裂。提高实际数据级别并测量 z12/z14 的量化误差，同时明确源几何本身的精度上限。
4. **控制显示的边界线来源。** 某一范围启用项目边界时，可关闭或弱化底图对应行政线，避免两个版本的边界并排显示。若要求地理上真正一致，则需统一几何来源和版本，不能仅靠隐藏其中一条线认定精度问题已解决。
5. **验证空间命中与回退。** 当前 GPS/线路导入空间归属只用中国原始几何；升级时对固定边缘样例比较新旧归属。国外先验证地图点击与填色。Canvas/PNG 使用同版经过核验的显示几何，保留数据回退能力。

项目此前已实测[天地图行政区划 V2.0](https://lbs.tianditu.gov.cn/server/administrative2.html)可以返回 boundary WKT，但东城区样本仅 19 点，仍是概化轮廓。这说明“有边界接口”和“足够精细”必须分开评价。STELE 的 maxzoom 16 同样不是任意位置准确性的保证。

## 六、实施顺序与验收

**P0：固定底图样板。** 使用杭州/绍兴对比截图的土地、水系、道路与名称密度；北京东城区和京冀交界分别验证城市区界与省界；巴黎及东南亚海岸验证境外显示。每个样本保存相同视窗、zoom、屏幕尺寸的现状图与候选图。记录请求量、加载耗时以及可核实几何的位置差异。

**P1：完成样式试点。** 首选 OpenFreeMap Bright，在 Maputnik 制作“简洁”“道路参考”“行政区优先”三个底图预设，仅涉及背景、水系、路网、铁路、建筑、普通地名、底图普通 POI 和行政线。将 style JSON 纳入本项目，扩展底图类型、图层锚点和设置。底图开关只改变相应图层的 visibility/filter/paint，避免每次都重建整张地图。需要 setStyle 时再完整恢复项目行政层状态。

**P2：边界精度试点。** 先升级少量有明确高精度来源的中国省/市/县与境外样本，保留地区身份与记录关系。比较原始几何、MVT、Canvas/PNG、行政点击，以及中国 GPS/线路边缘样例。新源和高 zoom 生成参数的收益通过实测判断，再逐范围推广。

**P3：选择长期供应方式。** 若公共矢量服务的访问表现满足需要，可继续使用并独立维护自有样式；若需要更强的版本控制，再采用已生成的数据包或 Planetiler 自建数据。分别管理 `styleVersion`、`basemapVersion`、`boundaryVersion`。当前固定瓦片路径和 manifest 缓存键需一起版本化，完整上传资源后切换清单。样式更新可以频繁发布，底图快照按月/季度或质量需求评估更新，边界按实际变更审核。

验收集中在：

- z8/z10/z12/z14/z16 道路等级可辨、路名不过密，水体和建筑层次与参考目标一致；桌面和窄屏均能使用。
- 修改颜色、文字密度或图层开关不要求重新生成瓦片；中文地名、字体和子路径部署正常。
- 单套行政边界无重复描边、明显瓦片接缝或独立简化产生的裂缝；飞地、孔洞和多部件未丢失，既有 `regionId` 可用。
- 系统性坐标偏移被查明；边界和底图的真实几何差异有来源、日期及误差记录，不把光滑或点数增多等同于准确。
- 中国空间导入给出新旧边缘样例差异；国外行政点击与填色正常；瓦片失败可回退。
- 对真实发布域名测试字体、瓦片请求、CORS、弱网和移动端；PMTiles 方案额外测试 Range。在线底图导出如果要纳入后续范围，应单独设计，不能把当前无底图 PNG 算作已支持。

## 七、调查来源与确定性

| 来源                                                                                                                                                                                                                                                                                              | 本次用途与状态                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| STELE [普通样式](http://143.198.141.10:8080/styles/cn7-hcsite-general-zhcn/style.json)、[规划样式](http://143.198.141.10:8080/styles/cn7-hcsite-planning-zhcn/style.json)、[TileJSON](http://143.198.141.10:8080/data/cnpoi-hcsite-20260602.json)、[应用脚本](http://stele.geogv.org/dist/app.js) | 本次均成功读取；确认前端、样式、字段、Tippecanoe/MBTiles 元数据与覆盖范围                     |
| [OSM Bright 仓库](https://github.com/openmaptiles/osm-bright-gl-style)及 [style.json](https://github.com/openmaptiles/osm-bright-gl-style/blob/master/style.json)                                                                                                                                 | 读取 README 与样式正文；直接比较道路颜色、图层名和数据字段                                    |
| [Maputnik 官方仓库](https://github.com/maplibre/maputnik)                                                                                                                                                                                                                                         | 确认可在线或本地可视化编辑 MapLibre GL 样式                                                   |
| [OpenFreeMap 官网](https://openfreemap.org/)与[快速入门](https://openfreemap.org/quick_start/)                                                                                                                                                                                                    | 确认现成 Bright、Maputnik 定制、自托管、数据更新和无 SLA 的官方说明；尚未做本项目网络性能验收 |
| [TileServer GL](https://github.com/maptiler/tileserver-gl)                                                                                                                                                                                                                                        | 确认 MBTiles 供应与 Light 版本职责；不是 STELE 服务器身份的证明                               |
| [Tippecanoe](https://github.com/felt/tippecanoe)                                                                                                                                                                                                                                                  | 确认 GeoJSON 等输入到矢量瓦片的工具职责；文档也说明当前维护项目与原 v1.36.0 的历史关系        |
| [Planetiler](https://github.com/onthegomap/planetiler)                                                                                                                                                                                                                                            | 确认 OpenMapTiles profile、区域 OSM PBF、MBTiles/PMTiles 和无中间数据库的生成路线             |
| [Protomaps MapLibre 接入](https://docs.protomaps.com/basemaps/maplibre)、[图层 schema](https://docs.protomaps.com/basemaps/layers)、[PMTiles 云存储](https://docs.protomaps.com/pmtiles/cloud-storage)                                                                                            | 上轮已核对的备选技术；本轮明确其样式不能直接与 OpenMapTiles schema 混用                       |
| [geoBoundaries API](https://www.geoboundaries.org/api.html)                                                                                                                                                                                                                                       | 边界来源检索入口；中国高精度面与具体样本仍需验证                                              |

STELE 自有样式是否来自某个特定 OSM Bright 版本、OSM→GeoJSON 的具体处理脚本、实际服务器软件、完整行政区面来源与更新自动化仍未确认。现有证据已经足以选定可复现其底图风格的技术路线。

## 八、2026-10-04 实施记录

根目录提供的 `osm_liberty.json` 已迁移到 `apps/web/src/features/maps/styles/osm-liberty.json`，并保留 Maputnik 的图层、颜色和缩放规则。MapTiler 的 `{key}` 地址已替换为 OpenFreeMap 的公开 OpenMapTiles TileJSON；中文字体改用 OpenFreeMap 的 Noto Sans 字形。地图运行时把 Liberty 样式的 `openmaptiles` 和 `natural_earth` 源前缀化，再叠加项目自己的可点击行政区面和记录状态。

中国边界采用 PMTiles 发布：县级最高生成级别为 11，浏览器通过 HTTP Range 按需读取，不再为中国范围写入数万个空 PBF 文件。`scripts/prepare-web.mjs` 只在本地生成资产，前端启动不访问 Overpass。服务端预览脚本支持 PMTiles 的 Range 请求。

联网下载已改为 `scripts/fetch-osm-china-boundaries.py`。它沿用旧版 `DownloadOsm.py` 的 HTTP Overpass 地址、POST 查询正文和 Python requests 连接方法，补充 Session、连接/读取超时、重试、失败批次拆分和逐查询缓存。原始响应保存在 `data/tmp/osm-china-python/`；原有有效缓存继续复用，离线转换由 `scripts/lib/prepare-osm-boundaries.mjs` 完成。

匹配必须核对简繁转换后的名称、行政级别与空间位置，行政代码作为辅助证据；不能只凭 OSM 的代码替换，因为实际数据中存在重复或填写错误的 `division_code`。旧粗略轮廓与 OSM 明显不一致时，只有名称、代码、层级及 OSM 显式父子关系同时支持，才允许替换；无旧几何的地区还需核对父区范围。未唯一匹配的目录 ID 保留原几何并写入报告。中国大陆实际使用 OSM 的 4/5/6 级关系对应省/市/县；港澳台按其自己的层级与名称匹配。

下载前准备 Python 环境（本机已配置 `.venv`）：

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r scripts/requirements-osm.txt
```

使用方式：

```text
.venv/Scripts/python.exe scripts/fetch-osm-china-boundaries.py --province 110000 --apply
.venv/Scripts/python.exe scripts/fetch-osm-china-boundaries.py --all --apply
.venv/Scripts/python.exe scripts/fetch-osm-china-boundaries.py --references
.venv/Scripts/python.exe scripts/fetch-osm-china-boundaries.py --all --apply --offline
node scripts/prepare-web.mjs
```

`--references` 下载的 `south-tibet`（关系 3202329）和 `aksai-chin`（关系 2713465）只放在 `data/boundaries/china-osm/references/`，不会自动改变地图目录；另记录阿鲁纳恰尔邦关系 2027346 作为上下文，明确它不等同于藏南。所有来源均保留 OSM 关系 URL、抓取时间和 ODbL 署名信息。

两份争议边界参考已实际下载并转换为闭合多边形：藏南 6,269 个顶点、阿克赛钦 4,684 个顶点；上下文阿鲁纳恰尔邦为 10,929 个顶点。原始响应另保留关系版本、源更新时间与 SHA-256。`--offline` 可以重新转换缓存而不请求网络；`--refresh` 才会主动更新快照。

逐省 `.geojson.report.json` 记录下载关系数、匹配、未匹配与不完整关系；`applied.json` 记录真正应用的范围，`python-download-report.json` 逐省更新本次运行进度。Overpass 仍可能返回 429/504，Python 不保证服务端响应速度；本机实测使用旧脚本的 HTTP 原始 POST 方式能取得几何，已成功批次无需重新下载。

底图样式与边界精度应分别验收：前者决定道路、颜色、文字和信息密度；后者决定区划位置、共边、点击和到访填色。仅换底图不会提高项目现有边界几何的精度。

### 实际完成范围

34 个省级范围与国界关系 270056 均已下载并应用。省内完整行政关系共 3,669 条，匹配到原目录 3,237 个地区；目录总计 3,246 个中国地区 ID 保持原身份。其中 2 个现行地区保留原几何：文登区未取得现行 OSM 区面；汉南区的关系 3076294 是包含其他区部分街道的经开区管理范围，不能替代单纯行政区。7 个撤销的历史地区保留原资料。

金门县经核对中文名称、ISO `TW-KIN`、行政层级及岛屿范围，使用 OSM 关系 3339695；项目目录层级保持原样。兴安区旧轮廓偏差较大，但名称、代码、层级与鹤岗市显式下辖关系一致，已安全替换。香港 6 个只有地名 label 节点的 Placeholder 关系被排除；港澳原有分区因共享特别行政区 ID 保留原几何，省/市聚合面使用新来源。

东城区边界现有 525 个顶点，上城区 2,158 个顶点，国界 152,796 个顶点。中国 PMTiles 最高 z11、extent 8192，前端可继续放大到 z15；瓦片几何可更细致地保留源面的曲线。未取得测绘级精度证据，不能把顶点密度等同于源数据完全准确。

已通过目录引用检查、全部前后端生产构建、17 个范围的地图资产检查和 51 个样式校验。实际浏览器读取 OpenFreeMap 矢量、中文字体与 PMTiles Range，验证杭州/上城区、浙江省、东城区近景、记录状态保持、底图开关、无底图 PNG 与底图服务失败回退。截图位于 `data/generated/liberty-map-checks/`。全仓类型检查此前发现的其他模块问题未纳入本轮修复，不能据构建成功宣称全仓类型检查通过。

边界瓦片失败、无 WebGL 和全部地图资源失败后的显式重试也通过。修复了 PMTiles 共享缓存保留失败 Promise 导致重试再次失败的问题；回退时重建该范围的读取器。GPS 空间匹配样本：故宫附近落在东城区，西侧样本落在西城区，杭州城区样本落在上城区；兴安区边缘样本 `(130.36,47.22)` 从旧几何的东山区改为新几何的兴安区，说明更新会实际影响轨迹/GPS 的归属结果。

### 数据运输

大型公共数据拆为固定版本的运行、OSM 源面和研究三个压缩包；代码仓库只需保留清单与同步脚本，按 SHA-256 恢复到本机。当前压缩包已生成并在空数据目录验证恢复，GitHub Release 由用户手工发布。开发者见[获取开发数据](data-download.md)，维护步骤和内容清单见[公共数据快照与同步](data-package-workflow.md)。README 仅保留项目介绍。

### STELE 风格调整

已在内置浏览器打开 STELE，核对杭州区域与街区级别的配色、道路、水系和标签，并读取普通/规划样式。方舆样式已删除底图国界、国名和洲名，水面标签只允许内陆湖泊/河流；城市及其他 place 标签继续关闭。调整陆地、居住区、公园、学校、医院、工业/商业用地和分级道路，建筑采用平面显示。道路名、水系名与少量普通公共设施点按缩放级别分批出现；仅中国地图优先中文字段，其它地图直接使用 OSM 默认名称，并降低水系名字号。项目遗产点与旅行标识保持独立。

完整规则、颜色与缩放门槛见[底图显示规则](basemap-style.md)。样式仍使用 OpenFreeMap 数据源；STELE 的自定义数据覆盖和分类差异不通过复制 JSON 解决。
