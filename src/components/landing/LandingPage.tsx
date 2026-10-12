import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Bot, Brush, ChevronLeft, ChevronRight, Cloud, Heart, ImagePlus, Images, Layers, Lock, Megaphone, Package, Palette, Plus,
  ReceiptText, RotateCcw, Shapes, ShoppingBag, Sparkles, UserRound,
} from 'lucide-react'
import { BRAND } from '../../config/brand'
import { INSPIRATION_TEMPLATES } from '../../lib/inspirationTemplates'
import { AvatarArt, EarbudsArt, FestivalPosterArt, MarbleProductArt, NeonStreetArt, PerfumeArt, PicnicPosterArt, SleepingCatArt } from './artwork'
import './landing.css'

const SCENES = [
  { icon: ShoppingBag, label: '电商主图' },
  { icon: Megaphone, label: '海报' },
  { icon: UserRound, label: '头像' },
  { icon: Package, label: '产品图' },
  { icon: Palette, label: '插画' },
]

const PREVIEW_PROMPTS = [
  { text: '雨后的城市街角，霓虹倒影，电影感广角', Art: NeonStreetArt },
  { text: '白色背景上的香水瓶产品图，柔和侧光，高级质感', Art: PerfumeArt },
  { text: '扁平插画风格的春日野餐海报，留出标题位置', Art: PicnicPosterArt },
]

const FEATURES = [
  { icon: Sparkles, title: '文生图', desc: '用一句话描述画面，支持尺寸、质量与格式设置。' },
  { icon: ImagePlus, title: '参考图编辑', desc: '上传多张参考图，按描述改风格、换场景、做延展。' },
  { icon: Brush, title: '局部重绘', desc: '用蒙版圈出区域，只修改需要的部分。' },
  { icon: Layers, title: '透明背景', desc: '直接输出带透明通道的素材，省去抠图。' },
  { icon: Shapes, title: '无限画布', desc: '在画布上排布、裁切、连线生成，管理整组创作。' },
  { icon: Bot, title: '创作 Agent', desc: '用对话推进多轮创作，自动整理参考与结果。' },
  { icon: Images, title: '灵感库', desc: '从精选提示词模板出发，快速找到方向。' },
  { icon: Cloud, title: '云端作品库', desc: '图片出图即存入账户，画布与会话随时保存，换设备登录就能继续。' },
]

const STATS = [
  { value: '10', unit: '张', title: '单次最多出图', desc: '一次提交最多生成 10 张候选，并排比较，挑出最好的一张。', tone: 'from-[#e3f4ea] via-[#f4f8f1] to-[#fbfbf9]' },
  { value: '24', unit: '小时', title: '原图可找回', desc: '网络中断或页面关闭后，24 小时内可取回已生成的结果，不会重新生成扣费。', tone: 'from-[#ebe4fb] via-[#f5f1fb] to-[#fbfbf9]' },
  { value: '0', unit: '元', title: '失败不扣费', desc: '明确失败的生成会自动退回预扣额度，只为成功出图付费。', tone: 'from-[#fde4d3] via-[#fcf1e8] to-[#fbfbf9]' },
  { value: '∞', unit: '画布', title: '不限尺寸的创作空间', desc: '把参考、草图与成片放在同一张画布上，随时回到任何一步继续。', tone: 'from-[#dcedf7] via-[#eef5f8] to-[#fbfbf9]' },
]

const USE_CASES = [
  { label: '电商主图', icon: ShoppingBag, prompt: '白底主图，45° 拍摄的无线耳机，柔和反光，商业摄影质感', chips: ['1:1', '高清', '透明背景'], note: '开启透明背景，直接得到可上架的抠图素材。', Art: EarbudsArt, transparent: true },
  { label: '海报设计', icon: Megaphone, prompt: '复古印刷风格的音乐节海报，顶部留出标题区域，暖色调', chips: ['2:3', '4 张候选'], note: '一次出多张候选，挑中一张再局部重绘细节。', Art: FestivalPosterArt, transparent: false },
  { label: '头像插画', icon: UserRound, prompt: '参考上传的照片，生成手绘动画风格的半身头像，柔和光线', chips: ['参考图编辑', '1:1'], note: '把照片作为参考图，保留人物特征，换成插画风格。', Art: AvatarArt, transparent: false },
  { label: '产品精修', icon: Package, prompt: '把背景换成大理石台面，产品本身保持不变', chips: ['局部重绘', '蒙版'], note: '用蒙版圈出背景，只改动需要修改的区域。', Art: MarbleProductArt, transparent: false },
]

// 灵感库示例图；含真人名人肖像的示例不放在首页
const byImage = (name: string) => INSPIRATION_TEMPLATES.filter((item) => item.previewImage === `inspiration/${name}.webp`)
const GALLERY = ['case355', 'case346', 'case373', 'case377', 'case362', 'case331', 'case375', 'case370'].flatMap(byImage)

