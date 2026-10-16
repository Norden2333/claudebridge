# ClaudeBridge 0.6 · 重连诊断修订版

> **Pre-release（测试发布）** · 构建标识 `0.6.0-reconnect.20261016-publish.20261017`。兼容版本保持 `0.6.0`，不等同于最初的 0.6 包。以本页构建标识和 `SHA256SUMS.txt` 区分文件；可在 [Releases](https://github.com/Norden2333/claudebridge/releases) 查看已发布版本。源码不包含 Node.exe 或 node_modules；Windows 用户请下载完整 Windows 包。

> Windows 中英双语版。安装时选择界面语言；设置页可随时切换。Cowork 连接仍为实验性，第三方服务或网络异常时请核对本机回执。

一个 Chrome 扩展，加一个配套本机程序。让 Claude 网页在你选定的文件夹里读写文件，不必把全文重新抄进工具参数。独立开源项目，非 Anthropic、claudeFS 或 Desktop Commander 官方产品。

## 三步开始

1. **安装与加载**：Windows 只需运行 `安装Claude文件连接.exe`。然后在 Chrome 扩展页加载**安装目录**的 `extension`。安装程序和扩展是两步；不要同时运行其他备用安装入口。
2. **设置一次**：选择工作文件夹，再选“读写并自动保存”或“只读”；阅读数据说明并保存。授权只覆盖这个目录和子目录。
3. **正常使用**：打开 Claude。连接中会自动重连；生成的成果直接更新原文件，不备份、不另存、不弹版本选择，内容相同就跳过。

日常只看小窗的连接与保存结果。需要找文件就点“打开文件夹”，详细记录在“更多”里，不用每次打开工作台。

[完整安装与使用指南](文件使用指南.md) · [按现象查问题](SUPPORT.md) · [版本说明与限制](RELEASE.md)

## 日常怎么用

1. 安装配套程序，在 Chrome 加载扩展。
2. 在设置里选择文件夹，阅读并同意数据说明。
3. 需要写入时开启“允许修改文件”，需要自动落盘时开启“自动保存 Claude 成果”。保存一次。
4. 打开或刷新 Claude Chat，直接说需求。无需每次唤醒、准备保存或点击下载。

本机就绪、网页握手和本页实际工具调用是不同状态。若 Claude 找不到文件工具，先看小窗，而不是反复让模型搜索。

## 文件怎样保存

- 通过本机工具编辑：更新原路径，先核对原文或 SHA256，保留恢复副本。
- Claude 生成的文件卡片：自动保存原字节到当前对话绑定的工作文件夹；不让模型再逐字写一遍。
- 自动保存后续改动：直接更新同一本机路径，不备份、不另存、不弹版本选择。内容相同就跳过。
- 你在其他软件改过本机文件：下次自动保存该成果时仍直接更新原文件，不创建旧版备份。
- 已识别为历史版本或升级前明确忽略的成果不会自动重放。若想恢复历史内容，请手动核对后恢复；当前去重还可能跳过内容恰好回到旧版本的更新，见“已知限制”。
- 默认请求系统回收站，不以永久删除作为失败补救。U盘、网络盘和其他非固定卷拒绝回收；固定卷还检查Shell回调和回收条目。系统明确报告永久删除时如实提示不可恢复，结果未确认时提示未知，不能当作已回收。插件不修改回收站容量或策略。明确永久删除仍需同时传 `permanent=true` 和 `confirmPermanentDelete=true`。

“同文件更新”是保留路径和文件名，不是保证所有格式都物理增量写盘。提交采用暂存、校验和原子替换；Office、图片等二进制格式可能需要传输完整的新字节，但传输不进入模型上下文。自动保存成果不创建旧版备份。本机工具编辑原有的恢复记录机制与自动保存不同，保留在本机私有目录。

## 支持的任务

| 文件 | 当前能力 |
|---|---|
| TXT、Markdown、代码、CSV | 分页读取、搜索、精确单处或多处修改、创建和追加 |
| DOCX、PPTX | 读取相关部分文字；支持范围内默认修改原文件，也可明确另存；不编辑版式、图片和图表 |
| XLSX | 读取工作表、单元格和计算缓存；不修改或重新计算公式 |
| PNG、JPEG | 原图管理、有界预览、查看局部；生成成果可自动保存原字节 |
| PDF、WebP、旧 Office、其他二进制 | 原字节保存和文件管理；不是完整内容编辑器 |

文字预览最多1 GiB，局部文字编辑64 MiB，新文字每次4 MiB。Office解析容器256 MiB、总展开512 MiB；PNG/JPEG源64 MiB、4000万像素。自动成果传输最多4 GiB、接收20分钟，每块256 KiB；普通复制、移动和备用下载保存流式处理，受磁盘和10分钟处理预算约束。达到边界停止，不把半个文件当作完成。

## 安装

Google Chrome 120或更新。Windows x64包自带已校验的Node运行时：解压整个包，双击 `安装Claude文件连接.exe`，再到 `chrome://extensions/` 加载 `extension` 目录。安装向导不需要管理员权限，不改全局Node或代理。

Windows仅推荐上面的安装向导。`安装-Windows.cmd`是直接注册解压目录的高级入口，使用后不能移动或删除该目录，不与向导混用。源码保留其他系统脚本，但本次发布只验收Windows x64。

首次测试用独立浏览器个人资料和测试文件夹。若已有原claudeFS或旧辅助扩展，先停用以免重复文件桥，保留文件便于切回。卸载默认仅撤去注册，保留工作文件、设置和备份。

更新后重新加载扩展，再刷新Claude页面；只重开浏览器不一定更新Service Worker缓存。插件和本机版本不一致时停止新操作，仍可查看状态。源码更新入口为 `node companion/install.mjs --update`；实际切回使用更新返回的backupId。

## Cowork（可选）

在设置中展开“在Cowork中使用”，启用后在Claude中开启Remote Desktop Commander连接器，完成一次设备授权。设备名为 `Claude Folder`，不使用电脑主机名。Chat对话绑定目录，Cowork使用当前选择目录，二者分别判断可用状态。

自动方式读取现有本机代理入口，每次重连重新检测；入口变化会触发收尾后重新连接。不限定Clash、不猜固定端口、不要求全局模式。支持无账号本机HTTP、HTTPS、SOCKS5入口；SOCKS5域名在代理端解析。没有可用入口时停止，不悄悄直连。纯VPN/TUN可明确选择系统网络，依赖VPN实际路由和断线保护。PAC和仅浏览器代理扩展不能视为已经被本机程序自动接管。

网络恢复不重做文件操作。超时后按原operationId核对，区分未到达、接收中、完成、冲突和结果未知。托管服务的工具目录由服务方控制；空schema不能靠本机宣称已修复，必要时先读取 `get_config` 的受限文件操作协议。

### 已保存文件与操作记录

本机文件工具已写入的成果，若近期校验回执、文件名和当前文件原字节一致，自动保存会关联该文件，不另存、不重复写入，也不再次备份。相同内容已在默认目标位置时也直接关联。不会仅凭同名就认定相同；多个候选或缺少可核对记录时不猜子目录，使用已有绑定或默认目标；目标内容不同时直接更新，不备份。

工作台默认按完整路径展示最新完成结果，较早操作可展开查看；操作条数不等于磁盘文件数。“查看恢复选项（可选）”是历史恢复入口，不是要求继续处理。核对结果后，小窗同步清除对应已解决的旧提醒；未查到或仍不确定的记录不自动清除。

“显示所在位置”会向系统请求打开并在 Windows 中选中文件；界面显示已发出请求不代表操作系统窗口一定可见。若未出现窗口，可手动打开工作文件夹。备用下载保存未开启，不影响已启用的自动保存。

## Claude Code（暂不支持）

目前尚未更新到支持 Claude Code 模式，包括网页 Code、CLI 和 Remote Control。本版本支持 Claude 网页 Chat 和可选的 Cowork 连接。

## 隐私、恢复与界面

只操作授权目录，不提供终端执行工具；拒绝目录越界、符号链接、联接和多重硬链接。即使选择上级目录，程序自身、运行时和私有状态仍不开放给文件工具。

你要求读取的内容和工具结果会交给Claude；Cowork另经Desktop Commander服务。作者没有独立收集服务器，不查询公网IP、不读取原剪贴板、不自动上传诊断，也不承诺隐藏真实IP。

Windows会话用CurrentUser DPAPI。macOS用Keychain，Linux用Secret Service（需secret-tool和可用钥匙环）；系统凭据服务不可用时暂停 Cowork，保留原登录记录，不回退明文或自动新建设备。

小窗可拖动、调整矩形宽高、收起、隐藏桌宠；显示连接、操作和待核对结果。页面小窗继承Claude已加载的对话字体；不随包分发专有字体。系统声音和通知可单独关闭。工作台保留操作记录与历史恢复入口，日常自动保存不需要打开。

活跃恢复副本上限4 GiB或2000份。接近上限时先自动归档符合条件的旧版本，保留每个文件最近五份；归档上限取16 GiB与当时剩余空间10%的较小值。无合适旧版本或空间不足时拒绝本次改写，不永久删除副本。80%用量会提示。归档保留期默认关闭；明确开启后，只尝试将到期归档移入系统回收站，未知结果不自动重试。这些恢复副本来自本机文件工具，不是自动成果保存的旧版备份；自动成果仍按上文直接更新。

## 验收和发布

Windows真实测试已确认TXT零点击自动保存、同路径更新，以及PNG、PPTX、PDF零点击落盘并独立解析。验证范围与尚未覆盖的环境见 [VALIDATION.md](VALIDATION.md)。其他系统的注册、回收站、钥匙环仍需各自实机验证；Edge不列为已验收支持。

Chrome包是提交草稿，不表示已上架。商店身份需与本机allowed_origins配对，步骤见 [STORE_SUBMISSION.md](STORE_SUBMISSION.md)。GitHub发布保留完整源码、许可证和固定依赖；不宣称商店已批准。

详见 [日常使用](文件使用指南.md)、[隐私说明](PRIVACY.md)、[反馈](SUPPORT.md)、[许可与来源](NOTICE.md)。不必上传真实文稿来反馈问题。

### 按需确认自动保存

模型需要确认成果是否落盘时，可调用 `get_saved_file_status(path)`；Cowork 用 `get_config` 返回的 `automaticSaveReceipt` 只读协议。回执标明最后成功保存时间、摘要和大小，不返回文件正文。`currentContentRechecked=false` 表示不是当前内容重校验；`not_found` 表示路径映射及保留的操作索引均没有找到可用回执，不能断言从未保存。首次任务或连接变化后先选择当前在线的目标设备，再核对授权目录，不使用缓存离线编号或替换为其他电脑。

Cowork仍为实验性；遇到结果缺失或状态不明时，请按原操作编号核对本机回执，不要重复执行文件操作。第三方目录若省略edit_block参数表，get_config给出与执行器相同的完整edit_block_schema，无需推测参数或重复搜索。

## 0.6.0 使用变化

自动保存会核对实际目标文件；同内容跳过，不同内容直接更新，即使本地有修改也不备份、不另存、不因内容不同弹出版本选择。升级前明确忽略或暂停的关联仍保留，不自动重放。可以开启保留成果相对目录结构，默认仍保存到根目录。非法Windows文件名会转换，危险可执行后缀追加`.txt`，原字节不变。

文件夹丢失时程序保持运行，设置页可以重新选择；目录回来后重新检查。关闭Claude标签页时默认保持Cowork后台在线，可以在设置关闭；退出Chrome则连接停止。小窗正常时只显示概况，路径、通路和操作证据在详情与工作台。

本版本的验证范围、已知限制和尚未覆盖环境见 [VALIDATION.md](VALIDATION.md)。

## Interface language

Extract the entire Windows package and run `安装Claude文件连接.exe`. Select **English** or **中文（简体）** using **Language / 语言** at the top of the installer before installing. The extension uses that choice initially. You can change it later at the top of Settings, the popup, the workbench or onboarding. Save unfinished settings first; switching reloads that page.

Only interface text is translated. File names, paths, file contents, operation IDs and Claude replies are unchanged. Language switching does not change folder permissions, login or network settings. After an extension update, reload the extension and refresh the Claude page.

## Contributors / 致谢

特别感谢 **[rullerzhou-afk](https://github.com/rullerzhou-afk)** 的 **[Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk)**，本项目的五份桌宠 SVG 动画来源于该项目，保留 AGPL-3.0-only 许可和来源声明。没有复制其 Electron 运行器，致谢不代表原作者背书。完整列表见 [CONTRIBUTORS.md](CONTRIBUTORS.md)，参与指南见 [CONTRIBUTING.md](CONTRIBUTING.md)。

### From source

Use Node.js 22 or newer with npm. From the repository root, run `npm ci --ignore-scripts`, then `node tools/check-source.mjs` and `npm test`. The committed `package-lock.json` pins the dependency tree and registry integrity hashes. The source archive does not contain node_modules or a Node.js runtime; dependency installation requires access to the npm registry. The Windows archive includes its runtime and dependencies. To build a Windows package on Windows, install the locked dependencies and run `python tools/build-windows-installer.py --runtime-dir PATH_TO_OFFICIAL_RUNTIME --output NEW_OUTPUT_DIRECTORY`; the runtime must match the hash pinned in that script. Preserve all license notices.

从近期可信回执识别到唯一的同名同内容文件后，可关联到已有路径；后续成果沿用该路径直接更新。不满足条件时不猜测子目录，使用已有绑定或默认目标。

## 简单使用

设置一次文件夹、允许修改和自动保存即可。断线后自动重连，不用反复点按钮。小窗默认显示连接状态、文件夹和最近保存结果；“更多”里才展示记录与诊断。小窗四个角都可以拖动，宽、高独立调整，大小和位置会记住。设备重新验证、登记和网络设置保留原样。

## 已知限制

- 此包增加重连阶段、倒计时和本地限量日志，未证明历史断连根因已消除；Cowork 在线不等于当前对话工具可用。
- 成果内容从 A 更新为 B 后再回到完全相同的 A，可能被历史摘要去重跳过；本次发布整理未修改该逻辑。
- “不备份”指成果卡片自动保存。本机文件工具修改仍保留恢复副本；不能将其理解为所有写入都不备份。
- 不同对话写入同一目录的同名目标可能互相更新。网页文件卡片识别依赖 Claude 当前页面结构。
