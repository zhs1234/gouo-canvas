# Gouo Canvas user guide

[简体中文](../zh-CN/user-guide.md) · [Documentation index](../README.md)

This guide is for creators using the hosted, account-based product mode. Operators should use the [deployment overview](./deployment/index.md) and [backend integration guide](./backend.md).

The current application interface is Chinese. English instructions therefore include the Chinese label for important controls.

## 1. Register and sign in

1. Open Gouo Canvas and select **立即注册** (Register now).
2. Enter a username and password. Length and verification requirements shown by the UI reflect the active server configuration.
3. Return to the login view and sign in with the new account.
4. Open **用户中心** (User center) in the header to view the account, balance, cloud storage, redemption codes, and usage history.

If the operator enabled email delivery, users can bind an email address and reset a forgotten password by email. If email delivery is disabled, contact the operator for account recovery.

The backend maintains the login with a cookie. Changing `SESSION_SECRET` invalidates existing sessions; changing `USER_TOKEN_SECRET` invalidates existing generation tokens. If the UI reports an invalid token, sign out and sign in again first.

## 2. Create the first image

New users see a three-step introduction, and an empty gallery provides starter prompts.

1. Describe the subject, scene, composition, light, and constraints in the bottom prompt box.
2. Set size, quality, output format, transparency, compression, moderation, and output count as needed.
3. Optionally add reference images or draw a mask on one reference.
4. Check the estimated charge shown near the send control, then submit.
5. When the task finishes, open an image to download, copy, collect, or edit it.

The backend checks and reserves balance when a request starts. It refunds the reservation after a confirmed failure. Treat the price displayed in the UI as authoritative; documentation examples may not match an operator's current price.

## 3. Write an effective prompt

A useful prompt normally identifies:

- **Subject**: who or what appears in the image.
- **Environment**: location and surrounding objects.
- **Medium**: photography, illustration, 3D, poster, infographic, and so on.
- **Composition**: close-up, full body, top-down, wide angle, centered layout, and so on.
- **Lighting and mood**: soft light, backlight, neon, calm, energetic, and so on.
- **Constraints**: no text, no watermark, preserve a pose, retain product geometry, and so on.

Example:

```text
A transparent acrylic music player on a dark metal desk.
Premium product photography, centered composition, soft side light,
blue rim light, minimal background, no text, logo, or watermark.
```

Describe visible results. Specific materials, viewpoints, colors, and whitespace are more actionable than broad requests such as “make it better.”

## 4. Use the inspiration library

Select **灵感** (Inspiration) in the header. Search prompts or browse photography, portrait, product, poster, illustration, space, and knowledge categories.

- Open a card to inspect the complete prompt.
- **立即使用** (Use now) copies it into the home prompt box without sending it.
- The copy button copies text without replacing the current draft.
- Adapt the subject, branding constraints, colors, and composition before use.

## 5. Add and reference images

Use the file picker, drag and drop, or paste to add up to 16 images. The upstream channel can impose stricter count, format, and payload limits.

- Explain each image's role, for example: “Keep the person from image 1 and use the palette from image 2.”
- Type `@` to insert an explicit reference to one of the current images.
- On desktop, drag thumbnails to reorder them. Existing image mentions are updated with the order.
- Use a reference thumbnail's edit action to replace it or add a mask, depending on the general setting.
- Upload only content that you are authorized to process and willing to send to the platform and its upstream provider.

A reference image does not implicitly tell the model what to preserve. Put identity, pose, silhouette, or layout requirements in the prompt.

## 6. Make a masked edit

1. Add the image to edit.
2. Open its edit action and choose **添加遮罩** (Add mask).
3. Paint the region to change. The blue overlay is the editable region.
4. Save the mask and describe the desired replacement in the prompt.
5. Submit the edit.

The UI warns when a mask covers the full image because the provider may redraw everything. A mask identifies an area; it does not replace the written edit instruction.

## 7. Inspect and manage tasks

Task cards and the detail view expose actions according to task state:

