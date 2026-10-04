# 获取开发数据

公共地理数据通过 [GitHub Release](https://github.com/gaoc62732-web/fangyu/releases/tag/data-osm-20261004) 提供。当前清单版本为 `osm-20261004-v072`，runtime 包包含 0.7.2 的目录修订，边界源包和 research 包沿用原快照。代码中的 `data/snapshots/current.json` 固定所需版本、附件名和 SHA-256；拉取代码后按该清单同步，不使用 GitHub 的 latest。

## 常规开发

先按[安装与启动](getting-started.md)安装 Node.js 依赖，并准备 Python 3.10+（同步脚本无需额外 Python 库）。在项目根目录执行：

```sh
npm run data:sync -- --group runtime --group research
npm run data:verify -- --group runtime --group research
npm run prepare:web
npm run dev:web
```

`data:sync` 自动下载、校验并恢复数据；`prepare:web` 在本机生成前端地图资源。若 Python 命令不可用，可将环境变量 `FANGYU_PYTHON` 设为 Python 可执行文件的完整路径。

| 数据包     | 压缩大小 | 内容与用途                                             |
| ---------- | -------: | ------------------------------------------------------ |
| runtime    | 83.5 MiB | 公共目录、各地图范围的运行边界；常规开发必需           |
| research   |  6.5 MiB | 机场/遗产关联、海域显示规则等；当前构建必需            |
| osm-source | 72.9 MiB | OSM 行政区源面、国界与独立参考范围；重新处理边界时需要 |

需要边界源数据时额外执行 `npm run data:sync -- --group osm-source`。

## 手工下载或私有仓库

登录有仓库权限的 GitHub 账号，在对应 Release 的 **Assets** 中下载所需 `.tar.gz` 附件到同一目录，保留原文件名，无需手工解压。当前常规开发需要：

```text
fangyu-data-runtime-osm-20261004-v072.tar.gz
fangyu-data-research-osm-20261004.tar.gz
```

以 Windows 下载目录为例：

```sh
npm run data:sync -- --directory "C:/Users/你的用户名/Downloads" --group runtime --group research
npm run data:verify -- --group runtime --group research
npm run prepare:web
npm run dev:web
```

以仓库里的清单为准，无需用附件 `current.json` 覆盖它。自动下载失败或返回 404 时，先核对账号权限、Release 标签和附件名称。

## 更新与本地修改

拉取新代码后，清单版本有变化才需要再次同步。压缩包缓存于 `data/generated/data-packages/`；数据恢复到项目的 `data/` 目录。本地数据与快照不同时脚本会停止，先保存自己的修改，确需替换时再给同步命令添加 `--overwrite`。个人记录不在这些数据包中。

上传与快照维护见[公共数据快照与同步](data-package-workflow.md)，来源和许可见[数据来源说明](data-notices.md)。
