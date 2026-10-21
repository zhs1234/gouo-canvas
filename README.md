# Gouo Canvas

[简体中文](./README.zh-CN.md) · **English** · [Documentation](./docs/README.md)

An AI creation app with three workspaces: image generation, an infinite canvas, and Agent. A Go backend derived from One Hub manages accounts, points (1 CNY = 100 points), and cloud libraries. Platform API keys stay on the server; the admin panel is for administrators only.

- **Generate images**: text-to-image generation, reference-image and masked editing, and library management.
- **Canvas**: reuse Infinite Canvas's interface and interactions to organize images, text, and connections across projects.
- **Agent**: a centered composer before the first message, then a conversation with a bottom composer. Chat, submit image tasks, and edit a linked canvas through the platform API, without installing local Codex or Claude.

<img src="./public/gouo-logo-512.png" alt="Gouo Canvas logo" width="192" />

[Live demo](https://canvas.wcnmb.top/) — an account is required; image generation is charged in points.

## Preview

Captured from a local demo environment in October 2026 with demo accounts and data; the artwork was drawn for the documentation, not produced by a model. More screenshots are in the [user guide](./docs/en/user-guide.md) and [backend guide](./docs/en/backend.md#3-admin-panel).

| Creation | My works |
| --- | --- |
| ![Creation page](./docs/images/screenshots/client-create.webp) | ![My works](./docs/images/screenshots/client-works.webp) |
| **Canvas** | **Agent** |
| ![Canvas](./docs/images/screenshots/client-canvas.webp) | ![Agent](./docs/images/screenshots/client-agent.webp) |
| **User center** | **Admin: Gouo models** |
| ![User center](./docs/images/screenshots/client-user-center.webp) | ![Gouo models](./docs/images/screenshots/panel-gouo-models.webp) |

## Get started

Requires Node.js 22, npm, Git, and Go 1.25. Local setup, deployment, and checks are in the guides below.

- [Development guide](./docs/en/development.md) — local setup and frontend variables
- [Deployment overview](./docs/en/deployment/index.md) — [Docker Compose](./docs/en/deployment/docker.md), [manual Linux](./docs/en/deployment/manual.md), [production checklist](./docs/en/deployment/checklist.md)
- [User guide](./docs/en/user-guide.md) · [Backend](./docs/en/backend.md) · [Testing and mock API](./docs/en/testing.md) · [Changelog](./CHANGELOG.md)
- Environment examples: [`.env.example`](./.env.example) · [`deploy/.env.example`](./deploy/.env.example)

`server/docs/` belongs to upstream One Hub. Use the Gouo guides above for this project.

## License

The frontend is derived from [GPT Image Playground](https://github.com/CookSleep/gpt_image_playground) (MIT). The backend is derived from [One Hub](https://github.com/MartialBE/one-hub) (Apache-2.0); original notices stay in [LICENSE](./LICENSE) and `server/`. The canvas reuses [Infinite Canvas](https://github.com/basketikun/infinite-canvas) at commit `dab19adc0847e32e39b7fc8ff90cb392561fb826` ([license](./src/lib/canvas/LICENSE.infinite-canvas), [adaptations](./src/lib/canvas/UPSTREAM.md)). Distribution includes the [third-party notices](./public/third-party-notices.txt).
