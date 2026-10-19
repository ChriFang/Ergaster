# modal-outside-click-guard

## 背景
用户反馈：
- 点击 Skill 管理界面外的区域时，Skill 管理页面会自动关闭。
- 智能体管理界面存在相同现象。

结合当前代码实现排查后，问题并不是浏览器 blur、焦点丢失或其他全局隐藏逻辑导致，而是两个管理界面都被实现为 `modal-overlay` 遮罩层弹窗，并且遮罩层绑定了关闭逻辑。点击弹窗外区域时，点击事件落到遮罩层，触发关闭。

## 需求场景与处理逻辑

### 场景 1：点击 Skill 管理弹窗外部区域
当前行为：
- 当 `showSkillsModal` 为 `true` 时，`App` 渲染 `.modal-overlay`。
- 遮罩层绑定 `onClick={handleSkillsModalOverlayClick}`。
- 点击弹窗内容区外部区域时，事件命中遮罩层，触发关闭逻辑。

当前实现细节：
- 若当前未编辑 Skill，则直接关闭整个 Skill 管理弹窗。
- 若当前处于编辑态，则不会立即关闭整个弹窗，而是通过 `skillsOverlayCloseSignal` 通知 `SkillsPanel` 退出编辑态。
- 再次点击外部区域时，才会关闭整个 Skill 管理弹窗。

这说明 Skill 管理页面已经做了“编辑态保护”，但列表页仍然保留了“点击遮罩层自动关闭”的行为，因此用户仍感知为“点外面就自动关闭”。

### 场景 2：点击智能体管理弹窗外部区域
当前行为：
- 当 `showAgentsModal` 为 `true` 时，`App` 渲染 `.modal-overlay`。
- 遮罩层直接绑定 `onClick={() => setShowAgentsModal(false)}`。
- 点击弹窗外部区域时，会立即关闭整个智能体管理弹窗。

与 Skill 管理不同的是：
- 智能体管理界面没有将 `editingAgent` 状态上报给 `App`。
- 没有外部点击保护逻辑。
- 没有“先退出编辑态，再保留弹窗”的中间行为。

因此智能体管理界面的关闭行为更直接，任何遮罩层点击都会关闭整个弹窗。

## 根因分析

### 核心根因
两个管理界面的自动关闭，本质上都来自 `App.tsx` 中手写的 modal overlay 关闭机制，而不是业务层主动调用 `onClose`：

- Skill 管理：`src/renderer/App.tsx:591`
- 智能体管理：`src/renderer/App.tsx:583`

关键代码路径：
1. 用户点击弹窗外区域。
2. 点击事件落到 `.modal-overlay`。
3. overlay 的 `onClick` 被触发。
4. `App` 更新对应的 `showSkillsModal/showAgentsModal` 状态。
5. 弹窗卸载。

### Skill 管理页面的补充机制
`SkillsPanel` 通过 `onEditingChange` 将编辑状态同步给 `App`，`App` 再决定外部点击时是：
- 关闭整个 modal；还是
- 只退出编辑态。

相关路径：
- `src/renderer/features/skills/SkillsPanel.tsx:6`
- `src/renderer/features/skills/SkillsPanel.tsx:30`
- `src/renderer/features/skills/SkillsPanel.tsx:37`
- `src/renderer/App.tsx:367`

### 智能体管理页面缺失的机制
`AgentsPanel` 内部虽然也有 `editingAgent`，但没有向父组件同步，也没有 overlay close signal 机制。因此点击弹窗外部时，父组件完全不知道当前是否在编辑，直接关闭。

相关路径：
- `src/renderer/features/agents/AgentsPanel.tsx:11`
- `src/renderer/App.tsx:583`

## 技术方案

### 方案目标
统一管理类弹窗的交互规则，避免用户点击弹窗外部区域时意外关闭页面，尤其是在进行配置、编辑、创建等高成本操作时。

### 建议方案
对 Skill 管理和智能体管理统一采用“禁止点击遮罩层直接关闭”的策略，仅通过显式关闭按钮或明确的取消操作关闭。

原因：
- 这两个界面本质上是管理后台式工作区，不是轻量级提示框。
- 页面内包含列表、编辑器、创建流程与删除操作，误触关闭成本高。
- 当前 Skill 管理与智能体管理交互不一致，统一后更符合用户预期。
- 直接移除 overlay 关闭行为，比继续扩展各自的编辑保护状态更简单、更稳定。

### 具体实现方式

#### 调整 Skill 管理弹窗容器
将：
```tsx
{showSkillsModal && (
  <div className="modal-overlay" onClick={handleSkillsModalOverlayClick}>
    <div className="modal-content skills-modal" onClick={(e) => e.stopPropagation()}>
      <SkillsPanel ... />
    </div>
  </div>
)}
```

