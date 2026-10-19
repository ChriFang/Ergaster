# 自然语言安装 Skill（skill-installer）实现任务计划

- [x] Task 1: 扩展 shared 类型（src/shared/user-skills.ts）
    - 1.1: 新增 InstalledSkillFile 类型（relativePath + text? / contentBase64?）
    - 1.2: 新增 ScanFinding 与 ScanReport 类型
    - 1.3: 新增 ResolvedSource 类型（kind: 'raw-md' | 'github' 及来源字段）
    - 1.4: 新增 SkillsChangedEvent 类型（供 skills:changed 推送）

- [x] Task 2: 实现来源解析纯模块 skill-source.ts + 单测
    - 2.1: resolveSkillSource：识别 raw SKILL.md / GitHub repo / /tree/{ref}/{subdir} 并归一化
    - 2.2: isAllowedHost + assertNoSsrf：白名单域校验 + 私网/环回/链路本地/元数据地址拦截
    - 2.3: sanitizeZipEntryPath：拒绝绝对路径与 `..` 逃逸，返回安全相对路径
    - 2.4: 导出总体积/文件数/单文件体积上限常量
    - 2.5: 编写 skill-source.test.ts 覆盖归一化、白名单、SSRF、zip 条目消毒
    - 2.6: 在 package.json test 脚本两处列表登记该测试并跑通

- [x] Task 3: 实现安全扫描纯模块 skill-scanner.ts + 单测
    - 3.1: 定义 ScanInput 与规则集（pipe-to-shell / 破坏性命令 / 凭证 / 可疑网络 / 提示注入 / execute 配置 / typosquat）
    - 3.2: scanSkill 汇总 findings、计算 score、判定 blocked
    - 3.3: 编写 skill-scanner.test.ts 覆盖各 block / warn / 放行分支
    - 3.4: 在 package.json test 脚本两处列表登记该测试并跑通

- [x] Task 4: 扩展服务层 user-skills-service.ts
    - 4.1: installSkillTree(files, { enabled:false })：名校验、防重名、写整棵子树、注册内存态、更新 skillFileStats
    - 4.2: listNames() 辅助（供 scanner 做 typosquat 比对）
    - 4.3: onSkillsChanged / emitSkillsChanged，并在 create/update/delete/reload/install 后触发

- [x] Task 5: 实现编排模块 skill-installer.ts
    - 5.1: secureFetch：手动重定向 + 逐跳白名单复检 + SSRF + 体积上限 + AbortSignal
    - 5.2: fetchRawSkillMd 与 fetchGithubSkillTree（codeload zipball + jszip 解包 + zip-slip 消毒）
    - 5.3: prepareInstall：下载→解析→完整性校验→扫描→阻断判定→内存暂存→返回预览
    - 5.4: commitInstall：读暂存→installSkillTree→清暂存；无暂存则报错（防 TOCTOU）
    - 5.5: buildReportDetail / buildBlockedMessage 预览与阻断文案

- [x] Task 6: 注册 install_skill 工具（tool-registry.ts）
    - 6.1: 顶部 schema 区新增 installSkillSchema
    - 6.2: 在 registeredTools 内（http_request 工具对象之后）新增 install_skill 工具对象，risk:'high'
    - 6.3: buildConfirmation 调 prepareInstall、execute 调 commitInstall
    - 6.4: 用 catalog 日志确认工具落在 registeredTools（普通聊天可见，未误入 codeTools/codeWriteTools）

- [x] Task 7: skills:changed 推送四层同步
    - 7.1: shared/contracts.ts 的 DesktopAppApi 增 onSkillsChanged
    - 7.2: preload/index.ts 暴露 onSkillsChanged（订阅 skills:changed，返回 unsubscribe）
    - 7.3: renderer/lib/desktop/desktop-app-client.ts 透传 onSkillsChanged
    - 7.4: main/index.ts 接线 userSkillsService.onSkillsChanged → webContents.send（发送前判窗口存活）

- [x] Task 8: 渲染层列表自动刷新
    - 8.1: use-chat-session.ts 订阅 onSkillsChanged 后重拉 listSkills
    - 8.2: SkillsPanel.tsx 挂载时订阅 onSkillsChanged 自动刷新列表

- [x] Task 9: 全量校验
    - 9.1: 运行 npm run typecheck
    - 9.2: 运行 npm test（含两个新增纯逻辑测试）
    - 9.3: 修复暴露的类型 / 测试问题

- [x] Task 10: GitHub 源改为按子目录拉取（Contents API，替代整仓 zipball）
    - 10.1: skill-installer.fetchGithubSkillTree 改用 GitHub Contents API 递归拉取子目录，逐文件经 raw 下载
    - 10.2: 移除整仓 zipball 与 jszip 依赖路径、删除 ResolvedSource.zipUrl 与 buildZipUrl
    - 10.3: 更新 skill-source.test.ts（去除 zipUrl 断言），跑通 typecheck 与 npm test

