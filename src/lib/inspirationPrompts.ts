import { INSPIRATION_TEMPLATES } from './inspirationTemplates'

export type InspirationCategory = 'UI 与界面' | '图表与信息可视化' | '海报与排版' | '商品与电商' | '品牌与标志' | '建筑与空间' | '摄影与写实' | '插画与艺术' | '人物与角色' | '场景与叙事' | '历史与古风题材' | '文档与出版物' | '其他应用场景'

export interface InspirationPrompt {
  id: string
  title: string
  category: InspirationCategory
  sourceCategory: string
  description: string
  prompt: string
  tags: string[]
  guidance: string[]
  pitfalls: string[]
  sourceUrl: string
  referenceCount: number
  previewImage: string
  previewSourceLabel: string
  previewSourceUrl: string
  exampleUrl: string
}

export const INSPIRATION_SOURCE = {
  name: 'awesome-gpt-image-2',
  author: 'freestylefly / 苍何',
  url: 'https://github.com/freestylefly/awesome-gpt-image-2',
  revision: '65a9c57a1968a13f2f1997c58409cac9aa146bc7',
}

export const INSPIRATION_PROMPTS = INSPIRATION_TEMPLATES
export const INSPIRATION_CATEGORIES: Array<'全部' | InspirationCategory> = ['全部', ...new Set(INSPIRATION_PROMPTS.map((item) => item.category))]