调整为不在 overlay 上绑定关闭逻辑，例如：
```tsx
{showSkillsModal && (
  <div className="modal-overlay">
    <div className="modal-content skills-modal" onClick={(e) => e.stopPropagation()}>
      <SkillsPanel ... />
    </div>
  </div>
)}
```

并同步删除不再需要的状态与函数：
- `isSkillsEditing`
- `skillsOverlayCloseSignal`
- `handleSkillsModalOverlayClick`
- 以及 `SkillsPanel` 的 `onEditingChange` / `overlayCloseSignal` 协作逻辑（如果没有其他用途）

#### 调整智能体管理弹窗容器
将：
```tsx
{showAgentsModal && (
  <div className="modal-overlay" onClick={() => setShowAgentsModal(false)}>
    <div className="modal-content skills-modal" onClick={(e) => e.stopPropagation()}>
      <AgentsPanel ... />
    </div>
  </div>
)}
```

调整为：
```tsx
{showAgentsModal && (
  <div className="modal-overlay">
    <div className="modal-content skills-modal" onClick={(e) => e.stopPropagation()}>
      <AgentsPanel ... />
    </div>
  </div>
)}
```

保留面板内显式关闭入口：
- Skill 管理页顶部“关闭”按钮
- 智能体管理页顶部“关闭”按钮
- 编辑页已有“取消”行为

## 架构与影响范围

### 受影响文件

#### 1. `e:\other-code\desktop-tools\src\renderer\App.tsx`
- 修改类型：删除/简化 modal 外层关闭逻辑
- 受影响状态：
  - `showSkillsModal`
  - `showAgentsModal`
  - `isSkillsEditing`（预计删除）
  - `skillsOverlayCloseSignal`（预计删除）
- 受影响函数：
  - `handleSkillsModalOverlayClick`（预计删除）
- 受影响 JSX：
  - Skills modal 渲染分支
  - Agents modal 渲染分支
  - 打开 Skills modal 时的初始化逻辑

#### 2. `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx`
- 修改类型：删除仅用于 overlay 关闭保护的协作逻辑
- 受影响 props：
  - `onEditingChange?`（预计删除）
  - `overlayCloseSignal?`（预计删除）
- 受影响状态：
  - `editingSkill` 保留
- 受影响 effect：
  - 编辑态上报 effect
  - overlay close signal effect

#### 3. `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx`
- 修改类型：大概率无需结构性改动，仅确认现有显式关闭入口足够
- 受影响范围：若需要补充文案或行为说明，可做轻量调整；否则不改

## 数据流路径

### 现状数据流
#### Skill 管理
`overlay click -> App.handleSkillsModalOverlayClick -> (关闭 modal 或发出 overlayCloseSignal) -> SkillsPanel 清理编辑状态`

#### 智能体管理
`overlay click -> App.setShowAgentsModal(false) -> modal 卸载`

### 调整后数据流
#### Skill 管理
`显式点击关闭按钮 -> SkillsPanel.onClose -> App.setShowSkillsModal(false)`

`编辑中点击取消 -> SkillsPanel.setEditingSkill(null)`

#### 智能体管理
`显式点击关闭按钮 -> AgentsPanel.onClose -> App.setShowAgentsModal(false)`

`编辑中点击取消 -> AgentsPanel.setEditingAgent(null)`

## 边界条件与异常处理

### 边界条件
1. 点击遮罩层空白区域不应关闭 Skill/智能体管理弹窗。
2. 点击弹窗内部区域不应触发关闭。
3. 编辑中的 Skill 点击取消，只退出编辑器，保留管理弹窗。
4. 编辑中的智能体点击取消，只退出编辑器，保留管理弹窗。
5. 通过顶部“关闭”按钮关闭时，应正常卸载对应 modal。

### 异常处理
- 本次调整主要是前端交互层修改，不涉及 IPC 协议、文件系统写入或后端数据格式变更。
- 不应引入新的异步异常路径。
- 删除未使用状态后，应确保 TypeScript 无未引用变量报错。

## 预期结果
1. Skill 管理页面在点击外部区域时不再自动关闭。
2. 智能体管理页面在点击外部区域时不再自动关闭。
3. 两个管理界面的关闭方式保持一致，只通过显式操作关闭。
4. 现有编辑/创建/保存/取消流程保持不变。
5. `App.tsx` 中与 Skill overlay 保护相关的冗余状态链路被简化。

## 参考定位
- `e:\other-code\desktop-tools\src\renderer\App.tsx:367`
- `e:\other-code\desktop-tools\src\renderer\App.tsx:583`
- `e:\other-code\desktop-tools\src\renderer\App.tsx:591`
- `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx:30`
- `e:\other-code\desktop-tools\src\renderer\features\skills\SkillsPanel.tsx:37`
- `e:\other-code\desktop-tools\src\renderer\features\agents\AgentsPanel.tsx:11`
