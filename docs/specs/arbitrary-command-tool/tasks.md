# run_command 任意命令执行工具任务计划
- [x] Task 1: 扩展 system-tools 中的任意命令执行能力
    - 1.1: 复用现有 spawn 执行模式，新增 runCommand(command, signal) 实现
    - 1.2: 通过 powershell.exe -NoProfile -Command 执行传入命令字符串
    - 1.3: 收集 stdout 和 stderr，并复用截断逻辑限制输出长度
    - 1.4: 处理 abort、启动失败、非零退出码和空输出场景

- [x] Task 2: 在 tool-registry 中注册高风险 run_command 工具
    - 2.1: 新增 runCommandSchema，约束 command 为必填字符串并限制最大长度
    - 2.2: 导入 runCommand 并在 registeredTools 中新增 run_command 定义
    - 2.3: 将 risk 设置为 high，description 明确说明执行任意命令且需用户确认
    - 2.4: 将 execute 逻辑接入 runCommand(input.command, context.signal)

- [x] Task 3: 验证工具行为与构建可用性
    - 3.1: 检查 tasks.md 当前状态并按完成情况维护复选框
    - 3.2: 运行类型检查或构建命令验证新增工具未破坏现有编译流程
    - 3.3: 确认 run_command 复用现有确认链路，无需额外确认逻辑
    - 3.4: 记录最终验证结果，为 summary.md 提供完成依据
