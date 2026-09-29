# 目录来源与统计口径

本轮数据来自 Git 提交 3decac6 中 v0.5.0 目录及内嵌地图的结构化转换。当前版本为 data/catalog/manifest.json 中的版本。迁移改变数据组织和 ID，没有对每项公开资料进行重新核验，也没有抓取新的数据替代原目录。

各目录项目保留已有 source、代码、年份和坐标；总体来源见 catalog.json 的 sources，成就目标的来源与暂缓理由保存在 achievements.definitions。来源中原有的资料日期照录，不表示本轮重新访问或验证过链接。

## 地图与地点来源

| 资料           | 原来源和许可标注                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 中国与世界底图 | 原工程已有边界；两江新区采用近似范围，部分历史条目无对应边界                                                              |
| 台湾交通       | [台铁车站基本资料](https://data.gov.tw/dataset/33425)，沿用原目录过滤规则                                                 |
| 台湾县市边界   | 国土测绘中心 1140318，[GeoJSON 转换版](https://geo.maderaojen.me/)                                                        |
| 全球机场       | [OurAirports](https://ourairports.com/data/)，Public Domain                                                               |
| 世界遗产       | [UNESCO DataHub](https://data.unesco.org/explore/assets/whc001/)，原标注 CC BY-SA 4.0，2026-09-19 版本                    |
| 世界中文名称   | [mledoze/countries](https://github.com/mledoze/countries)，ODbL                                                           |
| 日本行政边界   | geoBoundaries JPN ADM1，OSM/Wambacher 2017，ODbL 1.0；预览几何                                                            |
| 日本铁路       | MLIT N02，原标注 2025-12-31，CC BY 4.0                                                                                    |
| 日本机场、遗产 | 原方舆世界目录，MLIT 机场名单和 UNESCO Japan 名单作为复核来源                                                             |
| 韩国边界       | geoBoundaries KOR ADM1，Natural Earth 2021，构建 2023-12-12，原标注 public-domain source                                  |
| 韩国交通及史迹 | Korea Airports Corporation、Korea National Railway、Rail Data Portal、Korea Heritage Service 等，详细日期在目录来源对象中 |

保留原世界遗产署名：**Copyright © 1992–2026 UNESCO/World Heritage Centre. All rights reserved.** 仅迁移名称、代码、年份、所属国家、坐标等基础字段及原链接。

地图边界、点位和空间命中受来源、时间、比例尺及精度影响，仅供旅行记录参考，不代表权威现行区划或测绘结果。世界目录中的国家、属地及特殊区域按原来源组织，不直接等同于国家数量。跨国遗产统计按 UNESCO 编号去重。

台湾目录保留金门、马祖在原手册中的归属方式；台铁和高铁同名站分别记录。韩国专题沿用原有 16 地区结构，与现行 17 个一级行政区并不完全一致；铁路清单尚不完整。日本国宝未核定长期保存地点的项目不分配到府县，不能自动算作全部已完成。

## 成就和卯分

到达、短居、居住计入政区成就；途经、飞跃、未到达不计。项目取消不会自动取消地区状态。父级推断尊重显式的手动降级，不把“到访所在县区”解释成“到达极点、登顶或访问榜单机构”。

卯分沿用省级 1、地级 0.2、县级 0.05 的权重及目录口径；数量分母随当前目录定义，不能以行政区划总数替代。

趣味成就包括原有政区趣题、极值、2025 百强县区和地名文字：

- 四极使用漠河、抚远、乌恰、三沙市南沙区；大陆四极用徐闻替代南沙区。
- 海拔按“县域包含极值点”口径，使用定日县与高昌区。
- 2025 赛迪百强县、百强区固定在该版，不因未来榜单变化覆盖目标。排序及新版地区 ID 见 [固定榜单](../data/references/ccid-2025.json)。
- 地名字义保留原专名与民族后缀排除规则；“一”的单县/个旧、十堰等意象口径保留在成就说明。
- 年均气温最高/最低与 GDP 最高/最低名单仍待核，不颁发相应徽章。
- 全国制霸等目录未完整的成就保留暂缓理由。

榜单来源：[2025 赛迪百强县](https://www.ahchanye.com/cyxt/57190.html)、[2025 赛迪百强区](https://m.maigoo.com/news/739827.html)。发布信息原引用：[昆山市政府](https://www.ks.gov.cn/kss/ttxw/202507/44e27503db5a44e697cf171d550447ac.shtml)、[广东省委港澳办](https://www.gdhmo.gov.cn/xwzx/hzjl/shfz/content/post_98670.html)。原县榜“伊金崔洛旗”笔误按目录名“伊金霍洛旗”修正。

极值原引用：[漠河](https://mohe.gov.cn/mohe/c101200/mhgk.shtml)、[抚远](https://hljfy.gov.cn/fys/c101455/tt.shtml)、[乌恰](https://www.xjwqx.gov.cn/xjwqx/c102695/202109/fcf5163a63fc4e8885fce013c45029c8.shtml)、[三沙南沙区](https://www.zjsjw.gov.cn/shizhengzhaibao/202004/t20200419_2616234.shtml)、[徐闻](https://www.zhanjiang.gov.cn/bmsd/content/post_1907833.html)、[定日](https://wlt.xizang.gov.cn/xccx/lytg/202111/t20211118_270402.html)、[高昌](https://gcq.tlf.gov.cn/gcq/c106599/gkxx.shtml)。

## 目录更新方法

1. 修改 data/catalog 中的结构化目录或几何，保留已有实体 ID；新实体分配新 ID。
2. 更新目录版本、manifest、数据来源与变更说明。不要从旧 HTML 或 Excel 行号重新生成身份。
3. 执行 npm run catalog:check，核对记录主体、地区树、专题归属、几何与成就目标的引用。
4. 对变动地区和点位进行地图人工复核，检查跨页面共享记录及成就统计。
5. 同一部署中的前端、API 与备份使用一致的目录版本；当前开发版对不同目录版本的存档明确拒绝，不静默套用。

本次未引入原始行程或个人照片。data/fixtures/station-names.txt 仅供名称导入练习，不代表任何人的旅行记录。
