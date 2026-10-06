# 安装与启动

在 Windows 中，将项目解压到可写目录，保留目录结构。双击根目录的 `安装依赖.cmd`，首次安装需要联网；安装完成后双击 `启动前端.cmd`，在浏览器打开命令窗口显示的网址，通常为 http://localhost:5173 。使用过程中保持命令窗口开启。

macOS/Linux 安装 Node.js 24 LTS 后，在项目目录执行：

```sh
sh install.sh
npm run dev:web
```

程序需要 Node.js 22.12 或更新版本。Windows 安装器可以在项目内安装缺少的 Node.js；安装过程不启动数据库。服务端配置见[数据库初始化](first-round-migration.md#服务端初始化)。

本地模式的记录存储在当前浏览器的 IndexedDB 中。清理浏览器数据或切换访问地址会影响本地记录，请定期导出 JSON 备份。服务端模式与本地模式不自动同步。

从源码仓库获取项目时，先按[获取开发数据](data-download.md)同步公共地理数据包，再启动应用。

## 开发校验

安装依赖后，在项目根目录执行 `node node_modules/pnpm/bin/pnpm.cjs check`，检查无入口源码与失效的本地源码引用、全工作区类型、`scripts/*.mts` 的类型和当前实现的回归测试。测试使用合成公共目录，不需要个人记录、数据库或完整地理数据包。单独检查数据脚本可执行 `node node_modules/pnpm/bin/pnpm.cjs check:scripts`；JavaScript 脚本的函数体尚未纳入类型检查。

生产构建执行 `node node_modules/pnpm/bin/pnpm.cjs build`，需要已同步的公共数据包。构建结束后自动根据 Vite manifest 检查地图引擎和 ExcelJS 仍按需加载，并输出 JavaScript 模块体积；已有构建可通过 `node node_modules/pnpm/bin/pnpm.cjs check:bundle` 复查。模块体积不代表浏览器实测耗时。代码审查与清理结果见[代码质量审查](code-quality-review-2026-10-05.md)。
