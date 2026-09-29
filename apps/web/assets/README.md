# 方舆展示资源

`fangyu-seal.woff2` 从项目原版 `3decac6` 的“地图/方舆旅游手册地图_空白审核版.html”内嵌 FangyuSeal 字体提取，保留原项目使用范围和来源。没有添加外部字体服务。

展示元数据位于 `src/features/achievements/legacy.json`，同样提取自该提交。维护时可运行 `node scripts/extract-legacy-presentation.mjs` 重新提取；正常构建不依赖旧提交存在。
