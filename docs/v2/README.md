# Gouo Canvas V2

## 1. 决策

V2 不在现有前端上继续大规模堆功能，也不从零重写全部系统。

采用：

- 新前台与新业务架构
- 复用现有 Go / One Hub 后端成熟能力
- 复用现有用户、模型渠道、支付、日志、存储等基础设施
- 新增电商工作流、项目/模板/素材、异步任务、订阅权益
- 旧版继续留在 `main`，V2 在 `v2` 分支持续开发

V2 的产品中心从“模型参数 Playground”切换为“电商图片任务”。

## 2. 现有代码处理原则

### 直接复用

后端优先复用：

- 用户注册、登录、Session、权限
- One Hub 模型路由、Channel、Token、OpenAI-compatible relay
- Fal / OpenAI 等现有图片模型适配思路
- 用量日志、管理后台和统计能力
- 支付网关基础设施
  - 支付宝
  - 微信支付
  - Stripe
  - Epay
- 现有订单和支付回调框架
- Redis
- MySQL / PostgreSQL / SQLite 的 GORM 基础设施
- 现有 S3 / 阿里云 OSS 存储驱动
- Gouo Cloud 的用户隔离、任务、素材同步设计中可复用的部分
- Docker / Nginx 部署资产

前端可迁移：

- 图片生成 API adapter
- prompt 图片引用处理
- 尺寸/格式兼容逻辑
- 图片导出 ZIP
- mask / transparent / image utilities
- 已验证的错误处理和任务恢复逻辑

### 不作为 V2 基础继续扩展

以下代码保留作行为参考，但不继续堆业务：

- `src/store.ts`
- `src/components/InputBar.tsx`
- `src/components/SettingsModal.tsx`
- 当前首页/图库即工作台的页面结构
- 直接把大量模型参数暴露给普通用户的交互
- 当前以余额/单次扣费为前台核心的产品逻辑

## 3. V2 产品结构

```text
首页 / 工作台
├─ 商品主图
├─ 商品白底图
├─ 商品场景图
├─ 换背景
├─ 商品海报
├─ AI 模特
├─ 图片扩展
├─ 高清修复
├─ 批量处理
└─ 我的项目

编辑器
├─ 图片
├─ 文字
├─ 图层
├─ Logo / 品牌素材
├─ 模板
├─ 对齐 / 吸附
├─ 裁剪 / 旋转 / 缩放
└─ 导出平台尺寸

账户
├─ 套餐
├─ 权益
├─ 月度额度
├─ 使用记录
├─ 订单
└─ 云空间
```

普通用户不直接面对 Provider、API Key、CFG、模型路由等底层概念。

## 4. 技术基线

### 前端

继续使用 React + TypeScript，减少无收益的技术迁移。

计划引入：

- Fabric.js：主设计画布
- TanStack Query：服务端状态、请求、缓存
- Zustand：仅保留轻量本地 UI / editor state
- Uppy：批量上传与上传队列
- Tailwind：继续复用
- Filerobot Image Editor：只在裁剪、滤镜等成熟局部编辑能力真正节省开发成本时接入

不要把第三方完整编辑器 UI 当成产品主体。Gouo 自己控制工作流和界面。

### 后端

继续使用：

- Go
- Gin
- GORM
- One Hub relay
- Redis
- MySQL
- S3 / 阿里云 OSS
- 现有支付网关

新增：

- Project
- Asset
- Template
- Workflow
- Job
- Plan
- Subscription
- Entitlement
- UsageLedger

### 异步任务

引入 Asynq 作为 Go + Redis 后台任务队列候选。

所有耗时操作任务化：

- 生图
- 抠图
- 批量生图
- 高清化
- 图像扩展
- 多步骤电商工作流
- 导出批处理

### AI Worker

第一阶段不要求部署本地大模型。

优先：

1. 现有 API Provider
2. rembg 作为独立抠图 Worker
3. ComfyUI 仅作为后期独立高级工作流服务，不嵌入普通用户 UI

## 5. 订阅模型

前台从“充值余额 + 单次扣费”改为“套餐 + 月度权益”。

内部仍保留真实成本与 Credits 账本。

```text
Plan
  ↓
Subscription
  ↓
Entitlement
  ├─ monthly_generation
  ├─ premium_model
  ├─ batch_generation
  ├─ cloud_storage
  ├─ hd_export
  └─ commercial_templates

UsageLedger
  ├─ 用户看到套餐消耗
  └─ 后台记录真实模型成本
```

现有 Order / Payment 不推翻，扩展为购买套餐。

第一阶段只做按月购买/续费，不先做复杂的微信/支付宝自动续费签约。

## 6. 第一批业务工作流

优先级：

1. 商品白底图
2. 商品换背景 / 场景图
3. 商品主图
4. 商品海报
5. 批量商品图

平台预设：

- 淘宝 / 天猫
- 拼多多
- 抖音电商
- 小红书
- Amazon / 独立站

平台差异先通过模板、尺寸、导出 preset、prompt workflow 表达，不为每个平台复制一套代码。

## 7. 开发阶段

### Phase 0 — V2 骨架

- 路由与 App Shell
- 登录态接旧后端
- 工作台
- Projects / Assets 基础 API
- 保留旧系统不受影响

### Phase 1 — 可用闭环

完成：

上传商品 → 生成 → 保存 → 查看历史 → 下载

此阶段要求可真实使用，不做占位页面。

### Phase 2 — 商品工作流

完成：

上传商品 → 自动抠图 → 场景/模板 → AI 生成 → 结果选择

### Phase 3 — 编辑器

完成：

图片、文字、图层、模板、品牌素材、Undo/Redo、导出尺寸。

### Phase 4 — 订阅

完成：

Plan、Subscription、Entitlement、UsageLedger、套餐购买、续费、额度重置。

### Phase 5 — 批量与平台化

完成批量任务、多个平台 preset、失败重试、任务队列、成本统计。

## 8. 开源项目选型原则

任何新 GitHub 项目进入核心代码前必须检查：

1. License 是否允许商业使用
2. 最近是否仍维护
3. 社区规模和真实使用情况
4. 是否能作为模块接入，而不是反过来绑架 Gouo 架构
5. 是否真正减少开发量
6. 是否与 React / Go / 当前部署方式匹配

目前优先候选：

- Fabric.js
- TanStack Query
- Uppy
- Asynq
- rembg
- Filerobot Image Editor

谨慎处理：

- tldraw：许可证和商业 SDK 条件需要单独确认
- ComfyUI：GPL-3.0，仅作为独立服务候选
- AGPL 项目：默认不进入闭源核心代码

## 9. Codex 规则

Codex 在 V2 中应遵守：

- 不为了“兼容旧 UI”复制旧架构
- 先复用后端成熟能力，再决定新增
- 不重写已经存在且可用的支付、存储、认证和模型网关
- 新业务按 domain 拆分，禁止再形成新的 5000 行 store
- 服务端数据交给 TanStack Query，不放进全局 Zustand 大仓库
- 编辑器状态与业务状态分离
- 每个阶段都必须有可运行验收路径
- 不提交 stub / TODO 作为阶段完成结果
