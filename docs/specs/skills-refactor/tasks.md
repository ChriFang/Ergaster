# Skills 功能重构 - 任务列表

- [x] Task 1: 更新依赖和类型定义
    - 1.1: 安装 `yaml` npm 包用于解析 YAML frontmatter
    - 1.2: 重构 `src/shared/user-skills.ts` 类型定义
    - 1.3: 定义 `SkillMetadata` 类型（name、description、license 等）
    - 1.4: 定义 `UserSkillDefinition` 类型（包含完整 skill 内容）
    - 1.5: 重构 `src/shared/skill-contracts.ts` 接口定义
    - 1.6: 简化 `SkillListItem` 类型

- [x] Task 2: 重构 Skills 服务层
    - 2.1: 重构 `src/main/user-skills-service.ts`
    - 2.2: 修改 `scanAndLoadSkills()` 扫描目录下的子目录
    - 2.3: 实现 `loadSkillFromDirectory()` 从目录加载 SKILL.md
    - 2.4: 实现 `parseSkillMarkdown()` 解析 YAML frontmatter 和 Markdown body
    - 2.5: 实现 `validateSkillMetadata()` 校验 name 和 description
    - 2.6: 实现 `getSkillContent()` 获取完整 skill 文件内容
    - 2.7: 修改 `createSkill()` 创建目录和 SKILL.md 文件
    - 2.8: 修改 `updateSkill()` 更新 SKILL.md 文件
    - 2.9: 修改 `deleteSkill()` 删除整个目录
    - 2.10: 实现目录重命名逻辑（当 skill name 变更时）

- [x] Task 3: 更新工具注册中心
    - 3.1: 修改 `src/main/tool-registry.ts`
    - 3.2: 修改 `getRegisteredTools()` 返回工具列表（含 name 和 description）
    - 3.3: 修改 `executeToolCall()` 支持 skill 调用
    - 3.4: 实现：当 LLM 调用 skill 时，读取完整 SKILL.md 内容
    - 3.5: 实现：将 skill 内容作为上下文发送给 LLM 执行

- [x] Task 4: 更新 IPC 处理器
    - 4.1: 修改 `src/main/skill-handlers.ts`
    - 4.2: 调整 `skill:list` 返回简化的列表项
    - 4.3: 调整 `skill:get` 返回完整 skill 内容（Markdown 文本）
    - 4.4: 调整 `skill:create` 接收 Markdown 文本
    - 4.5: 调整 `skill:update` 接收 Markdown 文本
    - 4.6: 新增 `skill:get-content` 获取完整 skill 文件内容

- [x] Task 5: 更新 Preload 脚本和 API 类型
    - 5.1: 修改 `src/shared/contracts.ts` 更新 API 类型
    - 5.2: 修改 `src/preload/index.ts` 更新 API 实现
    - 5.3: 更新 `getSkill()` 返回 Markdown 文本
    - 5.4: 更新 `createSkill()` 和 `updateSkill()` 接口

- [x] Task 6: 重构 UI 组件 - SkillsPanel
    - 6.1: 重构 `src/renderer/features/skills/SkillsPanel.tsx`
    - 6.2: 简化列表展示（名称、描述）
    - 6.3: 添加"打开目录"按钮
    - 6.4: 调整新增/编辑/删除操作

- [x] Task 7: 重构 UI 组件 - SkillEditor
    - 7.1: 重构 `src/renderer/features/skills/SkillEditor.tsx`
    - 7.2: 改为纯文本编辑器（textarea）
    - 7.3: 设置大尺寸编辑框（全屏或大半屏）
    - 7.4: 实现默认模板内容填充
    - 7.5: 实现保存和取消功能
    - 7.6: 添加"重置为模板"按钮

- [x] Task 8: 更新模板文件
    - 8.1: 更新 `doc/skills/template.md` 模板内容
    - 8.2: 确保模板包含完整的 frontmatter 示例
    - 8.3: 添加参数定义和执行配置示例
    - 8.4: 添加使用说明注释

- [x] Task 9: 实现 LLM 调用 Skill 逻辑
    - 9.1: 在 `agent-service.ts` 或 `tool-registry.ts` 中实现
    - 9.2: 当检测到 LLM 调用用户 skill 时
    - 9.3: 读取完整的 SKILL.md 文件内容
    - 9.4: 构造包含 skill 指令的系统消息
    - 9.5: 发送给 LLM 执行任务
    - 9.6: 返回执行结果

- [x] Task 10: 清理旧代码和文件
    - 10.1: 删除旧的 JSON 格式相关代码
    - 10.2: 删除 `docs/skills-examples/` 下的 JSON 示例
    - 10.3: 更新 CSS 样式适应新的 UI
    - 10.4: 删除不再使用的类型定义

- [x] Task 11: 更新文档
    - 11.1: 更新 `docs/skills-examples/README.md`
    - 11.2: 创建 Markdown 格式的示例 skill
    - 11.3: 更新使用说明

- [x] Task 12: 测试和验证
    - 12.1: 测试 Skill 目录扫描
    - 12.2: 测试 YAML frontmatter 解析
    - 12.3: 测试 UI 创建、编辑、删除 skill
    - 12.4: 测试 LLM 调用 skill 并获取完整内容
    - 12.5: 测试目录重命名
    - 12.6: 测试错误处理
