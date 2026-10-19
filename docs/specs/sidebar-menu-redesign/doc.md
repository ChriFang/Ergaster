# 侧边栏与顶部菜单重构需求文档

## 需求概述

将当前设置、Skills 设置、应用状态等功能收纳到顶部菜单栏，并重设计左侧边栏：移除 DeepSeek 配置状态，新增「智能体」展示区块和「输入记录」区块。布局参考提供的 SVG 设计稿。

## 需求场景与处理逻辑

### 1. 顶部 Header 菜单改造

当前 Header 中「重置会话」「Skills」「设置」三个按钮平铺展示，占用空间且视觉权重分散。改造为：

- **「重置会话」独立按钮**：保持为独立的 ghost-button，点击直接重置 Agent 会话
- **下拉菜单按钮**：点击后展开下拉面板，包含「Skills 管理」「设置」「关于」三项操作
- **「关于」弹窗**：点击后弹出模态框，展示应用状态信息（应用名称、版本号等）
- **下拉菜单交互**：点击菜单按钮切换展开/收起；点击菜单外部区域或按 Escape 键自动收起

### 2. 左侧边栏移除状态卡片

当前侧边栏底部有两张状态卡片：「应用状态」和「DeepSeek 配置」。将「应用状态」收纳到菜单的「关于」弹窗中，「DeepSeek 配置」直接移除。侧边栏底部不再显示任何状态卡片。

### 3. 左侧边栏新增「智能体」区块

- 位置：品牌标题下方
- 标题：智能体
- 内容：展示智能体列表，当前仅作静态展示，具体功能后续实现
- 样式：与整体暗色主题协调，列表项带 hover 效果
- 当前可先展示占位项（如默认智能体），为后续功能预留接口

### 4. 左侧边栏新增「输入记录」区块

- 位置：智能体区块下方
- 标题：输入记录
- 功能：
  - 按列表展示用户历史输入内容
  - 最多保存 100 条记录，超出时自动移除最早的记录（FIFO）
  - 列表区域支持垂直滚动
  - 点击某条记录后，将该记录内容回填到底部输入框（`Composer`）中
  - 空记录时显示占位提示（如"暂无输入记录"）
- 数据生命周期：保存在 React 内存状态中，不持久化到磁盘；页面刷新后丢失

### 5. 侧边栏整体布局

参考 SVG 设计稿，侧边栏从上到下分为：

1. **品牌区**： eyebrow "DESKTOP TOOLS" + h1 "AI小助手"
2. **内容区**（可滚动）：智能体区块 + 输入记录区块

为此需要调整 `.sidebar` 的 flex 布局：内容区设置 `flex: 1` 和 `overflow-y: auto`，品牌区固定。

## 架构与技术方案

### 状态管理

全部使用 React `useState`，不引入额外状态管理库：

- 新增 `inputHistory: string[]`：维护用户输入历史
- 新增 `isMenuOpen: boolean`：控制下拉菜单显隐
- 新增 `menuRef: React.RefObject<HTMLDivElement>`：用于检测点击外部关闭菜单
- 新增 `showAboutModal: boolean`：控制「关于」弹窗显隐

### 数据流

```
用户点击发送（handleRunAgent）
  → prompt 被添加到 inputHistory 开头
  → inputHistory 长度超过 100 时，截断至 100 条

用户点击某条输入记录
  → setInput(recordText) 回填到 Composer

用户点击下拉菜单按钮
  → setIsMenuOpen(toggle) 控制显隐
  → 菜单展开时注册 document mousedown 监听，点击外部自动关闭
```

### 样式方案

延续现有单文件 CSS（`styles.css`）方案，新增以下样式类：

- `.dropdown`：下拉菜单容器
- `.dropdown-menu`：下拉面板，绝对定位，暗色浮层风格
- `.dropdown-item`：菜单项按钮
- `.sidebar-content`：侧边栏中间可滚动内容区
- `.sidebar-section`：侧边栏功能区块（智能体、输入记录）
- `.sidebar-section-title`：区块标题
- `.agent-list` / `.agent-item`：智能体列表
- `.history-list`：输入记录列表容器，带 `max-height` 和 `overflow-y: auto`
- `.history-item`：单条输入记录，支持 hover 和点击
- `.history-empty`：空记录占位提示

## 受影响文件

