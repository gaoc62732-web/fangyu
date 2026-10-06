# 公共数据快照与同步

代码仓库保存程序、配置、轻量来源报告和固定版本清单 `data/snapshots/current.json`；公共大数据以 GitHub Release 附件运输。开发时数据仍在本机读取，无需先搭建数据服务器。前端瓦片在本地生成，不作为源码提交。

## 当前数据包

数据版本 `osm-20261004-v072`，共 73 个文件。三个压缩包共约 163 MiB，采用 gzip 压缩；原始 GeoJSON/JSON 含大量完整坐标，因此体积仍较大。runtime 包包含 0.7.2 的“丞相祠堂”目标修订，完整保留中国精细边界；未变化的 osm-source 和 research 包复用 `osm-20261004` 附件。

| 包         | 文件数 | 压缩大小 | 内容                                                                               | 适用情况                                                                 |
| ---------- | -----: | -------: | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| runtime    |     19 | 83.5 MiB | 公共目录、17 个国家/世界地图几何和目录清单；中国省、市、县精细面与国界线           | 启动前端、后端和常规开发必需                                             |
| osm-source |     39 | 72.9 MiB | 34 个省级范围的 OSM 行政关系 GeoJSON、国界 GeoJSON、3 个独立参考范围、港澳保留分区 | 下载、核查、重新匹配和处理边界时需要                                     |
| research   |     15 |  6.5 MiB | 各国边界研究、机场与遗产位置关联、球场与遗产资料、东南亚显示策略及核查样例         | 当前完整构建需要，其中机场关联被前端引用，海域显示策略被资源生成脚本引用 |

这些文件不包括 `data/generated/` 的 PMTiles/PBF、Overpass 原始响应缓存、个人记录、密钥、`.env`、依赖和工具运行时。源面与已绑定目录 ID 的运行几何有内容重复，这是为保留重新处理能力。一般开发者同步 `runtime` 和 `research` 即可；不修改边界时无需同步 `osm-source`。

已发布旧快照包含 3,669 条完整省内行政关系面，映射到 3,237 个目录地区，另应用国界关系 270056。2026-10-06 的本地校订重建汉南、文登，移除历史面并处理已确认特殊边界，见[中国边界整理记录](china-boundary-review-2026-10-06.md)。本地校订尚未发布到旧快照；research 打包规则现包含校订面、来源和修改前参考。香港 6 个只有 label 节点的占位关系不发布为多边形。原 OSM 覆盖报告仍描述导入前的原始匹配。

## 手工上传到 GitHub Release

以下为数据维护者发布快照的步骤。开发者获取已发布附件请直接阅读[获取开发数据](data-download.md)。

1. 打开 https://github.com/gaoc62732-web/fangyu/releases/new 。
2. 新建标签 **`data-osm-20261004`**，选择用于保存当前代码的分支；标题填写“方舆公共数据快照 osm-20261004”。它是数据快照，建议勾选预发布（pre-release），不要设为最新应用版本。已有该 Release 时，编辑其附件即可。
3. 在附件区域上传 `data/generated/data-packages/` 中以下 4 个文件，保持文件名原样：

```text
fangyu-data-runtime-osm-20261004-v072.tar.gz
fangyu-data-osm-source-osm-20261004.tar.gz
fangyu-data-research-osm-20261004.tar.gz
current.json
```

4. 描述可以填写：“方舆公共地理数据快照。runtime 为运行目录和边界，osm-source 为边界源面，research 为公共研究与核查数据。附件不含个人记录和密钥。来源与许可见项目 docs/data-notices.md；OSM 数据 © OpenStreetMap contributors，ODbL 1.0。各文件 SHA-256 见 current.json。”
5. 等全部附件上传完成后，点击 Publish release。预计地址：https://github.com/gaoc62732-web/fangyu/releases/tag/data-osm-20261004 。
6. 在另一台机器恢复并校验成功后，再将原来跟踪的大数据移出 Git 索引，并一起提交同步脚本与清单。不要删除本机数据文件。

`.gitignore` 只影响尚未跟踪的文件。已经跟踪的 `data/catalog/*.json` 和研究 JSON 仍会被 Git 提交；上传完成后执行 `npm run data:detach`，它仅取消清单中已跟踪文件的版本管理，保留本机文件。Git 的历史提交仍含旧数据；这一步只停止新的数据更新进入代码历史，不重写旧提交。

已上传最初三个数据包时，本次只需追加 `fangyu-data-runtime-osm-20261004-v072.tar.gz` 并替换附件 `current.json`；原来的 runtime 包可以保留，供旧代码使用。不需要重新上传 osm-source 和 research 包，仓库清单会继续使用它们原来的文件名与 SHA-256。

## 另一台机器同步

需要 Python 3.10+，同步脚本只用标准库，不需要安装 Python 依赖。安装 Node.js 依赖后，在项目根目录执行：

```sh
npm run data:sync -- --group runtime --group research
npm run data:verify -- --group runtime --group research
npm run prepare:web
npm run dev:web
```

需要重新处理 OSM 边界时，再执行：

```sh
npm run data:sync -- --group osm-source
```

下载地址、版本、附件与各文件 SHA-256 由仓库内清单固定，不追随 GitHub 的 latest。下载压缩包会缓存到 `data/generated/data-packages/`。脚本先校验整包，再校验每个文件，全部通过后写入数据目录；本地存在不同内容时停止，保留本地修改。确认备份后才使用 `--overwrite`。

仓库为私有时，Release 附件也需要账号权限。可先在登录后的浏览器手工下载附件，再执行：

```sh
npm run data:sync -- --directory /path/to/downloaded-packages --group runtime --group research
```

Windows 可以把 `/path/to/downloaded-packages` 换成实际下载目录并加引号。

## 后续更新

修改公开数据后，使用一个新的、不可变的数据版本，例如 `osm-20261010`：

```sh
npm run data:pack -- --version osm-20261010 --base-url https://github.com/gaoc62732-web/fangyu/releases/download/data-osm-20261010
```

上传到同名新标签的 Release，提交新的 `current.json` 和关联代码。不要用不同内容覆盖同一版本附件。开发者拉取代码后按新的清单同步；日常仅修改样式或应用代码时不重新下载数据。

长远可把运行数据库与地图 PMTiles 放到对象存储/CDN，保留相同的版本和校验机制。当前方案解决跨机器同步，尚未提供远程数据 API。
