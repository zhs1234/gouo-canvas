# Gouo Canvas user guide

[简体中文](../zh-CN/user-guide.md) · [Documentation index](../README.md)

This guide is for creators using the hosted, account-based product mode. Operators should use the [deployment overview](./deployment/index.md) and [backend integration guide](./backend.md).

The application interface is Chinese, so these instructions include the Chinese label for important controls.

> Screenshots come from a local demo environment (October 2026). Accounts, works, and points are demo data; the artwork was drawn for the documentation and is not real model output.

## 1. Register and sign in

Opening Gouo Canvas while signed out shows the product home page. Use **免费注册** (Register for free) or **登录** (Sign in) in the header or hero section.

![Gouo Canvas home page](../images/screenshots/client-landing.webp)

1. Choose **免费注册**, then enter a username (up to 12 characters) and a password (8–20 characters). Complete email verification or the human check if the operator enabled them.
2. After registering you enter the creation workspace. The operator can grant points to new users.
3. Existing users choose **登录**.

![Sign-in page](../images/screenshots/client-login.webp)

- When the operator closes registration, **免费注册** shows "暂未开放注册" (registration is not open) and the sign-in page hides its registration link.
- When the operator pauses password sign-in, the sign-in page shows a notice and the sign-in button is disabled.
- With email delivery enabled, users can bind an email address in the user center and reset a forgotten password from **忘记密码** (Forgot password) on the sign-in page. Without email delivery that link is hidden; contact the operator for account recovery.

The backend keeps the session in a cookie. Changing `SESSION_SECRET` invalidates existing sessions; changing `USER_TOKEN_SECRET` invalidates existing generation tokens. If the UI reports an invalid token, sign out and sign in again.

## 2. The creation workspace

After signing in you land on **创作** (Create). The sidebar holds Create, **我的作品** (My works), **收藏** (Favorites), and **灵感库** (Inspiration), plus **创作会话** (Agent conversations) and **我的画布** (My canvases). The top right shows your available points and the user center button.

![Creation page](../images/screenshots/client-create.webp)

- The banner at the top shows the operator's announcement. A dismissed announcement reappears when its text changes. Without an announcement, a default introduction is shown.
- The **生成图片 / 画布 / Agent** switch selects one of three ways of working. The operator can turn off the canvas or Agent, which hides their entry points.
- Below the prompt box are the model menu, the estimated charge, parameters, and the reference image entry.

## 3. Create the first image

1. Describe the subject, scene, composition, light, and constraints in the prompt box.
2. Pick a model from the model menu. The estimated charge appears below the box, for example "预计 20 积分（1 张 · 20 积分/张）· 按成功张数计费" (about 20 points, 1 image at 20 points each, billed per successful image).
3. Optionally set size, quality, format, and image count (up to 10 per submission; the operator can lower this) under **自定义参数** (Custom parameters).
4. Optionally add reference images or draw a mask on a reference.
5. Click the arrow to submit. Results appear under **本次生成** (This session) below the prompt box and in **我的作品**.

Before submitting, the client checks your balance; if it is too low, no task is created and the redemption page opens. The server reserves points when a request starts and refunds images it confirms as failed. Several images are split into single-image requests and billed per successful image.

Your model choice is remembered per account. The operator can set a default model, which users who never picked a model use automatically; if your chosen model is withdrawn, the client also falls back to the default. Submission is blocked when the chosen model cannot handle references or masks. When a model's price or capabilities change, the UI asks you to confirm again. Retrying an older task keeps its original model and shows the new price for separate confirmation if it changed.

## 4. Writing prompts

A clear prompt usually covers:

- **Subject**: who or what appears.
- **Environment**: where the subject is and what surrounds it.
- **Medium**: photography, illustration, 3D, poster, infographic, and so on.
- **Composition**: close-up, full body, overhead, wide angle, centered, and so on.
- **Light and mood**: soft light, backlight, neon, calm, energetic, and so on.
- **Constraints**: no text, no watermark, keep a pose or product structure, and so on.

Example:

```text
A transparent acrylic music player on a dark metal desk.
Premium product photography, centered composition, soft side light and a blue rim light,
plain background, no text, logos, or watermarks.
```

Describe the visible result. Saying "make it nicer" or "more professional" is usually less effective than naming materials, viewpoint, colors, and empty space.

## 5. Inspiration library

**灵感库** (Inspiration) holds 22 prompt templates. Search them or browse by category, such as UI & interfaces, charts & infographics, posters & typography, and products & e-commerce. The **灵感精选** (Featured) cards and quick tags on the creation page come from this library.

