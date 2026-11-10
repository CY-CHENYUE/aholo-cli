# Aholo CLI

独立的命令行工具，将 Aholo 官方 Asset/Lux3D API 与 SDK 封装为 Codex、Claude Code 和终端可以调用的命令。这是社区工具，并非 Aholo 官方发布的 CLI。

需要 Node.js >=22.12。可独立运行，不依赖网页或其他应用。

## 从源码运行

```sh
git clone https://github.com/CY-CHENYUE/aholo-cli.git
cd aholo-cli
npm ci --ignore-scripts
npm run build
node bin/aholo.mjs --help
node bin/aholo.mjs capabilities --json
```

以下示例中的 `aholo` 可替换成 `node /绝对路径/aholo-cli/bin/aholo.mjs`。

将 API key 放在 `AHOLO_API_KEY` 环境变量中，或通过安全的标准输入保存：

```sh
aholo config set --api-key-stdin
aholo config show --json
```

`--api-key-stdin` 从标准输入读取至 EOF；支持管道或由本机凭据管理器提供。不要将密钥写进命令参数、项目文件或聊天。配置文件权限 600，配置目录默认 `~/.config/aholo-cli`；可用 `--home` / `AHOLO_CLI_HOME` 指定隔离位置。配置优先级是显式选项、环境变量、所选 profile、默认值。区域支持 `cn`、`com`。

## 生成与恢复

```sh
aholo lux3d image-to-3d --image '/路径/参考 图片.png' --request-id robot-001 --dry-run --json
aholo lux3d image-to-3d --image '/路径/参考 图片.png' --request-id robot-001 --json
aholo lux3d text-to-3d --prompt '一只圆润的玩具机器人' --request-id robot-text-001 --json
aholo lux3d task wait 123456 --max-wait 600 --json
aholo lux3d task download 123456 --out-dir './生成结果' --json
```

创建默认只返回 `taskId`。加 `--wait` 等待；加 `--download` 等待并保存所有输出。图文生成默认显式使用 G1-Turbo、50000 面、GLB、PBR 与尺寸预测，均可用参数调整。

复杂输入支持 `--request params.json` 或 `--request -` 读取官方 JSON；相同字段不能同时在 JSON 和 flags 中声明。支持本地 PNG/JPEG/WebP 参考图及模型文件，CLI 自动走官方上传。`--images` / `--image-urls` 保持多视图顺序。每个文件最多 256 MiB，总输入最多 512 MiB，单个下载最多 2 GiB。

**同一次意图使用同一个 request ID。** CLI 把内容哈希、默认参数、操作、区域/profile/凭据身份纳入本机去重。相同 ID 的并发进程仅允许一次提交；不同输入会报冲突。省略 ID 会生成并返回一个 UUID。

提交后断线或进程被强制终止可能进入 `uncertain`，此时禁止自动重交。通过 `request get ID` 检查记录，再查询官方任务列表；确认某个既有 taskId 后可以运行 `request attach ID --task-id 123456`。不要根据相似提示词自动认领任务。去重仅作用于同一个 CLI home；更换 home、删除记录或新 request ID 不具备服务端防重保障。

本机 SIGINT/SIGTERM 只中断等待/操作，不取消云端任务。官方未公开取消接口，CLI 不虚构取消命令。已失败的任务不会自动创建替代任务。

占位文件不会回收或重新开放提交：如果上传在生成前失败，核对后请用新 ID 作有意重试；如果提交结果不明，则必须先核对既有任务。同一个 ID 的任务编号已知但本机保存失败时，错误 JSON 仍会携带编号，直接沿用它查询。

## 下载和机器输出

下载会重新查询既有任务，展开四视图数组/动作 JSON，忽略 `NOT_REQUESTED`。保存到 `<out-dir>/task-<taskId>/`，使用 `.part` 临时文件、内容长度/格式检查和原子落盘；`files.json` 记录内容哈希。已记录且一致的文件可复用；同名异内容默认报错，显式 `--overwrite` 才允许覆盖。部分失败保留已完成文件，并返回失败信息。

官方链接约 2 小时有效；下载遇到过期状态会重新查询同一任务一次，不保证官方一定刷新地址，也不会重新生成。

`--json` 等价于 `--output json`：stdout 只输出一个 JSON 对象，进度写 stderr。help/version/describe/参数错误也支持 JSON。`--quiet` 禁用进度，`--verbose` 只增加操作说明。`--describe --json` 不需要密钥；`--dry-run` 不访问网络、不写请求记录。正常结果 URL 保留，错误和诊断会去除签名参数及密钥；不要把账号回执或签名 URL 提交进仓库。

| 退出码 | 含义 |
| --- | --- |
| 0 | 命令成功；get 只表示查询成功，应再读 data.status |
| 1 | 本机通用错误 |
| 2 | 参数、文件或配置错误 |
| 3 | 任务仍运行、等待到期或同 ID 正被其他进程处理 |
| 4 | 提交结果不明，需要核对 |
| 5 | 官方拒绝/任务失败/部分动作失败 |
| 6 | 网络、鉴权或下载失败 |
| 130 | 本机中断 |

## 完整命令与 Skill

Asset 上传，图生/文生 3D、多模态生图、四视图、材质迁移、格式导出、部件拆分、关节动画、绑骨、动作重定向，以及任务 get/list/wait/download 均有命令。参数、官方 operationId 和请求 schema 由同一命令目录生成，见 [命令参考](reference/commands.md)，或运行具体命令的 `--describe --json`。

```sh
aholo skill export '/目标目录/aholo-cli'
```

目标目录必须为空。根据宿主的 Skill 路径选择导出位置，先对照 `aholo --version --json` 与 Skill 中的版本。命令本身可以直接通过 Codex / Claude Code 的终端使用，无需安装 Skill 或 MCP。导出不会自动注册宿主，也不会更改全局配置。

## 打包与验证

```sh
npm run check
npm test
npm run check:generated
npm pack --pack-destination /临时目录
npm install --prefix /本机选定目录 /临时目录/zaowuxia-aholo-cli-0.1.0.tgz
/本机选定目录/node_modules/.bin/aholo --version --json
```

打包白名单只包含命令入口、构建产物、schema、参考、Skill 和许可/说明。`private: true` 防止误执行 npm 发布，不影响从 GitHub 获取源码或安装本地 tarball。升级时在所选安装位置换装新包，再导出匹配版本 Skill。

## 支持范围

| 能力 | 验证范围 |
| --- | --- |
| 图生/文生 3D | G1-Turbo、GLB 已完成真实服务生成和下载；其他组合按官方契约校验 |
| 文件上传 | 单文件SDK上传随图生链路验证；分块上传通过模拟服务验证 |
| task get/wait/download | 真实任务链路及模拟边界测试；list通过模拟验证 |
| 生图/四视图/材质/导出/拆分/动画 | 已实现并通过官方SDK模拟契约测试，未逐项提交真实任务 |
| Agent调用 | Codex与Claude Code终端调用经过验证；需要宿主提供Node环境及自身模型连接 |

测试使用假凭据和本机HTTP服务，覆盖请求映射、跨进程防重、断线/中断恢复、下载完整性及机器输出。模拟通过不能保证账号有相应服务权限，也不代表所有模型都适合拆分、绑骨或动画。高级生成需要用户自行选择输入和操作。

运行数据和API key保存在所选CLI home/输出目录。请勿将凭据、临时下载链接或生成文件提交到源码仓库。
