# 旧功能替代与文件清理

基线为 v0.5.0 / Git 3decac6。本轮已按开发阶段的破坏性改造要求，取消旧格式兼容。下表“已实现”指有实际源码和界面接入，非运行测试结论；浏览器与数据库行为仍待联调。

| 原功能                       | 当前实现                                          | 替代情况                                           |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| 中国目录、层级与地图         | catalog、CatalogPage、MapSurface、canvas-renderer | 地区树、三级地图、选择、搜索、类别着色已实现       |
| 世界地图与坐标点             | 世界 scope、目录坐标、Canvas 点位                 | 已实现；缺失坐标继续只在目录显示                   |
| 日本、韩国专题               | 统一目录页、专题归属、铁路字段                    | 地区/类别/铁路类型筛选及国家关联已实现             |
| 六级到访和父级带入           | HandbookSession                                   | 结构化状态、只提升导入、手动降级已实现             |
| 主项目、组成项目             | EntryList、Session 的共享记录                     | 标记、部分到访、个人名称和备注已实现               |
| 个人增补项目                 | CatalogPage、customEntries                        | 新增、删除及 JSON 备份已实现                       |
| 撤销、存档、清空             | store、Session、SettingsPage、存储层              | 撤销、自动备份、命名/改名/删除/恢复已实现          |
| 成就和趣味规则               | domain/achievements、目录中的声明式定义           | 458 个固定定义、动态数量/要素成就、来源详情已迁移  |
| 卯分                         | domain/achievements、AchievementsPage             | 权重计算、分省排序与 CSV 已实现                    |
| JSON 导入导出                | 新版 records 契约、ImportsPage                    | 完整备份/恢复；旧单元格 JSON 与旧 HTML 不再支持    |
| Excel 双向转换               | import-export/workbook、ImportsPage               | 新版 ID 记录表已实现；取消原工作簿版式与模板修补   |
| 名称、车站与机场导入         | names、文本/DOCX 解析、统一预览                   | 地区限定、别名、同码歧义及同机场跨地区候选已实现   |
| Railtrack 历史记录           | railtrackPlan                                     | 所列沿途车站县区、起终点乘降候选和预览已实现       |
| KML / OSM / PBF              | 格式解析器、空间索引、ImportsPage                 | 批量文件、手选 OSM 要素、空间匹配与 KML 导出已实现 |
| 照片 GPS                     | photo parser、photoPlan                           | 本地元数据提取、县区命中、歧义核对已实现           |
| CSV / PNG                    | exports/download、canvas-renderer                 | 目录、卯分、核对清单及地图导出已实现               |
| 主题和配色                   | appearance、store、SettingsPage                   | 预设、自定义地图颜色及深色界面已实现               |
| Excel→地图兼容助手           | 新版 Excel 导入                                   | 用途已替代，不再维护独立 HTML                      |
| 地图→Excel Python 脚本       | 浏览器 ExcelJS 导出                               | 用途已替代，不再要求 Python/openpyxl               |
| 审核说明、成就说明、打开说明 | README、迁移文档、数据说明、应用帮助              | 已按新项目结构重写                                 |

## 主动改变的旧行为

- 取消直接双击 HTML 运行，改为 Vite 前端入口。
- 取消旧 HTML 个人记录嵌入导出，使用 JSON 完整备份。
- 取消旧 Excel 模板和旧存档兼容，采用独立实体 ID。
- 取消将勾号嵌入名称和单元格文本；主项、子项、地区分别保存。
- 不再以 GitHub Pages 直接发布仓库根目录；后续发布应使用前端构建产物。
- 本地记录与服务端记录分别存储，不实现离线双向同步。

## 已清理

- 原地图单文件 HTML、根目录 HTML 入口与旧打开说明。
- 工具目录中的 Excel 助手、SheetJS 内嵌库及其随附许可、单元格映射、反向转换 Python 工具。
- 旧版兼容测试、审核反馈、文件校验清单、旧 CHANGELOG、VERSION、.nojekyll。
- 旧数据提取中间产物、一次性解析器格式化脚本和失效根目录 .env.example。

可复用的 100 个车站样例移入 data/fixtures；2025 赛迪榜单移入 data/references，地区 ID 已转换。数据来源、许可标注、成就口径集中保存在 [数据说明](data-sources.md) 及新版目录中。

当前新应用不读取任何旧文件。删除依据是新入口与源码职责覆盖；旧版基线保留在 Git 3decac6，可供后续人工核对。完整功能回归安排在下一轮联调，不将本次静态检查表述为上线验收。
