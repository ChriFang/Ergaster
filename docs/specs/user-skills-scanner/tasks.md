# 用户自定义 Skills 自动扫描与注册功能 - 任务列表

- [x] Task 1: 定义 Skills 类型和 Zod Schema
    - 1.1: 创建 `src/shared/user-skills.ts` 文件
    - 1.2: 定义 `UserSkillExecuteType` 类型（'http' | 'script'）
    - 1.3: 定义 `UserSkillDefinition` 类型（包含元数据、工具定义、执行配置）
    - 1.4: 使用 Zod 创建 `userSkillSchema` 用于校验
    - 1.5: 创建 `src/shared/skill-contracts.ts` 定义 IPC 接口类型
    - 1.6: 定义 `SkillListItem`、`CreateSkillRequest`、`UpdateSkillRequest`、`SkillOperationResult` 类型

- [x] Task 2: 实现 Skills 扫描和管理服务
    - 2.1: 创建 `src/main/user-skills-service.ts` 文件
    - 2.2: 实现 `UserSkillsService` 类和构造函数
    - 2.3: 实现 `scanAndLoadSkills()` 方法扫描目录并加载所有 skills
    - 2.4: 实现 `loadSkillFile()` 方法加载并校验单个 skill 文件
    - 2.5: 实现 `getLoadedSkills()` 和 `getSkill()` 查询方法
    - 2.6: 实现 `createSkill()` 方法创建新 skill 并保存文件
    - 2.7: 实现 `updateSkill()` 方法更新现有 skill
    - 2.8: 实现 `deleteSkill()` 方法删除 skill 文件
    - 2.9: 实现 `getSkillListItems()` 方法返回列表展示数据
    - 2.10: 导出单例 `userSkillsService`

- [x] Task 3: 实现 Skills 执行引擎
    - 3.1: 创建 `src/main/user-skill-executor.ts` 文件
    - 3.2: 实现 `executeUserSkill()` 函数作为执行入口
    - 3.3: 实现 `executeHttpSkill()` 函数处理 HTTP 类型请求
    - 3.4: 实现 URL 占位符替换逻辑（{param} -> 实际值）
    - 3.5: 实现超时控制和取消信号处理
    - 3.6: 实现 `executeScriptSkill()` 函数处理脚本执行
    - 3.7: 使用 `spawn` 执行脚本并捕获输出
    - 3.8: 实现脚本执行超时和错误处理

- [x] Task 4: 扩展工具注册中心
    - 4.1: 在 `src/main/tool-registry.ts` 中导入 `userSkillsService`
    - 4.2: 新增 `userSkillDefinitions` Map 存储用户 skills
    - 4.3: 实现 `loadUserSkills()` 函数加载并注册所有用户 skills
    - 4.4: 实现 `registerUserSkill()` 函数注册单个 skill
    - 4.5: 实现 `unregisterUserSkill()` 函数注销 skill
    - 4.6: 修改 `getRegisteredTools()` 合并系统工具和用户 skills
    - 4.7: 实现 `buildValidatorFromParameters()` 从参数定义构建 Zod validator
    - 4.8: 修改 `executeToolCall()` 支持执行用户 skills
    - 4.9: 确保用户 skill 执行时的风险控制和用户确认

- [x] Task 5: 实现 IPC 处理器
    - 5.1: 创建 `src/main/skill-handlers.ts` 文件
    - 5.2: 实现 `registerSkillHandlers()` 函数注册所有 IPC handlers
    - 5.3: 实现 `skill:list` handler 返回 skills 列表
    - 5.4: 实现 `skill:get` handler 返回单个 skill 详情
    - 5.5: 实现 `skill:create` handler 创建新 skill
    - 5.6: 实现 `skill:update` handler 更新 skill
    - 5.7: 实现 `skill:delete` handler 删除 skill
    - 5.8: 实现 `skill:validate` handler 校验 skill 定义
    - 5.9: 在 `src/main/index.ts` 中调用 `registerSkillHandlers()`

- [x] Task 6: 扩展 Preload 脚本
    - 6.1: 在 `src/preload/index.ts` 中添加 Skills 相关 API
    - 6.2: 添加 `listSkills()` 方法调用 `skill:list`
    - 6.3: 添加 `getSkill()` 方法调用 `skill:get`
    - 6.4: 添加 `createSkill()` 方法调用 `skill:create`
    - 6.5: 添加 `updateSkill()` 方法调用 `skill:update`
    - 6.6: 添加 `deleteSkill()` 方法调用 `skill:delete`
    - 6.7: 添加 `validateSkill()` 方法调用 `skill:validate`

- [x] Task 7: 实现 UI 组件 - SkillsPanel
    - 7.1: 创建 `src/renderer/features/skills/` 目录
    - 7.2: 创建 `SkillsPanel.tsx` 组件文件
    - 7.3: 实现 skills 列表状态管理
    - 7.4: 实现 `loadSkills()` 函数加载 skills 列表
    - 7.5: 实现列表展示 UI（名称、描述、风险等级、类型）
    - 7.6: 实现新增、编辑、删除按钮和事件处理
    - 7.7: 实现 `handleDelete()` 删除确认逻辑
    - 7.8: 实现编辑模式切换逻辑
    - 7.9: 实现 `createEmptySkill()` 函数生成空 skill 模板

- [x] Task 8: 实现 UI 组件 - SkillEditor
    - 8.1: 创建 `SkillEditor.tsx` 组件文件
    - 8.2: 实现表单状态管理
    - 8.3: 实现基础字段编辑（名称、描述、风险等级）
    - 8.4: 实现执行类型选择器（HTTP/Script）
    - 8.5: 创建 `HttpConfigEditor.tsx` 子组件编辑 HTTP 配置
    - 8.6: 创建 `ScriptConfigEditor.tsx` 子组件编辑脚本配置
    - 8.7: 实现 `ParametersEditor.tsx` 组件编辑参数定义
    - 8.8: 实现表单提交和保存逻辑
    - 8.9: 实现表单取消逻辑

- [x] Task 9: 集成到主应用
    - 9.1: 在 `App.tsx` 中添加 `showSkillsPanel` 状态
    - 9.2: 在顶部导航栏添加 "Skills 管理" 按钮
    - 9.3: 条件渲染 `SkillsPanel` 组件
    - 9.4: 在 `app.whenReady()` 后调用 `loadUserSkills()`
    - 9.5: 确保应用启动时 skills 正确加载

- [x] Task 10: 样式和用户体验优化
    - 10.1: 为 SkillsPanel 添加 CSS 样式
    - 10.2: 为 SkillEditor 添加表单样式
    - 10.3: 实现风险等级的颜色标识（low/medium/high）
    - 10.4: 添加加载状态提示
    - 10.5: 添加操作成功/失败的反馈提示
    - 10.6: 优化移动端响应式布局

- [x] Task 11: 创建示例 Skill 文件
    - 11.1: 创建 `docs/skills-examples/` 目录
    - 11.2: 创建 `weather.json` 示例（HTTP 类型）
    - 11.3: 创建 `translate.json` 示例（Script 类型）
    - 11.4: 创建 README 说明如何添加自定义 skills

- [x] Task 12: 测试和验证
    - 12.1: 手动测试应用启动时 skills 正确加载
    - 12.2: 手动测试通过 UI 创建新 skill
    - 12.3: 手动测试通过 UI 编辑现有 skill
    - 12.4: 手动测试通过 UI 删除 skill
    - 12.5: 手动测试 LLM 调用用户 skill
    - 12.6: 测试错误处理（格式错误、名称冲突等）
    - 12.7: 测试风险控制和用户确认流程
