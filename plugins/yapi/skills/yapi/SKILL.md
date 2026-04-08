---
name: yapi
description: "YApi API文档管理助手。当用户要求查询、搜索、创建、更新、导出API接口文档时触发，或用户提到 YApi、接口文档、API文档、接口定义、swagger 等关键词时触发。"
argument-hint: <API名称或关键词>
disable-model-invocation: false
---

# YApi API文档管理助手

帮助用户通过 YApi MCP Server 查询和管理云端 API 接口文档。

## 可用 MCP 工具

来自 yapi MCP server：

1. **yapi-auth** — SSO 登录（首次使用需要扫码认证）
2. **yapi-logout** — 退出登录，清除凭证
3. **list_projects** — 列出用户有权限的所有分组和项目
4. **list_apis** — 获取项目下所有 API 接口（按分类分组）
5. **search_api** — 按路径或标题关键词搜索 API 接口
6. **get_api_detail** — 获取单个 API 的完整定义（参数、请求体、响应体）
7. **get_project_info** — 获取项目基本信息
8. **export_swagger** — 导出 Swagger/OpenAPI 格式文档
9. **import_api_docs** — 批量导入完整 API 文档（支持按分类或关键词过滤）
10. **create_api** — 创建新 API 接口
11. **update_api** — 更新已有 API 接口

## 工作流程

当用户请求查询或操作 API 文档时，**按以下步骤执行**：

### 第 1 步：认证检查

如果尚未认证，先调用 `yapi-auth` 进行 SSO 登录。

### 第 2 步：确定项目

- 如果用户未指定项目，使用 `list_projects` 列出可用项目让用户选择
- 如果用户提供了 project_id，直接使用

### 第 3 步：查询接口

根据用户需求选择合适的工具：

- **搜索特定接口**: 使用 `search_api`，提供 project_id 和关键词
- **浏览所有接口**: 使用 `list_apis` 获取完整接口列表
- **查看接口详情**: 使用 `get_api_detail` 获取完整定义（包含请求参数、请求体、响应体 schema）
- **批量获取文档**: 使用 `import_api_docs` 一次性获取多个接口的完整文档

### 第 4 步：展示结果

- 以清晰的格式展示接口信息
- 包含 HTTP 方法、路径、参数说明、请求体/响应体结构
- 如果有环境域名信息，展示完整 URL

### 创建/更新接口

- **创建接口**: 使用 `create_api`，需要 project_id、cat_id、title、path、method
- **更新接口**: 使用 `update_api`，需要 interface_id，只修改指定字段