| 文件 | 类型 | 影响说明 |
|------|------|----------|
| `src/renderer/App.tsx` | 修改 | 重构 sidebar JSX 结构；重构 header 为下拉菜单+设置按钮；新增 `inputHistory`、`isMenuOpen` 状态及逻辑；新增 `handleHistoryClick`、`handleMenuToggle` 等处理函数 |
| `src/renderer/styles.css` | 修改 | 调整 `.sidebar` 布局；新增 dropdown 相关样式；新增 sidebar section、agent list、history list 相关样式 |

## 实现细节

### App.tsx 状态与逻辑变更

1. **新增状态**：
   ```tsx
   const [inputHistory, setInputHistory] = useState<string[]>([]);
   const [isMenuOpen, setIsMenuOpen] = useState(false);
   const menuRef = useRef<HTMLDivElement>(null);
   ```

2. **输入历史更新逻辑**（在 `handleRunAgent` 中，发送成功后）：
   ```tsx
   setInputHistory((prev) => {
     const next = [prompt, ...prev];
     return next.slice(0, 100);
   });
   ```

3. **点击外部关闭菜单 effect**：
   ```tsx
   useEffect(() => {
     if (!isMenuOpen) return;
     function handlePointerDown(event: PointerEvent) {
       if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
         setIsMenuOpen(false);
       }
     }
     document.addEventListener('pointerdown', handlePointerDown);
     return () => document.removeEventListener('pointerdown', handlePointerDown);
   }, [isMenuOpen]);
   ```

4. **Sidebar JSX 新结构**：
   ```tsx
   <aside className="sidebar">
     <div className="sidebar-brand">
       <p className="eyebrow">DESKTOP TOOLS</p>
       <h1>AI小助手</h1>
     </div>
     <div className="sidebar-content">
       <div className="sidebar-section">
         <div className="sidebar-section-title">智能体</div>
         <div className="agent-list">
           <div className="agent-item">默认智能体</div>
         </div>
       </div>
       <div className="sidebar-section">
         <div className="sidebar-section-title">输入记录</div>
         <div className="history-list">
           {inputHistory.length === 0 ? (
             <div className="history-empty">暂无输入记录</div>
           ) : (
             inputHistory.map((text, index) => (
               <div key={index} className="history-item" onClick={() => setInput(text)}>
                 {text}
               </div>
             ))
           )}
         </div>
       </div>
     </div>
   </aside>
   ```

5. **Header JSX 新结构**：
   ```tsx
   <header className="chat-header">
     <div>
       <p className="eyebrow">Chat</p>
       <h2>Agent 控制台</h2>
     </div>
     <div className="header-actions">
       <button className="ghost-button" type="button" onClick={handleResetAgent}>
         重置会话
       </button>
       <div className="dropdown" ref={menuRef}>
         <button className="ghost-button" type="button" onClick={() => setIsMenuOpen(v => !v)}>
           菜单
         </button>
         {isMenuOpen && (
           <div className="dropdown-menu">
             <button className="dropdown-item" type="button" onClick={() => { setShowSkillsPanel(v => !v); setIsMenuOpen(false); }}>
               {showSkillsPanel ? '关闭 Skills' : 'Skills 管理'}
             </button>
             <button className="dropdown-item" type="button" onClick={() => { setShowSettings(v => { ... }); setIsMenuOpen(false); }}>
               {showSettings ? '关闭设置' : '设置'}
             </button>
             <div className="dropdown-divider" />
             <button className="dropdown-item" type="button" onClick={() => { setShowAboutModal(true); setIsMenuOpen(false); }}>
               关于
             </button>
           </div>
         )}
       </div>
     </div>
   </header>
   ```

6. **关于弹窗 JSX**：
   ```tsx
   {showAboutModal && (
     <div className="modal-overlay" onClick={() => setShowAboutModal(false)}>
       <div className="modal-content" onClick={(e) => e.stopPropagation()}>
         <h3>关于 Desktop Tools</h3>
         <p>{statusText}</p>
         <button className="ghost-button" type="button" onClick={() => setShowAboutModal(false)}>关闭</button>
       </div>
     </div>
   )}
   ```

### styles.css 样式变更