![Inspiration library](../images/screenshots/client-inspiration.webp)

- Click a card to see the full prompt, usage tips, and the source of the example image.
- **填入提示词** (Fill in prompt) writes the template into the creation prompt box without sending it.
- The copy button copies the text only and does not replace your current draft.
- Square brackets in a template are placeholders; replace them with your own subject, brand, colors, and composition before submitting. Example images keep their original authors' attribution and are not outputs of the template.

## 6. Reference images and image references

Add up to 16 images with **上传图片** (Upload image), drag and drop, or paste. Upstream channels may impose stricter limits on count, format, and size.

- Explain each image's role in the prompt, for example "keep the person from image 1 and use the colors of image 2".
- Type `@` to insert an explicit reference to one of the current images.
- On desktop, drag thumbnails to reorder them; existing references update automatically.
- **编辑输出** (Edit output) on a work card adds that work as a reference so you can keep editing it.
- Only upload images you are allowed to process, and nothing you do not want sent to the platform or upstream providers.

A reference image does not tell the model what to keep. If identity, pose, product outline, or composition must stay the same, say so in the prompt.

## 7. Masked edits

![Mask editor](../images/screenshots/client-mask-editor.webp)

1. Add the image you want to change as a reference.
2. Click that reference's edit control and choose **添加遮罩** (Add mask). Tick "以后默认执行此选择" (always do this) to skip the question next time.
3. Paint the area to change; the blue area is the region to be edited. Use the eraser, brush size, undo/redo, or clear the mask; scroll to zoom and hold Alt to pan.
4. Click **保存** (Save) and describe what the masked area should become, for example "turn only the masked area into a red coat".
5. Submit the edit.

The chosen model must support masked edits. If the mask covers the whole image, the UI warns that the entire image may be redrawn and asks for confirmation.

## 8. My works

![My works](../images/screenshots/client-works.webp)

**我的作品** (My works) lists all works by time, 60 per page. Search prompts and parameters, or filter by status: all, completed, running, failed, or recycle bin. Each card can be favorited, have its settings reused, have its output edited, or be deleted.

Click an image to open its details: the full prompt, actual parameters, model, and creation time. You can download, reuse settings, edit the output, or delete from there.

![Work details](../images/screenshots/client-work-detail.webp)

Desktop supports marquee selection and `Ctrl`/`⌘` multi-select; mobile has a multi-select mode. Selections can be downloaded, favorited, or deleted together. Changing the search or filter returns to the first page, and selections persist across pages.

## 9. Favorites

- One work can belong to several favorite folders.
- The favorites page supports searching, managing folders, and batch download.
- Deleting a folder does not delete the works in it.
- Folders and their contents sync with the account. Renames and deletions sync too, and a deleted folder is not recreated when an old device reconnects.

## 10. Canvas

**画布** (Canvas) lays out images, text, and generation settings on an infinite board, which suits planning and multi-round revisions. **我的画布** (My canvases) in the sidebar lists your canvases; click **+** to create one.

![Canvas](../images/screenshots/client-canvas.webp)

- The bottom toolbar adds text, image, generation-settings, and group nodes, uploads assets, changes the canvas look, or clears the canvas. The bottom left controls zoom, view reset, and the minimap.
- A generation-settings node takes a prompt, model, size, and count, and shows the estimated charge. **生成图片** (Generate) adds the result as a new image node connected on the right. Connected text and image nodes are used as extra prompt text and references.
- The left panel's **画布 / 素材 / 提示词** (Canvas / Assets / Prompts) tabs browse nodes, existing works, and prompts.
- **Agent** at the top right opens a conversation linked to this canvas, so the Agent can read and arrange it.
- Canvases are saved to your account and can be continued on another device; deleted canvases go to the recycle bin.

## 11. Agent

The Agent is a conversational assistant. Describe what you need; it proposes ideas and, when needed, calls tools to generate images or to read and edit a linked canvas.

![Agent conversation](../images/screenshots/client-agent.webp)

- Below the input you choose the chat model (configured by the operator) and the image model, and you can link a canvas. **+** adds reference images or picks existing works as references.
- `Enter` sends and `Shift + Enter` adds a new line. You can stop a reply while it is generating.
- Image tasks the Agent submits are charged at the selected image model's price and also appear in **我的作品**. If one message would create more than 4 images in total, you are asked to confirm first. The chat itself is billed by platform text usage.
- **创作会话** (Agent conversations) in the sidebar keeps your history; the top right starts a new conversation or opens the history. Conversations sync with the account.

