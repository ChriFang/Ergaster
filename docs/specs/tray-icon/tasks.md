# 关闭按钮行为样式改造（rev3）实施计划

- [x] Task 1: styles.css 新增 settings 分段按钮组样式
    - 1.1: `.settings-segmented` 容器：横排 flex、间距 6px
    - 1.2: `.settings-segmented-item`：每项带边框（rgba(120, 139, 164, 0.28)）、圆角 6px、透明底、`var(--text-soft)` 文字、padding 4px 14px、hover 反馈
    - 1.3: `.settings-segmented-item-active`：选中项青色描边（rgba(34, 211, 238, 0.55)）、亮青文字（#d8fbff）、淡青底（rgba(34, 211, 238, 0.16)），对齐截图 Low/High/Max 样式

- [x] Task 2: SettingsPanel.tsx 改造关闭按钮行为设置项
    - 2.1: 删除原位置的「关闭按钮行为」`<select>` 下拉块（OneAPI 兼容组之后）
    - 2.2: 在 GitHub Token 块之后、保存按钮之前新增「关闭按钮行为」设置项：三个分段按钮（每次询问/最小化到托盘/直接退出），`type="button"` + `aria-pressed` 标记选中态，点击即调 `onCloseActionChange`（即时保存逻辑不变），保留说明 small 文案
    - 2.3: grep 验证「关闭按钮行为」在文件中仅出现一次且位于 GitHub Token 之后

- [x] Task 3: 验证与文档
    - 3.1: `npm run typecheck` 通过（纯 UI 改动，无测试变更）
    - 3.2: `summary.md` 追加 rev3 变更记录
