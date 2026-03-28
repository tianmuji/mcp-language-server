---
name: i18n
description: "多语言字符串集成助手。当用户要求集成、查询、替换多语言字符串时触发，或用户提到 i18n、多语言、$t、国际化、翻译等关键词时触发。"
argument-hint: <要集成的中文字符串>
disable-model-invocation: false
---

# 多语言字符串集成助手

帮助用户查询、集成 CamScanner 系列产品的多语言字符串到项目代码中。

## 可用 MCP 工具

来自 language MCP server：

1. **search-string** — 按关键词搜索多语言字符串（远程多语言平台）
2. **export-string** — 导出为兼容 cs-i18n 的 locale JSON 格式
3. **write-locales** — 将字符串写入项目的 locales 目录
4. **get-version-list** — 获取产品的版本列表

## 常用产品 ID

| ID | 产品 |
|----|------|
| 1 | CamCard |
| 2 | CamScanner |
| 44 | CamScanner Lite |
| 47 | CS PDF |
| 53 | CS Harmony |

## 项目 i18n 配置

- 框架: vue-i18n
- locale 文件位置: `src/locales/`
- 主参考文件: `src/locales/ZhCn.json`
- 文件格式: **扁平 key-value 结构**，无嵌套
- 参数占位符: `{0}`, `{1}`, `{2}` ...（%s 会自动替换）

## 代码中的使用方式

### 模板中

```vue
{{ $t('key_name') }}
{{ $t('cs_519b_selected_some', [count]) }}
```

### TypeScript 中

```typescript
import { i18n } from '@/i18n'
i18n.global.t('key_name')
i18n.global.t('key_name', [param1, param2])
```

## 工作流程

当用户请求集成一个字符串时，**严格按以下步骤执行**：

### 第 1 步：本地查找（优先）

先在项目本地 locale 文件中搜索，检查是否已存在匹配的字符串：

1. 使用 **Grep 工具**在 `src/locales/ZhCn.json` 中搜索用户提供的中文字符串
2. **严格匹配规则**: value 必须与用户需要的字符串**完全一致**
3. 如果本地找到了完全匹配的 key → **直接使用该 key，跳到第 4 步**

### 第 2 步：远程查询（本地未找到时）

使用 `search-string` 从远程平台查询：
- `product_id` 默认使用 `2`（CamScanner）
- **必须使用精确匹配**: `fuzzy: "0"`

### 第 3 步：用户确认

- 将结果整理为表格展示（版本、key、中文、英文、繁体）
- 无匹配结果 → 告知用户需要在多语言平台新增

### 第 4 步：写入本地 & 替换代码

1. 检查本地是否已有该 key
2. 如果没有：使用 `write-locales` 写入（`platform_id: "4"` Web 平台）
3. 替换代码中的硬编码字符串为 `$t('key_name')`
