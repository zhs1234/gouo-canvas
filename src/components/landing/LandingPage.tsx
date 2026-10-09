import type { CSSProperties } from 'react'
import { ArrowRight, Bot, Brush, Cloud, Heart, ImagePlus, Images, Layers, Plus, Shapes, Sparkles } from 'lucide-react'
import { BRAND } from '../../config/brand'
import './landing.css'

const FEATURES = [
  { icon: Sparkles, title: '文生图', desc: '用一句话描述画面，支持尺寸、质量与格式设置。' },
  { icon: ImagePlus, title: '参考图编辑', desc: '上传多张参考图，按描述改风格、换场景、做延展。' },
  { icon: Brush, title: '局部重绘', desc: '用蒙版圈出区域，只修改需要的部分。' },
  { icon: Layers, title: '透明背景', desc: '直接输出带透明通道的素材，省去抠图。' },
  { icon: Shapes, title: '无限画布', desc: '在画布上排布、裁切、连线生成，管理整组创作。' },
  { icon: Bot, title: '创作 Agent', desc: '用对话推进多轮创作，自动整理参考与结果。' },
  { icon: Images, title: '灵感库', desc: '从精选提示词模板出发，快速找到方向。' },
  { icon: Cloud, title: '云端作品库', desc: '作品、收藏、画布与会话在多设备间同步。' },
]

const STATS = [
  { value: '10', unit: '张', title: '单次最多出图', desc: '一次提交最多生成 10 张，方便并排比较、挑出最好的一张。' },
  { value: '24', unit: '小时', title: '原图可找回', desc: '网络中断或页面关闭后，24 小时内可取回已生成的结果，不会重新生成扣费。' },
  { value: '∞', unit: '画布', title: '不限尺寸的创作空间', desc: '把参考、草图与成片放在同一张画布上，随时回到任何一步继续。' },
]

const STEPS = [
  { title: '注册并兑换额度', desc: '创建账户后在用户中心输入兑换码，额度即时到账。' },
  { title: '描述或上传参考', desc: '写下想要的画面，或拖入参考图、圈出要重绘的区域。' },
  { title: '生成、挑选、继续创作', desc: '结果自动保存到作品库，可收藏、再编辑或放上画布。' },
]

const FAQS = [
  { q: '如何计费？', a: '按生成张数计费，提交前会显示所选模型的单价。生成失败的请求会自动退回预扣额度。' },
  { q: '网络断开会重复扣费吗？', a: '不会。每次请求都有唯一编号，连接中断后会读取原请求的结果，24 小时内都能找回，不会重新提交。' },
  { q: '作品保存在哪里？', a: '作品先保存在当前浏览器，开启云端作品库后会同步到账户，换设备登录也能看到。' },
  { q: '如何获取额度？', a: '登录后打开用户中心，输入兑换码即可充值额度。' },
]

// 首页渲染在 HashRouter 之外，不能用 #锚点，否则登录后会被路由当成页面路径。
function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}

