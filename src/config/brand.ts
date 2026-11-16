export const BRAND = {
  name: '光构',
  nameEn: 'Gouo Canvas',
  team: 'xgouo',
  slogan: '把灵感构造成图像',
  description: '面向创作者的 AI 图片生成与编辑平台',
  // 跟随构建 base。写死 ./ 时，/user/reset 会到 /user/ 下取图标，拿到的是 HTML。
  logoUrl: `${import.meta.env.BASE_URL}gouo-logo-192.png`,
  repositoryUrl: 'https://github.com/zhs1234/gouo-canvas',
  source: {
    name: 'GPT Image Playground',
    author: 'CookSleep',
    repositoryUrl: 'https://github.com/CookSleep/gpt_image_playground',
    licenseUrl: 'https://github.com/CookSleep/gpt_image_playground/blob/main/LICENSE',
  },
} as const
