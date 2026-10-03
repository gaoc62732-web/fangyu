# 法兰西岛与巴黎限定下钻

基线 `a97b47e47d03051d0f462a33dc342e030448244e`，开发分支 `feature/france-idf-paris-20261003`，应用保持 `0.7.1-dev`，目录更新为 `2026-10-03.15`。不扩大为全法国省级项目。

## 范围与兼容

- 原法国18个大区及其ID、父级、几何完整保留。法兰西岛 `FR-IDF` 增加8个省级单位：75、77、78、91、92、93、94、95。
- 巴黎75下增加市辖区75101—75120，使用20份独立面。Paris Centre只作第1—4区合署管理说明，不合并几何、不增加第21区。
- 地图点击、三级选择器、路径按钮及返回上一级联动；法国选择写入URL，刷新及浏览器后退前进可恢复。
- 分别显示18大区、8省级单位、20市区的到访数，不把不同层级合成一个总数。本页法国旅行状态显式独立，不自动向父或子传递。
- 35,897条旧地点和3,967个旧地区逐字段保持，新增28地区、零地点。旧地点仍归原大区，尚未推断到新省/市区；下级列表空态明确说明。
- 个人记录版本兼容、名称、备注、自定义地点与撤销机制保留，成就目标及数量分母不变。

## 来源与边界

成员依据INSEE COG 2026：[法兰西岛8省](https://www.insee.fr/fr/metadonnees/geographie/region/11-ile-de-france)、[巴黎20市辖区](https://www.insee.fr/fr/metadonnees/geographie/departement/75-paris)。

省面来自[data.gouv.fr Contours administratifs](https://www.data.gouv.fr/datasets/contours-administratifs)2025年100米简化数据；区面来自[巴黎市Arrondissements](https://opendata.paris.fr/explore/dataset/arrondissements/information/)，元数据修改日期2016-03-04。二者均按ODbL保留署名和许可。成员核对年份不冒充几何测绘年份。不同精度的层间边缘可能有细小差异，未改写来源形状消除差异。

研究包与重现方法见 `data/extensions/research/FRANCE-IDF-PARIS-BOUNDARIES.md`。省瓦片到z9、区瓦片到z12；简化地图区面使用更细容差。

## 验证与审阅

- `pnpm typecheck`、完整构建、`verify-catalog.mjs`通过。
- `verify-france-drilldown.mts --generated`：旧目录、个人记录、分层计数、重复操作、撤销和JSON往返通过。
- `verify-map-assets.mts`：17专题原始几何与发布副本一致，51地图样式通过，法国city层完整8、county层完整20。
- `verify-france-ui.mjs`：逐个真实点击20个市区，返回、刷新、浏览器历史、三语/别名检索、父子记录独立、1440/768/390宽度、成就往返及简化地图导出。
- 原主界面/成就9组回归、旧8国专题/遗产/球场回归通过。测试均使用隔离浏览器与合成记录，不读取用户浏览器记录。

证据目录：`data/generated/france-drilldown/verification.json`、`data/generated/france-ui-checks/`、`data/generated/france-integration-regression/results.json`。本地开发预览 `http://localhost:5191/#/france`；稳定 `http://localhost:5190` 保持0.7.0快照。未推送、合并远端或部署。

## 后续建议（本轮不实施）

1. 先逐地点核实巴黎地点的省/区归属，再扩展新层地点列表；不能只凭代表坐标批量分配。
2. 巴黎区面较密，可增加可开关区号标注，减少仅靠悬停辨认。
3. 延续按需加载优化，减少构建中仍存在的地图页和导入页大包警告。
