# DeepSeek API Key 配置时支持查看明文

## 需求场景
当前设置页中的 DeepSeek API Key 输入框固定为密码模式，用户在录入或修改配置时无法临时查看明文，容易导致复制粘贴错误或难以校验输入内容。此前已将切换按钮替换为图片资源，但当前实现中图片无法展示，因此需要修正图片加载方案，并继续保持按钮悬浮在输入框之上。

目标行为：
- 用户在设置页编辑 DeepSeek API Key 时，默认仍为隐藏状态。
- API Key 输入框右侧上方悬浮一个图片按钮，图片内容来自 `e:\other-code\desktop-tools\.comate\specs\api-key-plaintext-toggle\mingwen.png`。
- 图片在开发环境和构建产物中都能正常显示。
- 用户点击图片按钮后，将当前输入框内容切换为明文显示；再次点击则恢复隐藏。
- 已保存配置仍默认以遮罩提示展示，不自动回填明文。
- 不新增返回明文 API Key 的 IPC 接口，不改变主进程中 API Key 的使用方式。

## 问题分析
当前 `src/renderer/App.tsx` 中直接使用了：
```tsx
const apiKeyToggleImageSrc = 'file:///E:/other-code/desktop-tools/.comate/specs/api-key-plaintext-toggle/mingwen.png';
```
这种做法的问题是：
- Renderer 运行在 Vite/Electron 渲染环境中，直接写死本地 `file:///` 绝对路径并不可靠。
- 开发态与构建态的资源解析方式不同，绝对本地路径不会被 Vite 作为静态资源接管。
- 最终导致按钮区域存在，但图片加载失败。

因此，这次修正的核心不是按钮逻辑，而是将图片纳入 Renderer 可管理的静态资源路径。

## 处理逻辑
1. 保留现有 `showApiKey` 状态与输入框明文切换逻辑。
2. 不再在 `App.tsx` 中硬编码 `file:///` 本地绝对路径。
3. 将 `mingwen.png` 放入 Renderer 可稳定访问的静态资源位置，并通过前端可识别的路径引用。
4. 输入框外层继续使用相对定位容器，图片按钮绝对定位在输入框区域右上角，以悬浮方式显示。
5. 用户点击图片按钮，仅影响当前 renderer 内存中的输入显示方式，不触发配置读取、保存或日志记录。
6. 用户保存配置时，沿用现有 `saveConfig()` 流程；只有当输入框有新值时才覆盖已保存 API Key。

## 技术方案
采用稳定资源托管方案：
- 将图片放入 renderer 的静态资源目录，例如 `src/renderer/assets/` 或 Vite `public/` 可访问目录。
- 在 `App.tsx` 中通过 Vite 资源导入或稳定静态路径使用该图片，而不是写死 `file:///` 绝对路径。
- 保留当前按钮悬浮样式，仅修正资源接入方式。

推荐方案：
- 直接在 `src/renderer` 可被 Vite 构建接管的位置使用图片资源。
- 由于用户指定了现有图片文件，实施时应复制该图片到 renderer 资源目录中使用，确保开发和打包后一致可见。

不采用的方案：
- 不继续使用 `file:///` 绝对路径。
- 不新增“读取明文 API Key”接口，因为这会扩大敏感信息暴露面。
- 不在 `MaskedAppConfig` 中增加明文字段，因为当前设计明确区分了主进程明文存储与渲染层遮罩展示。

## 影响范围
### 1. Renderer 设置页
- 文件：`e:\other-code\desktop-tools\src\renderer\App.tsx`
- 修改类型：资源引用方式与 UI 结构微调
- 影响函数：
  - `App()`
  - API Key 字段 JSX 区域
- 计划改动：
  - 删除 `file:///` 绝对路径常量
  - 改为使用 renderer 可识别的图片资源引用
  - 保留图片按钮、悬浮定位与状态重置逻辑