1. **Sidebar 布局调整**：
   ```css
   .sidebar {
     justify-content: flex-start; /* 移除 space-between */
     overflow: hidden;
   }
   .sidebar-content {
     flex: 1;
     min-height: 0;
     overflow-y: auto;
     display: flex;
     flex-direction: column;
     gap: 24px;
   }
   ```

2. **Dropdown 样式**：
   ```css
   .dropdown {
     position: relative;
   }
   .dropdown-menu {
     position: absolute;
     top: calc(100% + 8px);
     right: 0;
     min-width: 160px;
     padding: 8px;
     border-radius: 12px;
     border: 1px solid rgba(148, 163, 184, 0.2);
     background: rgba(15, 23, 42, 0.95);
     box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
     display: flex;
     flex-direction: column;
     gap: 4px;
     z-index: 100;
   }
   .dropdown-item {
     ...
   }
   ```

3. **Dropdown divider 样式**：
   ```css
   .dropdown-divider {
     height: 1px;
     margin: 4px 0;
     background: rgba(148, 163, 184, 0.2);
   }
   ```

4. **Modal 弹窗样式**：
   ```css
   .modal-overlay {
     position: fixed;
     inset: 0;
     background: rgba(0, 0, 0, 0.6);
     display: flex;
     align-items: center;
     justify-content: center;
     z-index: 200;
   }
   .modal-content {
     min-width: 320px;
     padding: 24px;
     border-radius: 16px;
     border: 1px solid rgba(148, 163, 184, 0.2);
     background: rgba(15, 23, 42, 0.95);
     display: flex;
     flex-direction: column;
     gap: 16px;
   }
   ```

5. **History list 样式**：
   ```css
   .history-list {
     max-height: 240px;
     overflow-y: auto;
     display: flex;
     flex-direction: column;
     gap: 4px;
   }
   .history-item {
     padding: 8px 12px;
     border-radius: 8px;
     font-size: 13px;
     color: #cbd5e1;
     cursor: pointer;
     overflow: hidden;
     text-overflow: ellipsis;
     white-space: nowrap;
   }
   .history-item:hover {
     background: rgba(96, 165, 250, 0.15);
   }
   ```

## 边界条件与异常处理

- **输入历史超限**：超过 100 条时，使用 `slice(0, 100)` 自动截断，丢弃最早的记录
- **空输入历史**：列表区域显示"暂无输入记录"占位文案，不渲染列表项
- **输入记录点击回填**：直接调用 `setInput(text)`，即使当前正在运行中也会回填（由 Composer 的 disabled 状态控制是否可编辑）
- **菜单外部点击**：通过 `pointerdown` 事件监听，判断 `event.target` 是否在 `menuRef` 内，避免误关
- **菜单操作后自动关闭**：点击菜单项后，在执行对应操作的同时自动 `setIsMenuOpen(false)`

## 数据流路径

```
[用户输入发送]
  Composer onSubmit
    → handleRunAgent
      → setInputHistory([prompt, ...prev].slice(0, 100))
      → 正常执行 Agent 流程

[用户点击输入记录]
  history-item onClick
    → setInput(recordText)
    → Composer textarea value 更新

[用户点击菜单按钮]
  dropdown button onClick
    → setIsMenuOpen(toggle)
    → 若展开，注册 document pointerdown 监听

[用户点击菜单中的「关于」]
  dropdown-item onClick
    → setShowAboutModal(true)
    → setIsMenuOpen(false)

[用户点击关于弹窗外部或关闭按钮]
  modal-overlay onClick / close button onClick
    → setShowAboutModal(false)

[用户点击菜单外部]
  document pointerdown
    → 判断 target 不在 menuRef 内
    → setIsMenuOpen(false)
```

## 预期结果

- 顶部 Header 右侧显示「重置会话」独立按钮和「菜单」下拉按钮，点击「菜单」展开包含「Skills 管理」「设置」「关于」的面板
- 左侧边栏不再显示「应用状态」和「DeepSeek 配置」状态卡片
- 左侧边栏显示「智能体」区块（静态列表）和「输入记录」区块（可滚动列表）
- 用户发送消息时，输入内容自动保存到输入记录列表（最多 100 条）
- 点击输入记录列表中的某一项，该项文本被回填到底部输入框
- 侧边栏整体布局为：品牌标题（顶部）→ 可滚动内容区（中间）
- 点击菜单中的「关于」，弹出模态框显示应用状态信息（应用名称、版本号等）