// 首屏右侧漂浮的作品卡片；位置按视口比例，避开左下标题和右下介绍
const HERO_CARDS = [
  { name: 'case362', pos: 'right-[36%] top-[13%] w-[11.5vw]', rotate: '4deg', aspect: 'aspect-[4/5]' },
  { name: 'case355', pos: 'right-[20%] top-[17%] w-[13.5vw]', rotate: '-6deg', aspect: 'aspect-[4/5]', label: true },
  { name: 'case346', pos: 'right-[4%] top-[12%] w-[14vw]', rotate: '5deg', aspect: 'aspect-[4/5]' },
  { name: 'case373', pos: 'right-[25%] top-[52%] w-[15vw]', rotate: '3deg', aspect: 'aspect-[3/2]' },
  { name: 'case377', pos: 'right-[7%] top-[45%] w-[11vw]', rotate: '-4deg', aspect: 'aspect-[4/5]' },
].flatMap((card) => byImage(card.name).map((item) => ({ ...card, item })))

const STEPS = [
  { title: '注册并兑换额度', desc: '创建账户后在用户中心输入兑换码，额度即时到账。' },
  { title: '描述或上传参考', desc: '写下想要的画面，或拖入参考图、圈出要重绘的区域。' },
  { title: '生成、挑选、继续创作', desc: '结果自动保存到作品库，可收藏、再编辑或放上画布。' },
]

const TRUST = [
  { icon: Lock, title: '作品只属于你', desc: '作品、画布与会话保存在你的账户下，只有本人登录可见。删除的作品先进入回收站，可以随时恢复。' },
  { icon: RotateCcw, title: '不会重复扣费', desc: '每次生成都有唯一的请求编号。网络中断后读取原结果，24 小时内都能找回，不会重新提交。' },
  { icon: ReceiptText, title: '价格提前确认', desc: '提交前显示所选模型的单价，失败的请求自动退回额度，每一笔消费都能在用户中心查到。' },
]

const FAQS = [
  { q: '如何计费？', a: '按生成张数计费，提交前会显示所选模型的单价。生成失败的请求会自动退回预扣额度。' },
  { q: '网络断开会重复扣费吗？', a: '不会。每次请求都有唯一编号，连接中断后会读取原请求的结果，24 小时内都能找回，不会重新提交。' },
  { q: '作品保存在哪里？换设备还在吗？', a: '生成的图片在出图时由服务端直接保存到你的账户，画布和会话也会保存到服务端。关闭页面或更换设备后，登录即可看到全部作品。' },
  { q: '如何获取额度？', a: '登录后打开用户中心，输入兑换码即可充值额度。' },
  { q: '可以用自己的照片做参考吗？', a: '可以。上传一张或多张参考图，按描述改风格、换背景或做延展；也可以用蒙版只重绘指定区域。' },
]

// 首页渲染在 HashRouter 之外，不能用 #锚点，否则登录后会被路由当成页面路径。
function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

// 鼠标位置驱动高光与轻微倾斜，离开时复位。
function trackSpotlight(event: PointerEvent<HTMLElement>, tilt: number) {
  if (event.pointerType !== 'mouse') return
  const el = event.currentTarget
  const rect = el.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width
  const y = (event.clientY - rect.top) / rect.height
  el.style.setProperty('--spot-x', `${x * 100}%`)
  el.style.setProperty('--spot-y', `${y * 100}%`)
  el.style.setProperty('--spot-opacity', '1')
  el.style.setProperty('--tilt-x', `${(0.5 - y) * tilt}deg`)
  el.style.setProperty('--tilt-y', `${(x - 0.5) * tilt}deg`)
}

function resetSpotlight(event: PointerEvent<HTMLElement>) {
  for (const name of ['--spot-opacity', '--tilt-x', '--tilt-y']) event.currentTarget.style.removeProperty(name)
}

const delay = (value: string) => ({ '--delay': value } as CSSProperties)

