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
2. Select a model under **模型**, check its per-request price, and set size, quality, output format, and an output count within that model's limit.
3. Optionally add reference images or draw a mask on one reference.
4. Check the estimated charge shown near the send control, then submit.
5. When the task finishes, open an image to download, copy, collect, or edit it.

The backend checks and reserves balance when a request starts, refunding confirmed failures. Use the model quote shown before submission. Choices are remembered per account; incompatible references or masks block submission. If a price or capability changes, refresh and review the catalog before submitting again. Historical retries retain their original model and require confirmation of a changed price.

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

Search matches prompts and parameter text. Status filters include all, complete, running, failed, and recycle bin. Desktop supports box selection and `Ctrl`/`⌘` selection; mobile provides a selection flow. Configure which batch actions use ZIP under **设置 → 通用** (Settings → General).

## 8. Collections

- A task can belong to multiple collections.
- The collection overview supports search, management, and batch download.
- Deleting a collection does not automatically delete its tasks.
- In account mode, collections and task membership synchronize with the account.

## 9. Cloud library and recycle bin

After sign-in, successful images are saved to the account by the server when they are generated; IndexedDB in the browser is only a cache. Failed tasks are not stored in the cloud. Collections and their memberships are saved with the account as well.

- Signing into the same account in another browser or device shows the saved work.
- Cached work remains viewable during a network interruption.
- Older work from this browser and work imported from a ZIP are not uploaded automatically. Import them with **用户中心 → 导入本机旧作品** (User Center → Import local works); clearing site data before that loses them.
- Deleted work moves to the recycle bin. It can be restored from the gallery filter's recycle bin and still counts toward cloud storage.

Items stay in the recycle bin for 3 days. After that they are permanently deleted together with any images no longer in use, and cannot be recovered.

## 10. Balance, redemption codes, and usage

Operators can fill in redemption instructions and a support website, email, or contact handle under Settings → Operation settings. Both fields default to blank. The user center shows the instructions on the redemption screen and provides copyable support details; a standalone HTTP(S) URL is also clickable. Blank fields are shown as unconfigured and should be filled before public operation.

The gallery shows 60 tasks per page. Search covers the entire library, filters reset pagination, and selections persist across pages for batch downloads. Collection renames and deletions synchronize without reviving deleted collections on stale devices.

The user center shows:

- Current balance and cumulative usage.
- Model-specific billing information and the actual price in individual usage records.
- Cloud storage consumption.
- Redemption-code credit.
- Recent usage with CSV export.

Each successfully generated image is charged at the model price (generating several images splits them into single-image requests), and failed images are refunded once the server confirms the failure. Prices are configured per model by the operator. Usage records and CSV preserve historical prices and actual charged quota; cumulative usage uses the current conversion rate. Online payments require an operator-published and tested payment method; otherwise use redemption codes or manual credit.

## 11. Settings, import, and export

Hosted product mode hides provider and API-key configuration. Regular users do not need the platform key. General settings still control submission shortcuts, clearing after submit, draft persistence, reference-image editing behavior, ZIP download routes, retry buttons, and system notifications.

**设置 → 数据管理** (Settings → Data Management) exports or imports ZIP backups and clears selected local data. Export retrieves cloud originals first and fails explicitly if an original is missing. Import validates the version, task references, and image files before committing new tasks and images together. Existing local task IDs are kept; an image ID with different content rejects the whole batch. In account mode, imported work is not uploaded automatically; import it into the account with **用户中心 → 导入本机旧作品** (User Center → Import local works). Repeated imports may create copies. Configuration backups may contain API keys; keep them private.

Clearing local data does not delete cloud work in the account, which loads again from the cloud. Work not yet imported into the account and not backed up is lost. Deleted cloud work can be restored within 3 days through the gallery filter's recycle bin and continues using cloud storage while there.

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

In product mode, the backend stores account, balance, usage, and synchronized library data. The browser stores caches. Generation and editing send prompts and required images to the Gouo backend and the operator-configured upstream model provider. Operators should publish terms, a privacy policy, content rules, retention periods, refund terms, and an infringement-reporting process.