## 12. Cloud library and recycle bin

When you are signed in, successful images are saved to your account by the server as soon as they are produced; the browser only caches them. Failed tasks are not uploaded. Favorites, canvases, and Agent conversations are saved with the account too.

- Sign in with the same account in another browser or device to see saved content.
- Cached works remain viewable during network interruptions.
- Older local works and works imported from ZIP are not uploaded automatically. Import them from **用户中心 → 导入本机旧作品** (User center → Import local works); clearing site data before that loses them.
- Deleted works, canvases, and conversations go to the recycle bin. Restore them from **回收站** (Recycle bin) in the works filter menu; they still count toward cloud storage meanwhile.

Recycle-bin items are kept for 3 days, then permanently deleted together with images that are no longer referenced. They cannot be recovered after that.

## 13. Points, redemption codes, and usage

Gouo Canvas bills in points (积分): **1 CNY = 100 points**. Balance, model prices, estimated charges, usage records, and exported CSV are all shown in points.

Click the balance or avatar at the top right to open the user center:

![User center](../images/screenshots/client-user-center.webp)

- **账户余额** (Balance): available points.
- **累计消费** (Total spent): points consumed so far, converted at the current rate.
- **图片计费** (Image billing): priced per model, confirmed before generating, charged per successful request.
- **云端空间** (Cloud storage): used space and limit, plus **导入本机旧作品**.

Enter a redemption code under **充值积分** (Add points) to credit your account. The page shows the operator's instructions for obtaining codes, and **充值与账务帮助** (Top-up and billing help) at the bottom shows how to contact support.

![Redeeming points](../images/screenshots/client-redeem.webp)

**使用记录** (Usage records) lists the status of each image request (settled, refunded, awaiting review, and so on) and every point top-up, point adjustment, image generation, and model charge. Filter by type, model, and date, or export to CSV.

![Usage records](../images/screenshots/client-usage.webp)

Each successful image is charged at the model price, and images the server confirms as failed are refunded. Usage records and CSV keep the unit price of each charge. If the operator has not opened online payment, use the redemption codes they provide.

## 14. Import and export

Product mode hides API keys and provider settings; regular users never enter platform keys.

Click the gear icon at the top right to open settings, where you can adjust habits such as the submit shortcut and how reference edits work. ZIP backup export, import, and local data clearing are under **数据管理** (Data management). Export first fetches original images from the cloud and reports a failure if any are missing. Import checks the version, task references, and image files before saving new tasks and images together. Local tasks with the same ID are kept; an image with the same ID but different content rejects the whole import.

Imported works are not uploaded automatically; import them into your account from **用户中心 → 导入本机旧作品**, and note that importing twice can create duplicates. Clearing local data does not delete cloud works, which reload from the server; content that was never imported or backed up is lost.

## 15. Install as an app

Browsers that support PWAs show **安装为应用** (Install as app) at the top right. On iPhone/iPad, use Safari's **Share → Add to Home Screen**. If the browser does not offer an install event, the UI shows manual steps for the platform.

## 16. Troubleshooting

### "Invalid token" or HTTP 401

Sign out and sign in again. If it persists, the operator may have rotated the token secret or reset your account token.

### Not enough points

The client checks your balance before submitting and opens the redemption page when it is too low. Redeem a valid code, then click **重试** (Retry) on the task.

### Request rejected by the safety system

Remove content that may involve sexual material, violence, illegal acts, infringement, or sensitive identities, then try again. When contacting the operator, include the request ID from the error, but never share passwords, cookies, or full tokens.

### Image upload fails

Try PNG, JPEG, or WebP, or reduce the number or size of images. When using a mask, keep the masked image in the reference list.

### Timeout or unconfirmed result

A timeout, failed download, or local save failure does not mean you were refunded. Check the request status under **用户中心 → 使用记录**; give the request ID of anything marked "待核对" (awaiting review) to the operator. Retrying creates a new paid request.

### A finished image is missing on another device

Make sure you are signed in to the same account and that the original browser finished syncing. Only works saved to the cloud are visible across devices.

### There is no API configuration

This is expected in product mode. The platform manages upstream APIs, and users never handle platform API keys. Developers who need to test APIs directly should use the frontend-only mode in the [development guide](./development.md).

## 17. Data and privacy

In production, the server stores accounts, points, usage records, and synced works; the browser only keeps a cache. Prompts and required images are sent to the Gouo backend and the upstream model service configured by the operator. Operators should publish terms of service, a privacy policy, content rules, retention periods, refund terms, and an infringement-report channel.