- Download one image, all outputs, or retained streaming previews.
- Copy an image or prompt.
- Retry a failed task.
- Reuse task parameters for a new request.
- Edit an output as a new reference image.
- Add a task to one or more collections.
- Delete a local task or move a synchronized task to the recycle bin.

Search matches prompts and parameter text. Status filters include all, complete, running, failed, pending synchronization, synchronization error, and recycle bin. Desktop supports box selection and `Ctrl`/`⌘` selection; mobile provides a selection flow. Configure which batch actions use ZIP under **设置 → 通用** (Settings → General).

## 8. Collections

- A task can belong to multiple collections.
- The collection overview supports search, management, and batch download.
- Deleting a collection does not automatically delete its tasks.
- In account mode, collections and task membership synchronize with the account.

## 9. Cloud synchronization and recycle bin

After sign-in, tasks, outputs, references, masks, thumbnails, and collections synchronize automatically. IndexedDB remains a local cache and retry queue.

- The synchronization banner reports progress, errors, and cloud usage.
- Cached work remains viewable during a network interruption; synchronization resumes later.
- Signing into the same account in another browser restores synchronized work.
- Unsynchronized work may exist only in the original browser. Before clearing site data, confirm synchronization or export a backup.
- Deleting a synchronized task moves it to the recycle bin. It continues to consume storage and can be restored from the recycle-bin filter.
- If the quota is full, a new task may remain local and show a synchronization error.

The recycle bin is currently a recoverable hide operation, not physical asset deletion. Contact the operator about the server-side retention and purge policy when storage must be reclaimed.

## 10. Balance, redemption codes, and usage

The user center shows:

- Current balance and cumulative usage.
- Current per-request image price.
- Cloud storage consumption.
- Redemption-code credit.
- Recent usage with CSV export.

The current backend charges one successful image request even when that request asks for multiple outputs. Operators can change `GOUO_IMAGE_PRICE_CNY`, so the UI price is authoritative. Do not attempt online payment unless the operator has published and tested a payment method; redemption codes or manual credit are the safe fallback.

## 11. Settings, import, and export

Hosted product mode hides provider and API-key configuration. Regular users do not need the platform key. General settings still control submission shortcuts, clearing after submit, draft persistence, reference-image editing behavior, ZIP download routes, retry buttons, and system notifications.

**设置 → 数据** (Settings → Data) exports or imports a ZIP backup and clears selected local data. Even with cloud synchronization enabled, check synchronization state and backup contents before importing or clearing data so that browser-only work is not lost.

## 12. Install the app

Browsers with PWA support expose an install action in the header. On iPhone and iPad, use Safari's Share menu and **Add to Home Screen**. If the browser does not expose an install event, Gouo Canvas displays manual platform instructions.

## 13. Troubleshooting

### Invalid token or HTTP 401

Sign out and sign in again. If it persists, the operator may have changed the token secret or reset the account token.

### Insufficient balance

Open the user center, add credit with a valid redemption code or an operator-enabled method, then retry the task.

### Safety rejection

Remove sexual, violent, illegal, infringing, or sensitive-identity content and try again. Include the error's request ID when reporting the problem, but never publish a password, cookie, or full token.

### Image upload failure

Try PNG, JPEG, or WebP, reduce image count or size, and ensure that a mask's target image still exists in the reference list.

### Timeout

Reduce size, quality, or output count. If failures occur at a consistent elapsed time, the operator should inspect CDN and reverse-proxy timeouts.

### Work is missing on another device

Confirm that both devices use the same account and inspect the original browser's synchronization status. Only synchronized tasks can be restored elsewhere.

### There is no API configuration screen

This is expected in hosted product mode. The platform manages upstream credentials. Developers who need direct API profiles should use the frontend-only mode in the [development guide](./development.md).

## 14. Data and privacy

In product mode, the backend stores account, balance, usage, and synchronized library data. The browser stores caches and pending synchronization data. Generation and editing send prompts and required images to the Gouo backend and the operator-configured upstream model provider. Operators should publish terms, a privacy policy, content rules, retention periods, refund terms, and an infringement-reporting process.