export default function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <div className="gouo-public min-h-[100dvh] overflow-x-hidden">
      <section id="top" className="gouo-grainient m-2.5 flex min-h-[calc(100dvh-20px)] flex-col justify-between rounded-[28px] px-5 pb-10 pt-4 text-white sm:px-10 sm:pb-12">
        <nav className="gouo-glass-dark gouo-fade-up mx-auto flex w-full max-w-[1600px] items-center gap-3 rounded-2xl py-2 pl-3 pr-2" style={{ '--delay': '0.1s' } as CSSProperties}>
          <button type="button" onClick={() => scrollToSection('top')} className="flex items-center gap-2.5 font-semibold">
            <img src={BRAND.logoUrl} alt="" className="h-8 w-8 rounded-lg" />
            <span>{BRAND.name}</span>
          </button>
          <div className="ml-6 hidden gap-6 text-sm text-white/80 md:flex">
            <button type="button" onClick={() => scrollToSection('features')} className="hover:text-white">能力</button>
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
            <span className="gouo-line-mask"><span className="gouo-line-text" style={{ '--delay': '0.25s' } as CSSProperties}>把灵感</span></span>
            <span className="gouo-line-mask"><span className="gouo-line-text" style={{ '--delay': '0.4s' } as CSSProperties}>构造成图像</span></span>
          </h1>
          <div className="gouo-fade-up mt-10 grid gap-8 md:grid-cols-[1fr_auto] md:items-end" style={{ '--delay': '0.75s' } as CSSProperties}>
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-white/85">
              {['文生图', '参考图编辑', '局部重绘', '透明背景', '无限画布'].map((label) => (
                <span key={label} className="gouo-glass-dark rounded-[10px] px-3 py-1.5">{label}</span>
              ))}
            </div>
            <div className="max-w-[460px]">
              <p className="text-[17px] leading-[1.7] tracking-[-0.01em] text-white/85">{BRAND.description}。生成、编辑、画布与创作 Agent 集中在一个工作台，按张计费，作品云端同步。</p>
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

      <section id="features" className="bg-[#fbfbf9] px-5 py-24 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-[1280px]">
          <div className="grid gap-6 md:grid-cols-2 md:items-end">
            <h2 className="text-[clamp(2.4rem,5vw,4.2rem)] font-semibold leading-[1] tracking-[-0.05em]">一个工作台，<br />从灵感到成片</h2>
            <p className="max-w-md text-[16px] leading-[1.7] text-[var(--ink-soft)] md:justify-self-end">不用在多个工具之间来回切换。生成、修改、排版与归档都在同一处完成，每一步都能回溯。</p>
          </div>
          <div className="mt-14 grid grid-cols-1 border-l border-t border-[var(--line)] sm:grid-cols-2 lg:grid-cols-4">
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

      <section className="bg-[#f2f3f0] px-5 py-24 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-[1280px]">
          <h2 className="max-w-3xl text-[clamp(2.2rem,4.4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.05em]">为认真创作的人设计的细节</h2>
          <div className="mt-14 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {STATS.map((stat) => (
              <div key={stat.title} className="grid gap-6 py-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-end">
                <div className="flex items-baseline gap-3">
                  <strong className="text-[clamp(5rem,10vw,9rem)] font-semibold leading-[0.82] tracking-[-0.075em] tabular-nums">{stat.value}</strong>
                  <span className="text-[clamp(1.5rem,3vw,2.8rem)] font-semibold text-[#a0a0a3]">{stat.unit}</span>
                </div>
                <div>
                  <h3 className="text-2xl font-semibold tracking-[-0.02em]">{stat.title}</h3>
                  <p className="mt-3 max-w-[500px] text-[15px] leading-[1.65] text-[var(--ink-soft)]">{stat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="bg-[#fbfbf9] px-5 py-24 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-[1280px]">
          <h2 className="text-center text-[clamp(2.2rem,4.4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.05em]">三步开始创作</h2>
          <div className="mt-14 grid gap-12 md:grid-cols-3 md:gap-12">
            {STEPS.map((step, index) => (
              <div key={step.title}>
                <div className="flex h-[200px] items-center justify-center rounded-3xl border border-[var(--line)] bg-[#f5f5f2] p-6">
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
                        <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#ffcfb3] to-[#c26855]" />
                        <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#dcd6ff] to-[#6d3d9d]" />
                        <span className="ml-auto grid h-8 w-8 place-items-center rounded-lg bg-[#171719] text-white"><ArrowRight className="h-4 w-4" /></span>
                      </div>
                    </div>
                  )}
                  {index === 2 && (
                    <div className="grid grid-cols-2 gap-2">
                      {['from-[#ffb38a] to-[#c26855]', 'from-[#9c8cff] to-[#3a2747]', 'from-[#ffd9e6] to-[#ff7a6b]', 'from-[#ffc98e] to-[#f0a476]'].map((tone, i) => (
                        <div key={tone} className={`relative h-[68px] w-[68px] rounded-xl bg-gradient-to-br ${tone}`}>
                          {i === 0 && <Heart className="absolute right-2 top-2 h-4 w-4 fill-white text-white" />}
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

      <section id="faq" className="bg-[#f2f3f0] px-5 py-24 sm:px-10 sm:py-28">
        <div className="mx-auto grid max-w-[1280px] gap-12 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <h2 className="text-[clamp(2.2rem,4.4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.05em]">常见问题</h2>
            <p className="mt-5 max-w-sm text-[15px] leading-[1.7] text-[var(--ink-soft)]">关于计费、额度与作品保存。没找到答案？登录后可在用户中心查看帮助与联系方式。</p>
          </div>
          <div className="border-t border-[var(--line)]">
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

      <section className="bg-[#fbfbf9] px-5 py-24 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-[1280px] overflow-hidden rounded-[40px] border border-[var(--line)] bg-gradient-to-br from-[#f2f2ee] to-[#e7e8e3] p-8 sm:p-[72px]">
          <h2 className="max-w-3xl text-[clamp(2.4rem,5.4vw,4.8rem)] font-semibold leading-[1] tracking-[-0.055em]">现在开始，<br />把下一个想法画出来</h2>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <button type="button" onClick={onRegister} className="inline-flex min-h-12 items-center gap-2 rounded-[14px] bg-[#171719] px-6 text-sm font-bold text-white shadow-[0_14px_30px_rgb(27_24_28/0.16)] transition hover:-translate-y-px hover:bg-black">
              免费注册 <ArrowRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={onLogin} className="min-h-12 rounded-[14px] px-5 text-sm font-bold text-[var(--ink)] underline-offset-4 hover:underline">已有账户？登录</button>
          </div>
        </div>
      </section>

      <footer className="bg-[#f3f3ef] px-5 pb-9 pt-20 sm:px-10">
        <div className="mx-auto grid max-w-[1280px] gap-10 md:grid-cols-[2fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5 font-semibold">
              <img src={BRAND.logoUrl} alt="" className="h-8 w-8 rounded-lg" />
              {BRAND.name} <span className="font-normal text-[#8a8a8d]">{BRAND.nameEn}</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-6 text-[var(--ink-soft)]">{BRAND.slogan}。</p>
          </div>
          <div>
            <h3 className="text-[11px] font-semibold tracking-[0.08em] text-[#8a8a8d]">产品</h3>
            <ul className="mt-4 grid gap-3 text-sm">
              <li><button type="button" onClick={() => scrollToSection('features')} className="text-[#2b2b2e] hover:text-[#8a8a8d]">能力</button></li>
              <li><button type="button" onClick={() => scrollToSection('how')} className="text-[#2b2b2e] hover:text-[#8a8a8d]">使用流程</button></li>
              <li><button type="button" onClick={() => scrollToSection('faq')} className="text-[#2b2b2e] hover:text-[#8a8a8d]">常见问题</button></li>
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