function ProductPreview() {
  const [index, setIndex] = useState(0)
  const [typed, setTyped] = useState(0)
  const prompt = PREVIEW_PROMPTS[index]

  useEffect(() => {
    if (typed < prompt.text.length) {
      const timer = setTimeout(() => setTyped((value) => value + 1), 70)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      setIndex((value) => (value + 1) % PREVIEW_PROMPTS.length)
      setTyped(0)
    }, 4200)
    return () => clearTimeout(timer)
  }, [typed, prompt.text.length])

  const done = typed >= prompt.text.length
  return (
    <div className="overflow-hidden rounded-[32px] border border-[var(--line)] bg-white/70 shadow-[0_40px_100px_rgb(66_49_37/0.12)]" aria-hidden="true">
      <div className="flex items-center gap-1.5 border-b border-[var(--line)] px-5 py-3.5">
        {['#ff5f57', '#febc2e', '#28c840'].map((color) => <span key={color} className="h-3 w-3 rounded-full" style={{ background: color }} />)}
        <span className="ml-4 text-xs text-[#8a8a8d]">{BRAND.name} · 创作</span>
      </div>
      <div className="grid md:grid-cols-[200px_1fr]">
        <div className="hidden border-r border-[var(--line)] p-4 md:block">
          {[{ icon: Sparkles, label: '创作', active: true }, { icon: Images, label: '我的作品' }, { icon: Heart, label: '收藏' }, { icon: Palette, label: '灵感库' }].map((item) => (
            <div key={item.label} className={`mb-1 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${item.active ? 'bg-[#171719] text-white' : 'text-[var(--ink-soft)]'}`}>
              <item.icon className="h-4 w-4" />{item.label}
            </div>
          ))}
        </div>
        <div className="p-5 sm:p-7">
          <div className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm">
            <p className={`min-h-[3rem] text-[15px] leading-6 ${done ? '' : 'gouo-caret'}`}>{prompt.text.slice(0, typed)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]">
              {['1024 × 1536', '高清', '4 张'].map((chip) => <span key={chip} className="rounded-lg border border-[var(--line)] px-2.5 py-1">{chip}</span>)}
              <span className={`ml-auto inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white transition ${done ? 'bg-[#171719]' : 'bg-[#a0a0a3]'}`}>
                {done ? '生成中…' : '生成'} <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
          <div key={index} className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="gouo-develop relative aspect-[4/5] overflow-hidden rounded-2xl shadow-[0_10px_30px_rgb(40_30_20/0.12)]" style={delay(`${0.9 + i * 0.35}s`)}>
                <prompt.Art variant={i} />
                {i === 1 && <Heart className="absolute right-2.5 top-2.5 h-4 w-4 fill-white text-white drop-shadow" />}
              </div>
            ))}
          </div>
          <p className="mt-4 text-right text-xs text-[#8a8a8d]">生成完成，共 4 张 · 已保存到账户</p>
        </div>
      </div>
    </div>
  )
}

// 能力围绕工作台排成一圈，连线表示都从同一个入口进入
function WorkflowHub() {
  const nodes = FEATURES.map((item, i) => {
    const angle = (i / FEATURES.length) * Math.PI * 2 - Math.PI / 2
    return { ...item, x: 50 + Math.cos(angle) * 38, y: 50 + Math.sin(angle) * 38 }
  })
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[460px]" aria-hidden="true">
      <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,rgb(255_179_138/0.35),transparent_70%)] blur-2xl" />
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <circle cx="50" cy="50" r="38" fill="none" stroke="rgb(23 23 25 / 0.08)" strokeWidth="0.25" />
        {nodes.map((node) => <line key={node.title} className="gouo-hub-line" x1="50" y1="50" x2={node.x} y2={node.y} stroke="#c26855" strokeOpacity="0.45" strokeWidth="0.3" strokeDasharray="1.2 1.4" />)}
      </svg>
      <div className="absolute left-1/2 top-1/2 grid h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[28%] border border-white bg-white/90 shadow-[0_20px_50px_rgb(194_104_85/0.25)]">
        <img src={BRAND.logoUrl} alt="" className="h-1/2 w-1/2 rounded-xl" />
      </div>
      {nodes.map((node, i) => (
        <div key={node.title} className="gouo-hub-node absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5" style={{ left: `${node.x}%`, top: `${node.y}%`, ...delay(`${i * 0.4}s`) }}>
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white bg-white/90 shadow-[0_10px_24px_rgb(66_49_37/0.12)] sm:h-12 sm:w-12">
            <node.icon className="h-5 w-5 text-[#c26855]" strokeWidth={1.7} />
          </span>
          <span className="whitespace-nowrap text-[11px] font-semibold text-[var(--ink-soft)]">{node.title}</span>
        </div>
      ))}
    </div>
  )
}

