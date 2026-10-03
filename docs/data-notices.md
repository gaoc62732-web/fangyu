# 数据来源与再分发说明

本说明与 0.7.1 的结构化数据和地图一并分发。不同来源的数据保留各自许可；代码的分发不改变数据许可。加工后的边界位于 `data/catalog/*.geo.json`，完整结构化目录位于 `data/catalog/catalog.json`。这些文件提供对应派生数据库的可机读形式。

## 地图及地名

| 数据                                   | 来源及许可                                                                                                                                                                                                                   | 本项目加工                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 印度尼西亚 38 省                       | [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)；[Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) 陆地，Public Domain | 2026-10-03 获取 OSM 行政关系，与陆地相交以减少海域着色；保留原地区 ID。旧 BIG 研究几何不随公开发行包分发。 |
| 日本、泰国、马来西亚、乌兹别克斯坦边界 | geoBoundaries 所列 OSM / Wambacher 来源，ODbL 1.0；© OpenStreetMap contributors                                                                                                                                              | 转换坐标结构、绑定地区 ID、生成简化图形和瓦片；保持来源许可。                                              |
| 法国大区、法兰西岛各省                 | [Contours administratifs](https://www.data.gouv.fr/datasets/contours-administratifs)，2025，ODbL 1.0                                                                                                                         | 筛选、层级关联、简化及瓦片化。                                                                             |
| 巴黎二十区                             | [Ville de Paris / Direction de l’Urbanisme](https://opendata.paris.fr/explore/dataset/arrondissements/information/)，ODbL 1.0                                                                                                | 按官方区编号关联，绑定原目录 ID，简化及瓦片化。                                                            |
| 越南 34 省                             | [OCHA / HDX COD-AB](https://data.humdata.org/dataset/cod-ab-vnm)，2025，CC BY 3.0 IGO                                                                                                                                        | 保留源边界；显示与交互排除清单明确的 328 个海域组件，生成地图时应用。                                      |
| 新加坡规划区                           | [URA / data.gov.sg](https://data.gov.sg/datasets/d_4ce0038f7ac689652350bb91b7fb92ed/view)，[Singapore Open Data Licence 1.0](https://data.gov.sg/open-data-licence)                                                          | 结构转换、简化和瓦片化。                                                                                   |
| 文莱                                   | [geoBoundaries ADM1](https://www.geoboundaries.org/api/current/gbOpen/BRN/ADM1/)，发布方标注 Tachymètre 2011 / Public Domain                                                                                                 | 保留发布方元数据；原始文件精确链条尚未完整闭合，不宣称重新确认了原作者输入文件。                           |
| 德国                                   | © GeoBasis-DE / BKG 2021，[Datenlizenz Deutschland – Namensnennung 2.0](https://www.govdata.de/dl-de/by-2-0)                                                                                                                 | 结构转换、地区关联、简化和瓦片化。                                                                         |
| 意大利                                 | ISTAT 2023 / geoBoundaries，固定数据标注 [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)                                                                                                                           | 保留固定快照许可，不将其自动改为官网后来的许可版本。                                                       |
| 西班牙                                 | IGN 2017 / geoBoundaries，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                                                                                                          | 结构转换、简化和瓦片化；本次未重新取得 CNIG 条款页。                                                       |
| 美国                                   | U.S. Census Bureau 2018，Public Domain                                                                                                                                                                                       | 结构转换、简化和瓦片化。                                                                                   |
| 英国历史郡                             | [Historic Counties Trust](https://county-borders.co.uk/)，Definition A；源网站允许个人、教育及商业使用并要求致谢                                                                                                             | 历史边界而非现行行政区；保留致谢，不擅自改标 CC BY。                                                       |
| 国家和地区名称                         | [mledoze/countries](https://github.com/mledoze/countries)，ODbL                                                                                                                                                              | 中文名关联；原始名称与标识保留。                                                                           |

OSM 及其他 ODbL 来源的派生数据库部分继续按 ODbL 提供。生成的地图保留来源署名；导出 PNG 同样附带适用来源。中国、世界及韩国等原有目录的来源记录保留在目录中，本轮未重新测绘或验证每条边界。地图供旅行记录使用，不用于法律或测绘边界认定。

## 机场、遗产与球场

- 机场基础资料与经核实的机场坐标关联来自 [OurAirports](https://ourairports.com/data/)，Public Domain。机场开闭、同码旧址和新址存在歧义时不强行关联。
- 世界遗产主项目元数据来自 [UNESCO DataHub whc001](https://data.unesco.org/explore/dataset/whc001/)，[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。中文整理、地区关联等修改在派生字段中说明；该部分沿用相同许可。
- WHC 组成部分、国家遗迹及地方官方资料的核实结果是名称、认定 ID、日期、单点坐标与自写摘要。来源 URL 和坐标证据保留。**不将 UNESCO DataHub 的许可扩大解释为覆盖所有 WHC 地图、申遗文件或其他机构资料**；不随发行包复制未许可的原始 PDF、照片、正射图及完整网页。部分来源没有独立开放数据库许可，不对源站原件作再许可。
- 足球场地中的 OSM 坐标来自具体场地要素，© OpenStreetMap contributors，ODbL 1.0。各条目的 `coordinateSourceUrl`、`coordinateAttribution` 及核查资料保留来源。官方球队、场馆等公开事实与自写说明不包含队徽或网页图片。
- 丞相祠堂与历史年代的官方来源保留在成就详情中；只摘取核实的事实，不复制整篇原文。

## 未附带的资料

公开包不包含本机地图密钥、个人记录、浏览器数据库、研究全文缓存、未经许可的原始 PDF／影像、旧 BIG 印尼几何或许可不明的篆体字体。字体使用系统楷体／衬线回退；系统字体文件不随包分发。

源数据的缺项、译名、位置精度、项目代表点和待核条件仍以条目中的说明为准。引用来源不等于该来源认可本项目或本项目的中文译名。