### 2. Renderer 样式
- 文件：`e:\other-code\desktop-tools\src\renderer\styles.css`
- 修改类型：样式保留或小幅微调
- 计划改动：
  - 保留现有图片按钮绝对定位样式
  - 如有必要微调尺寸、边距和点击区域，确保图片清晰可见

### 3. 静态资源
- 文件：建议新增 renderer 资源文件，例如：
  - `e:\other-code\desktop-tools\src\renderer\assets\mingwen.png`
- 修改类型：新增构建期可管理的静态资源
- 计划改动：
  - 将用户指定图片复制到 renderer 可访问目录
  - 保证 Vite 构建时可正确处理该图片

## 实现细节
### 修正图片引用方式
示例实现方向：
```tsx
import apiKeyToggleImageSrc from './assets/mingwen.png';
```
或使用 public 路径：
```tsx
const apiKeyToggleImageSrc = '/mingwen.png';
```

### API Key 输入框保留图片悬浮按钮
```tsx
<div className="field-input-overlay">
  <input
    type={showApiKey ? 'text' : 'password'}
    autoComplete="off"
    value={formValues.deepseekApiKey}
    onChange={(event) =>
      setFormValues((current) => ({
        ...current,
        deepseekApiKey: event.target.value,
      }))
    }
    placeholder={config?.hasApiKey ? '输入新 API Key 以覆盖当前值' : '请输入 DeepSeek API Key'}
  />
  <button
    className="field-overlay-button"
    type="button"
    aria-label={showApiKey ? '隐藏明文' : '查看明文'}
    title={showApiKey ? '隐藏明文' : '查看明文'}
    onClick={() => setShowApiKey((value) => !value)}
  >
    <img className="field-overlay-icon" src={apiKeyToggleImageSrc} alt="" aria-hidden="true" />
  </button>
</div>
```

### 状态重置建议
为了避免在保存后仍保持明文展示，可在以下时机重置：
```tsx
setShowApiKey(false);
```
建议放在：
- `handleSaveConfig()` 成功后
- 重新加载配置后
- 关闭设置面板时

## 边界条件与异常处理
- 当输入框为空时，点击图片按钮仍允许切换，但不会展示任何额外数据。
- 若用户已有已保存 API Key，但本次未输入新值，则仍只显示遮罩提示，不通过界面回显旧明文。
- 如果设置页关闭后重新打开，建议恢复为默认隐藏状态，避免 UI 残留上一次的显示偏好。
- 图片必须通过 renderer 静态资源链路加载，避免再依赖本地绝对文件路径。
- 不修改 `config-service.ts`、`contracts.ts`、`preload/index.ts` 的数据结构，避免敏感信息经 IPC 明文传输。

## 数据流
### 现状
`config.json (主进程明文)` → `config-service.ts` → `toMaskedConfig()` → `ipcMain.handle('config:get')` → `preload` → `App.tsx` → 设置页遮罩展示

### 改动后
配置读取链路保持不变；仅在 `App.tsx` 内部增加：
`本地输入值` + `showApiKey UI 状态` + `renderer 静态图片资源` → 决定输入框显示模式

即：
- 已保存值仍通过 `maskedApiKey` 提示
- 当前编辑值是否显示明文，仅由前端本地状态控制
- 图片按钮仅作为显示开关的视觉载体
- 图片由 Vite/Electron renderer 资源链路稳定提供

## 预期结果
- 用户配置 DeepSeek API Key 时可通过图片按钮手动查看当前输入的明文。
- 图片按钮悬浮在 API Key 输入框之上，视觉上更贴近输入区域。
- 图片在开发环境和构建产物中都能正常展示。
- 不会把已保存 API Key 明文从主进程返回到渲染层。
- 不影响现有保存、遮罩显示、审计日志和 DeepSeek 调用逻辑。
- 改动范围仍集中在设置页 UI，不影响 Agent 主流程。
