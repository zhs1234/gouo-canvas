# 内置技能第三方来源声明

本目录（`src/skills/`）下的内置技能内容改编自以下开源项目。所有内容均已由本项目**翻译为简体中文并做了修改**（依据 Apache License 2.0 第 4(b) 条在此声明）：删除了与本应用无关的脚本、命令行、文件路径、特定平台与特定模型的说明，按本应用的图片工具（`create_image_task`、`get_canvas`、`get_task_status` 等）重写了操作步骤，并重新组织、精简和补充了内容。改编内容不代表上游作者的观点，上游作者不对本改编版本负责。

许可证全文见：

- Apache License 2.0：`licenses/Apache-2.0.txt`
- MIT（OpenAI Cookbook）：`licenses/MIT-openai-cookbook.txt`
- MIT（gpt_image_2_skill）：`licenses/MIT-gpt_image_2_skill.txt`

## 上游来源

| 简称 | 项目与路径 | 许可证 | 版权方 |
|------|------------|--------|--------|
| A | openai/skills — `skills/.system/imagegen`（SKILL.md、references/prompting.md、references/sample-prompts.md）<br>https://github.com/openai/skills/tree/main/skills/.system/imagegen | Apache-2.0 | OpenAI |
| B | openai/openai-cookbook — `examples/multimodal/image-gen-models-prompting-guide.ipynb`<br>https://github.com/openai/openai-cookbook | MIT | Copyright (c) 2025 OpenAI |
| C | wuyoscar/gpt_image_2_skill — `skills/get-prompt-from-image`（SKILL.md 及 references）<br>https://github.com/wuyoscar/gpt_image_2_skill | MIT | Copyright (c) 2026 Wuyoscar |
| D | SupercmoHQ/superCMO-skills — `skills/generating-product-photos`、`skills/generating-image-ads`<br>https://github.com/SupercmoHQ/superCMO-skills | Apache-2.0 | Copyright (c) 2026 Kshitiz Kumar |
| E | nexu-io/open-design — `skills/ecommerce-image-workflow`<br>https://github.com/nexu-io/open-design | Apache-2.0（该目录无单独 LICENSE，按仓库 `skills/README.md` 适用 Apache-2.0） | Copyright 2026 Open Design contributors |
| F | anthropics/skills — `skills/canvas-design`、`skills/theme-factory`<br>https://github.com/anthropics/skills | Apache-2.0 | Copyright 2026 Anthropic, PBC. |
| G | anthropics/skills — `skills/brand-guidelines`（仅借鉴“品牌规范”的条目结构，未使用其中任何颜色、字体、名称或文字） | Apache-2.0 | Copyright 2026 Anthropic, PBC. |
| H | Emily2040/nano-banana-image-skill — `skills/core/continuity.md`、`reference-binding.md`、`preservation.md`、`edit-delta.md`、`text-layout.md`<br>https://github.com/Emily2040/nano-banana-image-skill | Apache-2.0 | Copyright 2026 Iamemily2050 |

## 各技能对应来源

| 技能 | 使用的来源 | 本文件许可证 |
|------|------------|--------------|
| `image-prompting`（含 `references/use-cases.md`） | A、B | Apache-2.0（含 B 的 MIT 授权内容） |
| `image-editing`（含 `references/edit-recipes.md`） | A、B、H | Apache-2.0（含 B 的 MIT 授权内容） |
| `image-to-prompt`（含 `references/dimensions.md`） | C | MIT |
| `product-photos`（含 `references/formats.md`） | D、E、B | Apache-2.0（含 B 的 MIT 授权内容） |
| `poster-design` | F（canvas-design，仅改编“设计理念”部分） | Apache-2.0 |
| `consistent-characters` | B、H | Apache-2.0（含 B 的 MIT 授权内容） |
| `text-in-image` | A、B、H | Apache-2.0（含 B 的 MIT 授权内容） |
| `logo-brand` | A、B、G（仅结构参考） | Apache-2.0（含 B 的 MIT 授权内容） |
| `color-themes`（含 `references/themes.md`） | F（theme-factory，配色 hex 值沿用，主题名改为中文并重写说明，字体名替换为字形风格描述） | Apache-2.0 |

## 上游 NOTICE 文件内容

superCMO-skills 仓库的 NOTICE 文件中与本改编相关的声明（依据 Apache License 2.0 第 4(d) 条转载）：

```
SuperCMO Skills
Copyright (c) 2026 Kshitiz Kumar

The media client and marketing skills in this
repository are original work, distributed under the Apache License, Version 2.0.
```

其余上游仓库在获取时未提供 NOTICE 文件。

## 未采用的内容

- superCMO-skills 中“借用知名摄影师风格作为隐性参考”的做法未采用，以避免模仿在世艺术家的标志性风格。
- 各上游中关于脚本、命令行、API 密钥、本地文件保存、遮罩/透明背景/input_fidelity 等参数的内容未采用，因为本应用的图片工具不提供这些能力。
- 商标说明：各上游项目及其作者的名称仅用于说明来源，不表示任何认可或合作关系。
