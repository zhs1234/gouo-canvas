# Changelog / 变更记录

All notable Gouo Canvas product changes are recorded here. Dates use `YYYY-MM-DD`.

光构的重要产品变更统一记录在此，日期格式为 `YYYY-MM-DD`。

## 0.1.0 — 2026-07-13

### 中文

首个光构产品化版本。

#### 品牌与体验

- 完成“光构 / Gouo Canvas”品牌、Logo、蓝色主题和仓库链接统一。
- 移除公开产品前台不再使用的 Agent 入口和用户 API 配置入口。
- 新增新用户引导、灵感库、用户中心和 PWA 安装入口。

#### 账号与作品库

- 接入基于 One Hub 的登录、注册、会话和统一图片 API 中继。
- 为每位用户生成独立中继令牌，上游 API Key 不下发到浏览器。
- 接入额度、兑换码、使用记录和账号作用域的本地数据隔离。
- 新增任务、图片、参考图、遮罩、缩略图和收藏夹云端同步。
- 新增可恢复回收站、空间配额和管理端作品查看。

#### 计费与运维

- 图片生成、编辑和变体按成功请求次数固定计费。
- 默认售价为 ¥0.10/次，可通过 `GOUO_IMAGE_PRICE_CNY` 调整。
- 失败请求退回预扣额度，并加入固定价格计费测试。
- 增加 Docker Compose、传统服务器部署、备份恢复和生产检查说明。

#### 文档

- 将根项目说明和光构文档重建为中英文同步结构。
- 合并已实现的 SaaS 计划与重复后端说明，移除过时截图和重复的自定义服务商提示词副本。
- 明确完整产品模式与纯前端开发模式的差异。

### English

The first productized Gouo Canvas release.

#### Brand and experience

- Unified the Gouo Canvas name, logo, blue visual theme, and repository links.
- Removed the obsolete Agent entry point and end-user API configuration from the hosted product UI.
- Added onboarding, inspiration library, user center, and PWA installation entry points.

#### Accounts and library

- Integrated One Hub-based registration, sessions, and unified image API relay.
- Added a per-user relay token without sending the upstream platform key to browsers.
- Added balance, redemption codes, usage history, and account-scoped local-data isolation.
- Added cloud synchronization for tasks, images, references, masks, thumbnails, and collections.
- Added a recoverable recycle bin, storage quota, and admin artwork inspection.

#### Billing and operations

- Changed image generations, edits, and variations to fixed billing per successful request.
- Set the default selling price to CNY 0.10, configurable with `GOUO_IMAGE_PRICE_CNY`.
- Added refund-on-failure behavior and fixed-price billing tests.
- Added Docker Compose, manual server, backup/restore, and production-readiness guidance.

#### Documentation

- Rebuilt the root project overview and Gouo documentation as matching Chinese and English trees.
- Consolidated the implemented SaaS plan and duplicate backend notes, and removed stale screenshots and the duplicate custom-provider prompt copy.
- Documented the distinction between full product mode and frontend-only development mode.

## Upstream history / 上游版本历史

The frontend is derived from [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground). Consult its repository for releases before the Gouo fork.

前端基于 [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground) 修改；光构分支之前的版本记录请查阅其上游仓库。