function InspirationGallery({ onRegister }: { onRegister: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const scroll = (dir: number) => trackRef.current?.scrollBy({ left: dir * trackRef.current.clientWidth * 0.8, behavior: 'smooth' })
  const current = Math.round(progress * (GALLERY.length - 1)) + 1
  return (
    <>
      <div className="gouo-reveal grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <h2 className="text-[clamp(2.2rem,4.4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.05em]">从灵感库出发</h2>
          <p className="mt-4 max-w-xl text-[16px] leading-[1.7] text-[var(--ink-soft)]">海报、商品、摄影、插画到产品拆解，精选提示词模板都附示例图。登录后在灵感库一键套用，改几个词就能出图。</p>
        </div>
        <div className="flex gap-2">
          <button type="button" aria-label="上一组" onClick={() => scroll(-1)} className="grid h-11 w-11 place-items-center rounded-full border border-[var(--line)] bg-white transition hover:shadow-md"><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" aria-label="下一组" onClick={() => scroll(1)} className="grid h-11 w-11 place-items-center rounded-full border border-[var(--line)] bg-white transition hover:shadow-md"><ChevronRight className="h-5 w-5" /></button>
        </div>
      </div>
      <div
        ref={trackRef}
        onScroll={(event) => {
          const el = event.currentTarget
          setProgress(el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth))
        }}
        className="gouo-reveal -mx-4 mt-8 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-10 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={delay('0.1s')}
      >
        {GALLERY.map((item) => (
          <figure key={item.id} className="group relative aspect-[4/5] w-[78%] shrink-0 snap-start overflow-hidden rounded-[24px] bg-[#e7e5df] shadow-[0_10px_24px_rgb(40_30_20/0.12)] sm:w-[320px]">
            <img src={`${import.meta.env.BASE_URL}${item.previewImage}`} alt={`${item.title}示例`} loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />
            <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
            <figcaption className="gouo-glass-dark absolute inset-x-3 bottom-3 rounded-2xl px-4 py-3.5 text-white">
              <span className="text-[11px] text-white/70">{item.category}</span>
              <strong className="mt-0.5 block text-lg font-semibold tracking-[-0.02em]">{item.title}</strong>
              <span className="mt-1 block truncate text-[10px] text-white/55">示例图来源：{item.previewSourceLabel}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="flex items-center gap-5">
        <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
          <div className="h-full rounded-full bg-[#171719] transition-[width] duration-300" style={{ width: `${(current / GALLERY.length) * 100}%` }} />
        </div>
        <span className="text-xs tabular-nums text-[#8a8a8d]">{String(current).padStart(2, '0')} / {String(GALLERY.length).padStart(2, '0')}</span>
        <button type="button" onClick={onRegister} className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline">浏览全部模板 <ArrowRight className="h-4 w-4" /></button>
      </div>
    </>
  )
}

function UseCases() {
  const [active, setActive] = useState(0)
  const item = USE_CASES[active]
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="grid content-start gap-2" role="tablist" aria-label="使用场景">
        {USE_CASES.map((entry, index) => (
          <button
            key={entry.label}
            type="button"
            role="tab"
            aria-selected={index === active}
            onClick={() => setActive(index)}
            className={`flex items-center gap-3 rounded-2xl border px-5 py-4 text-left transition ${index === active ? 'border-[#171719] bg-[#171719] text-white' : 'border-[var(--line)] bg-white/50 hover:bg-white'}`}
          >
            <entry.icon className="h-5 w-5 shrink-0" strokeWidth={1.7} />
            <span className="text-[15px] font-semibold">{entry.label}</span>
            <ArrowRight className={`ml-auto h-4 w-4 transition ${index === active ? 'opacity-100' : 'opacity-0'}`} />
          </button>
        ))}
      </div>
      <div key={active} role="tabpanel" className="gouo-fade-up grid gap-5 rounded-[28px] border border-[var(--line)] bg-white/70 p-6 sm:grid-cols-[minmax(0,1fr)_200px] sm:p-8" style={delay('0s')}>
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold tracking-[0.08em] text-[#8a8a8d]">提示词</span>
          <p className="mt-3 text-xl font-semibold leading-snug tracking-[-0.02em]">“{item.prompt}”</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {item.chips.map((chip) => <span key={chip} className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-xs text-[var(--ink-soft)]">{chip}</span>)}
          </div>
          <p className="mt-auto pt-8 text-[15px] leading-[1.65] text-[var(--ink-soft)]">{item.note}</p>
        </div>
        <div
          className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-[0_16px_40px_rgb(40_30_20/0.12)] sm:aspect-auto sm:min-h-[250px]"
          style={item.transparent ? { backgroundImage: 'conic-gradient(#e8e8ec 25%, #fff 0 50%, #e8e8ec 0 75%, #fff 0)', backgroundSize: '18px 18px' } : undefined}
        >
          <item.Art />
        </div>
      </div>
    </div>
  )
}

export default function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    root.classList.add('gouo-reveal-ready')
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    }, { rootMargin: '0px 0px -10% 0px' })
    root.querySelectorAll('.gouo-reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="gouo-public min-h-[100dvh] overflow-x-hidden">
      <section id="top" className="gouo-grainient m-2.5 flex min-h-[calc(100dvh-20px)] flex-col justify-between rounded-[28px] px-5 pb-10 pt-4 text-white sm:px-10 sm:pb-12">
        <div className="gouo-liquid" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</div>
        <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
          {HERO_CARDS.map((card, i) => (
            <div key={card.name} className={`gouo-fade-up absolute max-w-[240px] ${card.pos}`} style={{ rotate: card.rotate, ...delay(`${0.5 + i * 0.12}s`) }}>
              <div className="gouo-float relative overflow-hidden rounded-[20px] border-[5px] border-white/75 shadow-[0_30px_70px_rgb(90_40_25/0.3)]" style={delay(`${-i * 1.3}s`)}>
                <img src={`${import.meta.env.BASE_URL}${card.item.previewImage}`} alt="" className={`block w-full object-cover ${card.aspect}`} />
                {card.label && <span className="gouo-glass-dark absolute inset-x-2 bottom-2 rounded-xl px-3 py-2 text-[11px] font-semibold text-white">灵感库 · {card.item.title}</span>}
              </div>
            </div>
          ))}
        </div>
        <nav className="gouo-glass-dark gouo-fade-up mx-auto flex w-full max-w-[1600px] items-center gap-3 rounded-2xl py-2 pl-3 pr-2" style={delay('0.1s')}>
          <button type="button" onClick={() => scrollToSection('top')} className="flex items-center gap-2.5 font-semibold">
            <img src={BRAND.logoUrl} alt="" className="h-8 w-8 rounded-lg" />
            <span>{BRAND.name}</span>
          </button>
          <div className="ml-6 hidden gap-6 text-sm text-white/80 md:flex">
            <button type="button" onClick={() => scrollToSection('preview')} className="hover:text-white">产品</button>
            <button type="button" onClick={() => scrollToSection('features')} className="hover:text-white">能力</button>
            <button type="button" onClick={() => scrollToSection('gallery')} className="hover:text-white">灵感</button>
            <button type="button" onClick={() => scrollToSection('how')} className="hover:text-white">使用流程</button>
            <button type="button" onClick={() => scrollToSection('faq')} className="hover:text-white">常见问题</button>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={onLogin} className="rounded-xl px-3.5 py-2 text-[13px] font-semibold text-white/90 transition hover:bg-white/15">登录</button>
            <button type="button" onClick={onRegister} className="rounded-xl bg-white px-4 py-2 text-[13px] font-bold text-[#171719] transition hover:-translate-y-px hover:shadow-lg">免费注册</button>
          </div>
        </nav>

        <div className="mx-auto w-full max-w-[1600px]">
          <h1 className="text-[clamp(3.4rem,9vw,8.4rem)] font-semibold leading-[0.94] tracking-[-0.06em]">
            <span className="gouo-line-mask"><span className="gouo-line-text" style={delay('0.25s')}>把灵感</span></span>
            <span className="gouo-line-mask"><span className="gouo-line-text" style={delay('0.4s')}>构造成图像</span></span>
          </h1>
          <div className="gouo-fade-up mt-10 grid gap-8 md:grid-cols-[1fr_auto] md:items-end" style={delay('0.75s')}>
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-white/85 [text-shadow:0_2px_12px_rgb(24_14_28/0.16)]">
              <span>适用于：</span>
              {SCENES.map((scene) => (
                <span key={scene.label} title={scene.label} className="gouo-glass-dark grid h-9 w-9 place-items-center rounded-[10px]">
                  <scene.icon className="h-4 w-4" strokeWidth={1.8} />
                </span>
              ))}
              <span>以及更多创作场景</span>
            </div>
            <div className="max-w-[460px]">
              <p className="text-[17px] leading-[1.7] tracking-[-0.01em] text-white/85">{BRAND.description}。生成、编辑、画布与创作 Agent 集中在一个工作台，按张计费，出图即存入账户。</p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <button type="button" onClick={onRegister} className="inline-flex min-h-11 items-center gap-2 rounded-[14px] bg-white px-5 text-[13px] font-bold text-[#171719] transition hover:-translate-y-px hover:shadow-xl">
                  开始创作 <ArrowRight className="h-4 w-4" />
                </button>
                <button type="button" onClick={onLogin} className="gouo-glass-dark inline-flex min-h-11 items-center rounded-[14px] px-5 text-[13px] font-bold text-white transition hover:bg-white/25">
                  已有账户，登录
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="preview" className="bg-[#fbfbf9] px-5 py-24 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-[1280px]">
          <div className="gouo-reveal grid gap-6 md:grid-cols-2 md:items-end">
            <h2 className="text-[clamp(2.4rem,5vw,4.2rem)] font-semibold leading-[1] tracking-[-0.05em]">一句话，<br />多张候选</h2>
            <p className="max-w-md text-[16px] leading-[1.7] text-[var(--ink-soft)] md:justify-self-end">写下想要的画面，同时生成多张候选并排比较。挑中的那张，可以直接局部重绘、换背景，或放上画布继续。</p>
          </div>
          <div className="gouo-reveal mt-14" style={delay('0.1s')}>
            <ProductPreview />
          </div>
        </div>
      </section>

      <section id="features" className="bg-[#fbfbf9] px-5 pb-24 sm:px-10 sm:pb-28">
        <div className="mx-auto max-w-[1280px]">
          <div className="gouo-reveal grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-[clamp(2.4rem,5vw,4.2rem)] font-semibold leading-[1] tracking-[-0.05em]">一个工作台，<br />从灵感到成片</h2>
              <p className="mt-6 max-w-md text-[16px] leading-[1.7] text-[var(--ink-soft)]">不用在多个工具之间来回切换。生成、修改、排版与归档都在同一处完成，每一步都能回溯。</p>
            </div>
            <WorkflowHub />
          </div>
          <div className="gouo-reveal mt-14 grid grid-cols-1 border-l border-t border-[var(--line)] sm:grid-cols-2 lg:grid-cols-4" style={delay('0.1s')}>
            {FEATURES.map((item) => (
              <div key={item.title} className="group border-b border-r border-[var(--line)] bg-white/40 p-7 transition hover:bg-white">
                <item.icon className="h-6 w-6 text-[#c26855] transition group-hover:-translate-y-0.5" strokeWidth={1.6} />
                <h3 className="mt-10 text-lg font-semibold tracking-[-0.02em]">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#f2f3f0] px-5 py-24 sm:px-10 sm:py-28">
        <div className="gouo-rings pointer-events-none absolute inset-0 opacity-60">
          {[86, 72, 58, 44].map((size, i) => <i key={size} style={{ width: `${size}%`, right: `${-18 + i * 10}%`, bottom: `${-76 + i * 10}%` }} />)}
        </div>
        <div className="relative mx-auto max-w-[1280px]">
          <h2 className="gouo-reveal max-w-3xl text-[clamp(2.2rem,4.4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.05em]">为认真创作的人设计的细节</h2>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((stat, index) => (
              <div key={stat.title} className={`gouo-reveal grid min-h-[340px] content-between gap-10 rounded-[28px] border border-white/80 bg-gradient-to-b ${stat.tone} p-7 shadow-[0_20px_50px_rgb(66_49_37/0.07)]`} style={delay(`${index * 0.08}s`)}>
                <div className="flex items-baseline gap-2">
                  <strong className="text-[clamp(4rem,6vw,5.6rem)] font-semibold leading-[0.82] tracking-[-0.075em] tabular-nums">{stat.value}</strong>
                  <span className="text-[clamp(1.2rem,1.8vw,1.8rem)] font-semibold text-[#a0a0a3]">{stat.unit}</span>
                </div>
                <div>
                  <h3 className="text-xl font-semibold tracking-[-0.02em]">{stat.title}</h3>
                  <p className="mt-2.5 text-sm leading-[1.65] text-[var(--ink-soft)]">{stat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#fbfbf9] px-5 py-24 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-[1280px]">
          <div className="gouo-reveal grid gap-6 md:grid-cols-2 md:items-end">
            <h2 className="text-[clamp(2.2rem,4.4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.05em]">主要用在哪里？</h2>
            <p className="max-w-md text-[16px] leading-[1.7] text-[var(--ink-soft)] md:justify-self-end">从商品图到海报、头像和产品精修，选一个场景，看看一句提示词能做什么。</p>
          </div>
          <div className="gouo-reveal mt-14" style={delay('0.1s')}>
            <UseCases />
          </div>
        </div>
      </section>

      <section id="gallery" className="bg-[#fbfbf9] px-5 pb-24 sm:px-10 sm:pb-28">
        <div className="mx-auto max-w-[1280px]">
          <InspirationGallery onRegister={onRegister} />
        </div>
      </section>

      <section id="how" className="bg-[#f2f3f0] px-5 py-24 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-[1280px]">
          <div className="gouo-reveal text-center">
            <h2 className="text-[clamp(2.2rem,4.4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.05em]">三步开始创作</h2>
            <p className="mx-auto mt-4 max-w-md text-[16px] leading-[1.7] text-[var(--ink-soft)]">从注册到第一张图，只需要几分钟。</p>
          </div>
          <div className="mt-14 grid gap-12 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title} className="gouo-reveal" style={delay(`${index * 0.12}s`)}>
                <div className="flex h-[200px] items-center justify-center rounded-3xl border border-[var(--line)] bg-[#f8f8f5] p-6">
                  {index === 0 && (
                    <div className="w-full max-w-[240px] rounded-2xl border border-[var(--line)] bg-white p-4 text-left shadow-sm">
                      <div className="text-[11px] font-semibold text-[var(--ink-soft)]">兑换码</div>
                      <div className="mt-2 rounded-xl border border-[var(--line)] px-3 py-2.5 font-mono text-sm tracking-[0.2em]">GOUO-••••-••••</div>
                      <div className="mt-3 rounded-xl bg-[#171719] py-2 text-center text-xs font-bold text-white">兑换额度</div>
                    </div>
                  )}
                  {index === 1 && (
                    <div className="w-full max-w-[260px] rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm">
                      <p className="text-sm leading-6">一只在晨雾里打盹的橘猫，胶片质感，柔和逆光</p>
                      <div className="mt-3 flex items-center gap-2">
                        <span className="h-8 w-8 overflow-hidden rounded-lg"><SleepingCatArt variant={0} /></span>
                        <span className="h-8 w-8 overflow-hidden rounded-lg"><SleepingCatArt variant={1} /></span>
                        <span className="ml-auto grid h-8 w-8 place-items-center rounded-lg bg-[#171719] text-white"><ArrowRight className="h-4 w-4" /></span>
                      </div>
                    </div>
                  )}
                  {index === 2 && (
                    <div className="grid grid-cols-2 gap-2">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="relative h-[72px] w-[72px] overflow-hidden rounded-xl shadow-sm">
                          <SleepingCatArt variant={i} />
                          {i === 0 && <Heart className="absolute right-1.5 top-1.5 h-4 w-4 fill-white text-white drop-shadow" />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative mt-7 flex h-11 items-center">
                  {index < STEPS.length - 1 && <span className="absolute left-0 right-[-48px] top-1/2 hidden h-px bg-[var(--line)] md:block" />}
                  <span className="relative z-10 grid h-11 w-11 place-items-center rounded-full bg-[#171719] text-sm font-semibold text-white">{index + 1}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-[1.65] text-[var(--ink-soft)]">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#f0f1ee] px-5 pb-24 sm:px-10 sm:pb-28">
        <div className="mx-auto max-w-[1280px] border-t border-[var(--line)] pt-24 sm:pt-28">
          <div className="gouo-reveal grid gap-6 md:grid-cols-2 md:items-end">
            <h2 className="text-[clamp(2.2rem,4.4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.05em]">放心创作，<br />每一张都算数</h2>
            <p className="max-w-md text-[16px] leading-[1.7] text-[var(--ink-soft)] md:justify-self-end">从提交到保存，每一步都为不丢图、不多扣费而设计。</p>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {TRUST.map((item, index) => (
              <div
                key={item.title}
                onPointerMove={(event) => trackSpotlight(event, 6)}
                onPointerLeave={resetSpotlight}
                className={`gouo-reveal gouo-spotlight flex min-h-[320px] flex-col justify-between rounded-[28px] p-8 hover:shadow-[0_24px_60px_rgb(66_49_37/0.12)] ${index === TRUST.length - 1 ? 'bg-[#1d1d20] text-white' : 'border border-white/80 bg-gradient-to-br from-white/80 to-[#e7e8e3]'}`}
                style={delay(`${index * 0.1}s`)}
              >
                <span className={`grid h-12 w-12 place-items-center rounded-2xl ${index === TRUST.length - 1 ? 'bg-white/10' : 'bg-white/80'}`}><item.icon className="h-5 w-5" strokeWidth={1.7} /></span>
                <div>
                  <h3 className="text-2xl font-semibold tracking-[-0.02em]">{item.title}</h3>
                  <p className={`mt-3 text-[15px] leading-[1.65] ${index === TRUST.length - 1 ? 'text-white/65' : 'text-[var(--ink-soft)]'}`}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="bg-[#fbfbf9] px-5 py-24 sm:px-10 sm:py-28">
        <div className="mx-auto grid max-w-[1280px] gap-12 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="gouo-reveal">
            <h2 className="text-[clamp(2.2rem,4.4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.05em]">开始之前，<br />你可能还想知道</h2>
            <p className="mt-5 max-w-sm text-[15px] leading-[1.7] text-[var(--ink-soft)]">计费、额度、作品保存与参考图使用，都在这里。没找到答案？登录后可在用户中心查看帮助与联系方式。</p>
          </div>
          <div className="gouo-reveal border-t border-[var(--line)]" style={delay('0.1s')}>
            {FAQS.map((item, index) => (
              <details key={item.q} className="gouo-faq border-b border-[var(--line)]">
                <summary className="grid cursor-pointer grid-cols-[42px_1fr_32px] items-start gap-4 py-6">
                  <span className="pt-1 text-xs text-[#a0a0a3]">{String(index + 1).padStart(2, '0')}</span>
                  <strong className="text-[17px] font-semibold leading-snug">{item.q}</strong>
                  <Plus className="gouo-faq-icon h-5 w-5 transition-transform duration-300" />
                </summary>
                <p className="pb-6 pl-[58px] pr-10 text-[15px] leading-[1.7] text-[var(--ink-soft)]">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#fbfbf9] px-5 pb-24 sm:px-10 sm:pb-28">
        <div
          onPointerMove={(event) => trackSpotlight(event, 3)}
          onPointerLeave={resetSpotlight}
          className="gouo-reveal gouo-spotlight gouo-grainient-light mx-auto max-w-[1280px] rounded-[40px] border border-white/70 p-8 sm:p-[72px]"
        >
          <span className="gouo-dots" />
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(310px,0.72fr)] lg:items-end">
            <h2 className="text-[clamp(3rem,6.5vw,6.5rem)] font-semibold leading-[0.94] tracking-[-0.06em]">
              <span className="block whitespace-nowrap">从一句话</span>
              <span className="block whitespace-nowrap">开始。</span>
            </h2>
            <div className="max-w-[460px] pb-1.5">
              <p className="text-[17px] leading-[1.65] text-[var(--ink-soft)]">注册账户，兑换额度，写下第一句提示词。作品出图即保存，随时回来继续。</p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button type="button" onClick={onRegister} className="inline-flex min-h-12 items-center gap-2 rounded-[14px] bg-[#171719] px-6 text-sm font-bold text-white shadow-[0_14px_30px_rgb(27_24_28/0.16)] transition hover:-translate-y-px hover:bg-black">
                  免费注册 <ArrowRight className="h-4 w-4" />
                </button>
                <button type="button" onClick={onLogin} className="min-h-12 rounded-[14px] px-4 text-sm font-bold text-[var(--ink)] underline-offset-4 hover:underline">已有账户？登录</button>
              </div>
            </div>
          </div>
          <div className="mt-14 grid gap-4 border-t border-[var(--line)] pt-8 sm:grid-cols-3 sm:gap-0">
            {[['按张计费', '提交前确认价格'], ['出图即保存', '换设备也能找到'], ['一个工作台', '生成、编辑、画布、Agent']].map(([title, desc], index) => (
              <div key={title} className={`grid gap-1 ${index ? 'sm:border-l sm:border-[var(--line)] sm:pl-6' : ''}`}>
                <strong className="text-[15px] font-semibold tracking-[-0.02em]">{title}</strong>
                <span className="text-xs text-[var(--ink-soft)]">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-[#f3f3ef] px-5 pb-9 pt-20 sm:px-10">
        <div className="mx-auto grid max-w-[1280px] gap-10 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5 font-semibold">
              <img src={BRAND.logoUrl} alt="" className="h-8 w-8 rounded-lg" />
              {BRAND.name} <span className="font-normal text-[#8a8a8d]">{BRAND.nameEn}</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-6 text-[var(--ink-soft)]">{BRAND.slogan}。{BRAND.description}。</p>
          </div>
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.08em] text-[#8a8a8d]">产品</h3>
            <ul className="mt-4 grid gap-3 text-sm">
              <li><button type="button" onClick={() => scrollToSection('preview')} className="text-[#2b2b2e] hover:text-[#8a8a8d]">产品预览</button></li>
              <li><button type="button" onClick={() => scrollToSection('features')} className="text-[#2b2b2e] hover:text-[#8a8a8d]">能力</button></li>
              <li><button type="button" onClick={() => scrollToSection('how')} className="text-[#2b2b2e] hover:text-[#8a8a8d]">使用流程</button></li>
              <li><button type="button" onClick={() => scrollToSection('faq')} className="text-[#2b2b2e] hover:text-[#8a8a8d]">常见问题</button></li>
            </ul>
          </div>
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.08em] text-[#8a8a8d]">账户</h3>
            <ul className="mt-4 grid gap-3 text-sm">
              <li><button type="button" onClick={onLogin} className="text-[#2b2b2e] hover:text-[#8a8a8d]">登录</button></li>
              <li><button type="button" onClick={onRegister} className="text-[#2b2b2e] hover:text-[#8a8a8d]">免费注册</button></li>
            </ul>
          </div>
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.08em] text-[#8a8a8d]">关于</h3>
            <ul className="mt-4 grid gap-3 text-sm">
              <li><a href={BRAND.repositoryUrl} target="_blank" rel="noreferrer" className="text-[#2b2b2e] hover:text-[#8a8a8d]">源代码</a></li>
              <li><a href={BRAND.source.repositoryUrl} target="_blank" rel="noreferrer" className="text-[#2b2b2e] hover:text-[#8a8a8d]">基于 {BRAND.source.name}</a></li>
              <li><a href="./third-party-notices.txt" target="_blank" rel="noreferrer" className="text-[#2b2b2e] hover:text-[#8a8a8d]">第三方声明</a></li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-16 flex max-w-[1280px] flex-wrap justify-between gap-3 border-t border-[var(--line)] pt-6 text-xs text-[#8a8a8d]">
          <span>© {new Date().getFullYear()} {BRAND.name}</span>
          <span>Built by {BRAND.team}</span>
        </div>
      </footer>
    </div>
  )
}
