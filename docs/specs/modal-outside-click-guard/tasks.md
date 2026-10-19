# 修复 Skill 与智能体管理弹窗的外部点击自动关闭问题
- [x] Task 1: 调整 App 中管理类弹窗的遮罩层关闭策略
    - 1.1: 移除智能体管理弹窗 overlay 上的点击即关闭逻辑
    - 1.2: 移除 Skill 管理弹窗 overlay 上的点击关闭逻辑
    - 1.3: 删除 App 中仅服务于 Skill overlay 关闭保护的状态与处理函数
    - 1.4: 保留通过显式关闭按钮打开/关闭弹窗的现有流程

- [x] Task 2: 清理 SkillsPanel 中仅用于 overlay 关闭协作的编辑态同步逻辑
    - 2.1: 删除 `onEditingChange` 与 `overlayCloseSignal` 相关 props 定义
    - 2.2: 删除编辑态上报 effect 与 overlayCloseSignal effect
    - 2.3: 保留 Skill 编辑、创建、保存、取消与列表刷新逻辑不变

- [x] Task 3: 验证 Skill 与智能体管理界面的交互结果
    - 3.1: 确认点击弹窗外部区域不再关闭 Skill 管理界面
    - 3.2: 确认点击弹窗外部区域不再关闭智能体管理界面
    - 3.3: 确认关闭按钮、取消编辑、保存后刷新等原有流程仍然正常
    - 3.4: 运行必要的静态检查或构建验证改动未引入错误
