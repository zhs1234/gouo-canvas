import { useId } from 'react'

// 首页插图全部用 SVG 绘制：灵感库图片的商用授权未核实，不能放在营销页面
// 每个插图的 id 用 useId 前缀，同一页面多次渲染时渐变和滤镜不会串用

// 固定种子的伪随机数，保证每次渲染的楼宇、雨丝位置一致
function rng(seed: number) {
  let s = seed % 2147483647 || 1
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const svgProps = { viewBox: '0 0 200 250', preserveAspectRatio: 'xMidYMid slice', className: 'block h-full w-full', 'aria-hidden': true } as const

const NEON = [
  { sky: ['#141640', '#5a3c97'], glow: ['#ff4fa3', '#45e0ff'], street: '#101233', haze: '#a77bff' },
  { sky: ['#220f3a', '#9b3f78'], glow: ['#ffb347', '#c77dff'], street: '#190d2b', haze: '#ff8a7a' },
  { sky: ['#0b2232', '#1f6f8b'], glow: ['#5ff2c5', '#ff6b8b'], street: '#08192a', haze: '#5fd3e6' },
  { sky: ['#24122a', '#c4506b'], glow: ['#ffd36e', '#7aa2ff'], street: '#1c0e1c', haze: '#ff9a6b' },
]

export function NeonStreetArt({ variant }: { variant: number }) {
  const id = useId()
  const p = NEON[variant % NEON.length]
  const rand = rng(variant * 97 + 13)
  const far = Array.from({ length: 10 }, (_, i) => ({ x: i * 22 - 8 + rand() * 6, w: 16 + rand() * 14, h: 48 + rand() * 72 }))
  const windows = far.flatMap((b) => Array.from({ length: 12 }, () => ({ x: b.x + 2 + rand() * (b.w - 5), y: 152 - b.h + 5 + rand() * (b.h - 12), on: rand() })))
  const rain = Array.from({ length: 46 }, () => ({ x: rand() * 220, y: rand() * 250, l: 6 + rand() * 10 }))
  const figure = 96 + variant * 9
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} />
          <stop offset="1" stopColor={p.sky[1]} />
        </linearGradient>
        <linearGradient id={`${id}street`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[1]} stopOpacity="0.55" />
          <stop offset="0.25" stopColor={p.street} />
          <stop offset="1" stopColor="#05050f" />
        </linearGradient>
        <radialGradient id={`${id}vig`} cx="0.5" cy="0.45" r="0.75">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <filter id={`${id}glow`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
        <filter id={`${id}soft`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" /></filter>
        <filter id={`${id}streak`} x="-50%" y="-10%" width="200%" height="120%"><feGaussianBlur stdDeviation="1.6 6" /></filter>
      </defs>
      <rect width="200" height="250" fill={`url(#${id}sky)`} />
      <ellipse cx="120" cy="120" rx="90" ry="40" fill={p.haze} opacity="0.35" filter={`url(#${id}soft)`} />
      {far.map((b, i) => <rect key={i} x={b.x} y={152 - b.h} width={b.w} height={b.h} fill="#06061a" opacity={0.45 + (i % 3) * 0.1} />)}
      {windows.map((w, i) => w.on > 0.5 && <rect key={i} x={w.x} y={w.y} width="1.6" height="2.2" fill={w.on > 0.85 ? p.glow[i % 2] : '#ffe6b0'} opacity={0.35 + w.on * 0.5} />)}
      {/* 近景左楼与竖向招牌 */}
      <path d="M0 20 L44 34 L44 156 L0 160 Z" fill="#07071a" />
      <path d="M44 34 L52 40 L52 155 L44 156 Z" fill="#11112c" />
      <g filter={`url(#${id}glow)`} opacity="0.9">
        <rect x="30" y="58" width="10" height="56" rx="2" fill="none" stroke={p.glow[0]} strokeWidth="2.4" />
      </g>
      <rect x="30" y="58" width="10" height="56" rx="2" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="0.8" />
      {[66, 78, 90, 102].map((y) => <rect key={y} x="32.5" y={y} width="5" height="6" rx="1" fill={p.glow[0]} opacity="0.85" />)}
      {/* 近景右楼与横向招牌 */}
      <path d="M200 8 L158 30 L158 158 L200 162 Z" fill="#07071a" />
      <path d="M158 30 L150 36 L150 157 L158 158 Z" fill="#11112c" />
      <g filter={`url(#${id}glow)`}>
        <rect x="118" y="80" width="52" height="14" rx="7" fill="none" stroke={p.glow[1]} strokeWidth="2.6" />
      </g>
      <rect x="118" y="80" width="52" height="14" rx="7" fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="0.8" />
      {[124, 133, 142, 151, 160].map((x) => <rect key={x} x={x} y="84.5" width="5" height="5" rx="1.2" fill={p.glow[1]} opacity="0.9" />)}
      {[48, 66, 84, 102, 120, 138].map((y) => <rect key={y} x="166" y={y} width="22" height="5" fill="#ffd9a0" opacity={y % 36 ? 0.18 : 0.42} />)}
      {/* 湿地面：倒影被拉长并模糊 */}
      <rect y="152" width="200" height="98" fill={`url(#${id}street)`} />
      <g filter={`url(#${id}streak)`} opacity="0.65">
        <rect x="30" y="160" width="10" height="70" fill={p.glow[0]} />
        <rect x="120" y="158" width="52" height="16" fill={p.glow[1]} opacity="0.8" />
        <rect x="140" y="170" width="18" height="60" fill={p.glow[1]} opacity="0.6" />
        <rect x="70" y="156" width="40" height="20" fill={p.haze} opacity="0.4" />
      </g>
      {[[60, 205, 34], [140, 225, 40], [30, 238, 24]].map(([cx, cy, rx]) => <ellipse key={cx} cx={cx} cy={cy} rx={rx} ry="3" fill="none" stroke="#fff" strokeOpacity="0.14" strokeWidth="0.8" />)}
      <path d="M0 196 L200 186" stroke="#fff" strokeOpacity="0.07" strokeWidth="6" />
      {/* 打伞的行人 */}
      <g transform={`translate(${figure} 0)`}>
        <path d="M-15 160 Q0 144 15 160 Z" fill={p.glow[0]} />
        <path d="M-15 160 Q0 150 15 160" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.6" />
        <path d="M0 160 L0 168" stroke="#0a0a14" strokeWidth="0.9" />
        <path d="M-3.5 166 Q0 163 3.5 166 L4.5 186 L1.5 186 L0.6 196 L-0.6 196 L-1.5 186 L-4.5 186 Z" fill="#0a0a14" />
        <path d="M-15 196 Q0 212 15 196 Z" fill={p.glow[0]} opacity="0.18" filter={`url(#${id}glow)`} />
      </g>
      {rain.map((r, i) => <path key={i} d={`M${r.x} ${r.y} l-2.4 ${r.l}`} stroke="#fff" strokeOpacity={0.12 + (i % 4) * 0.06} strokeWidth="0.55" />)}
      <rect width="200" height="250" fill={`url(#${id}vig)`} />
    </svg>
  )
}

const PERFUME = [
  { bg: ['#fff6ec', '#ead2b8'], liquid: ['#f6c98f', '#d98e4f'], cap: ['#6b5641', '#d9c2a2'], w: 64, h: 78, r: 10, capW: 26, capH: 24 },
  { bg: ['#f6efe9', '#d9c0ad'], liquid: ['#f3d6dc', '#d9899c'], cap: ['#a8a29a', '#f5f2ec'], w: 54, h: 92, r: 6, capW: 34, capH: 16 },
  { bg: ['#fdf1ea', '#e5b6a1'], liquid: ['#ffd9b8', '#e5946d'], cap: ['#2b2421', '#7d6d63'], w: 74, h: 66, r: 22, capW: 22, capH: 28 },
  { bg: ['#f3ede4', '#cbb79c'], liquid: ['#dcd2a6', '#a99355'], cap: ['#8c6b2a', '#f1d58c'], w: 46, h: 100, r: 14, capW: 18, capH: 34 },
]

export function PerfumeArt({ variant }: { variant: number }) {
  const id = useId()
  const p = PERFUME[variant % PERFUME.length]
  const base = 196
  const x = 100 - p.w / 2
  const y = base - p.h
  const bottle = (
    <>
      <rect x={x} y={y} width={p.w} height={p.h} rx={p.r} fill={`url(#${id}glass)`} />
      <rect x={x + 4} y={y + p.h * 0.32} width={p.w - 8} height={p.h * 0.68 - 4} rx={Math.max(2, p.r - 4)} fill={`url(#${id}liquid)`} opacity="0.88" />
      <rect x={x + 4} y={y + p.h * 0.32} width={p.w - 8} height="2" rx="1" fill="#fff" opacity="0.45" />
      <rect x={x} y={y} width={p.w} height={p.h} rx={p.r} fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.2" />
    </>
  )
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor={p.bg[0]} />
          <stop offset="1" stopColor={p.bg[1]} />
        </linearGradient>
        <linearGradient id={`${id}floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.bg[1]} stopOpacity="0.5" />
          <stop offset="1" stopColor={p.bg[0]} />
        </linearGradient>
        <linearGradient id={`${id}glass`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="0.25" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id={`${id}liquid`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.liquid[0]} />
          <stop offset="1" stopColor={p.liquid[1]} />
        </linearGradient>
        <linearGradient id={`${id}cap`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={p.cap[0]} />
          <stop offset="0.35" stopColor={p.cap[1]} />
          <stop offset="0.55" stopColor={p.cap[0]} />
          <stop offset="1" stopColor={p.cap[1]} />
        </linearGradient>
        <linearGradient id={`${id}fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}mirror`}><rect y={base} width="200" height={250 - base} fill={`url(#${id}fade)`} /></mask>
        <radialGradient id={`${id}light`} cx="0.2" cy="0.1" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
        <filter id={`${id}blur1`}><feGaussianBlur stdDeviation="0.8" /></filter>
      </defs>
      <rect width="200" height="250" fill={`url(#${id}bg)`} />
      <rect y={base - 6} width="200" height={256 - base} fill={`url(#${id}floor)`} />
      <rect width="200" height="250" fill={`url(#${id}light)`} />
      {/* 侧光投下的长影 */}
      <path d={`M${x + p.w} ${base} L${x + p.w + 70} ${base + 22} L${x + 40} ${base + 24} L${x} ${base} Z`} fill="#5a4030" opacity="0.14" filter={`url(#${id}blur)`} />
      <ellipse cx="100" cy={base + 1} rx={p.w * 0.62} ry="5" fill="#3d2a1e" opacity="0.28" filter={`url(#${id}blur)`} />
      <g mask={`url(#${id}mirror)`} transform={`translate(0 ${base * 2}) scale(1 -1)`}>{bottle}</g>
      {bottle}
      {/* 高光条与标签 */}
      <rect x={x + 6} y={y + 6} width="5" height={p.h - 12} rx="2.5" fill="#fff" opacity="0.75" filter={`url(#${id}blur1)`} />
      <rect x={x + p.w - 9} y={y + 10} width="2" height={p.h - 22} rx="1" fill="#fff" opacity="0.6" />
      <rect x={100 - p.w * 0.28} y={y + p.h * 0.48} width={p.w * 0.56} height={p.h * 0.26} rx="2" fill="#fffdf9" opacity="0.88" />
      <rect x={100 - p.w * 0.16} y={y + p.h * 0.55} width={p.w * 0.32} height="2.4" rx="1" fill="#6d5a48" opacity="0.8" />
      <rect x={100 - p.w * 0.1} y={y + p.h * 0.63} width={p.w * 0.2} height="1.4" rx="0.7" fill="#6d5a48" opacity="0.45" />
      <rect x="93" y={y - 7} width="14" height="8" fill={`url(#${id}cap)`} />
      <rect x={100 - p.capW / 2} y={y - 7 - p.capH} width={p.capW} height={p.capH} rx="2.5" fill={`url(#${id}cap)`} />
      <rect x={100 - p.capW / 2 + 3} y={y - 5 - p.capH} width="2.2" height={p.capH - 4} rx="1" fill="#fff" opacity="0.55" />
    </svg>
  )
}

const PICNIC = [
  { sky: ['#bfe6ff', '#fff3d6'], sun: '#ffcf5c', hills: ['#a7dc8f', '#6fbf73', '#3f9a5f'], blanket: '#ff7f6e', accent: '#ff9fb5' },
  { sky: ['#ffe3c4', '#fff7e0'], sun: '#ff9f5a', hills: ['#cfe59a', '#93cc6a', '#5aa95a'], blanket: '#5a9cff', accent: '#ffd35a' },
  { sky: ['#d6f2ea', '#fdf6dc'], sun: '#f6c45f', hills: ['#bfe9d7', '#7fcfa8', '#3fae8a'], blanket: '#f2785c', accent: '#b49cff' },
  { sky: ['#f9f1c0', '#fff9e8'], sun: '#ffb347', hills: ['#d4ee9c', '#8fd07a', '#4fa86a'], blanket: '#e85d8a', accent: '#6ec2ff' },
]

export function PicnicPosterArt({ variant }: { variant: number }) {
  const id = useId()
  const p = PICNIC[variant % PICNIC.length]
  const rand = rng(variant * 31 + 7)
  const flowers = Array.from({ length: 30 }, () => ({ x: rand() * 200, y: 184 + rand() * 62, c: rand() > 0.5 ? p.accent : '#fff' })).filter((f) => f.x < 72 || f.x > 172 || f.y < 206)
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} />
          <stop offset="1" stopColor={p.sky[1]} />
        </linearGradient>
        <pattern id={`${id}check`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="skewX(-30)">
          <rect width="8" height="8" fill="#fff" />
          <rect width="4" height="4" fill={p.blanket} />
          <rect x="4" y="4" width="4" height="4" fill={p.blanket} />
        </pattern>
        <filter id={`${id}grain`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0.18 0" />
        </filter>
      </defs>
      <rect width="200" height="250" fill={`url(#${id}sky)`} />
      {/* 留给标题的区域 */}
      <rect x="22" y="18" width="156" height="44" rx="6" fill="#fff" fillOpacity="0.35" stroke="#2b3a2e" strokeOpacity="0.35" strokeWidth="0.8" strokeDasharray="3 2.4" />
      <rect x="38" y="30" width="96" height="9" rx="2" fill="#2b3a2e" opacity="0.55" />
      <rect x="38" y="45" width="60" height="5" rx="2" fill="#2b3a2e" opacity="0.3" />
      <g transform="translate(152 92)">
        {Array.from({ length: 12 }, (_, i) => <rect key={i} x="-1" y="-26" width="2" height="7" rx="1" fill={p.sun} transform={`rotate(${i * 30})`} />)}
        <circle r="15" fill={p.sun} />
        <circle r="15" fill="#fff" opacity="0.25" transform="translate(-4 -4) scale(0.5)" />
      </g>
      {[[46, 86, 1], [108, 104, 0.8]].map(([cx, cy, s]) => (
        <g key={cx} transform={`translate(${cx} ${cy}) scale(${s})`} fill="#fff">
          <circle cx="0" cy="0" r="9" /><circle cx="11" cy="-4" r="11" /><circle cx="24" cy="1" r="8" /><rect x="-4" y="0" width="32" height="8" rx="4" />
        </g>
      ))}
      <path d="M60 78 l3 2 l3 -2 M72 72 l2.4 1.6 l2.4 -1.6" fill="none" stroke="#2b3a2e" strokeOpacity="0.5" strokeWidth="0.8" />
      <path d="M0 150 Q50 118 110 140 T200 130 L200 250 L0 250 Z" fill={p.hills[0]} />
      <path d="M0 176 Q60 146 120 168 T200 160 L200 250 L0 250 Z" fill={p.hills[1]} />
      {/* 树 */}
      <rect x="32" y="128" width="5" height="34" rx="2" fill="#7a5236" />
      {[[34, 118, 15], [24, 128, 11], [45, 127, 12], [34, 132, 12]].map(([cx, cy, r]) => <circle key={`${cx}${cy}`} cx={cx} cy={cy} r={r} fill={p.hills[2]} />)}
      <circle cx="29" cy="114" r="5" fill="#fff" opacity="0.18" />
      <path d="M0 206 Q70 186 140 202 T200 196 L200 250 L0 250 Z" fill={p.hills[2]} />
      {/* 野餐垫、篮子和水果 */}
      <path d="M78 214 L150 210 L168 238 L84 244 Z" fill={`url(#${id}check)`} />
      <path d="M78 214 L150 210 L168 238 L84 244 Z" fill="none" stroke="#fff" strokeWidth="1" />
      <path d="M104 216 Q116 198 128 216" fill="none" stroke="#8a5a35" strokeWidth="2.2" />
      <path d="M100 216 L132 216 L128 232 L104 232 Z" fill="#c98a4f" />
      {[220, 225].map((y) => <path key={y} d={`M101 ${y} L131 ${y}`} stroke="#8a5a35" strokeWidth="0.8" />)}
      <circle cx="144" cy="228" r="4.5" fill="#ff5a4f" /><circle cx="152" cy="231" r="4" fill="#ffc94a" />
      <path d="M144 223.5 l1 -2.4" stroke="#3f7a3a" strokeWidth="1" />
      {flowers.map((f, i) => <g key={i} transform={`translate(${f.x} ${f.y})`}><circle r="2" fill={f.c} /><circle r="0.8" fill="#ffd54a" /></g>)}
      <rect width="200" height="250" filter={`url(#${id}grain)`} />
    </svg>
  )
}

export function EarbudsArt() {
  const id = useId()
  const bud = (flip: boolean) => (
    <g transform={flip ? 'translate(134 92) scale(-1 1) rotate(-24)' : 'translate(66 92) rotate(-24)'}>
      <ellipse cx="0" cy="8" rx="16" ry="5" fill="#2a2c36" opacity="0.18" filter={`url(#${id}blur)`} transform="translate(8 64)" />
      <rect x="-6" y="10" width="12" height="62" rx="6" fill={`url(#${id}white)`} />
      <rect x="-3.5" y="62" width="7" height="6" rx="2" fill="#c7cad3" />
      <ellipse cx="0" cy="6" rx="17" ry="15" fill={`url(#${id}white)`} />
      <ellipse cx="5" cy="4" rx="7" ry="6" fill={`url(#${id}tip)`} />
      <ellipse cx="5.5" cy="3.5" rx="4" ry="3.4" fill="#3b3e48" />
      {Array.from({ length: 5 }, (_, i) => <circle key={i} cx={3.6 + (i % 3) * 1.4} cy={2.6 + Math.floor(i / 3) * 1.6} r="0.4" fill="#6d717d" />)}
      <ellipse cx="-7" cy="-1" rx="5" ry="3" fill="#fff" opacity="0.9" />
      <rect x="-3.5" y="18" width="2" height="44" rx="1" fill="#fff" opacity="0.85" />
    </g>
  )
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id={`${id}white`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#eceef3" />
          <stop offset="1" stopColor="#c9ccd6" />
        </linearGradient>
        <radialGradient id={`${id}tip`}>
          <stop offset="0" stopColor="#8e93a0" />
          <stop offset="1" stopColor="#dfe2e9" />
        </radialGradient>
        <linearGradient id={`${id}case`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dadde5" />
        </linearGradient>
        <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      <ellipse cx="100" cy="214" rx="46" ry="7" fill="#2a2c36" opacity="0.2" filter={`url(#${id}blur)`} />
      <rect x="58" y="150" width="84" height="64" rx="24" fill={`url(#${id}case)`} />
      <path d="M58 170 H142" stroke="#b9bcc7" strokeWidth="0.9" />
      <rect x="64" y="154" width="72" height="5" rx="2.5" fill="#fff" opacity="0.9" />
      <circle cx="100" cy="190" r="2" fill="#5ee28b" />
      <circle cx="100" cy="190" r="4.5" fill="#5ee28b" opacity="0.25" />
      {bud(false)}
      {bud(true)}
    </svg>
  )
}

export function FestivalPosterArt() {
  const id = useId()
  const rand = rng(53)
  const crowd = Array.from({ length: 26 }, (_, i) => ({ x: i * 8 - 4 + rand() * 4, r: 4 + rand() * 2.5, up: rand() > 0.72 }))
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd9a3" />
          <stop offset="0.55" stopColor="#f08a5d" />
          <stop offset="1" stopColor="#6b3f6e" />
        </linearGradient>
        <pattern id={`${id}dots`} width="5" height="5" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="0.9" fill="#3b1f3a" />
        </pattern>
        <linearGradient id={`${id}dotfade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.3" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.5" />
        </linearGradient>
        <mask id={`${id}dotmask`}><rect width="200" height="250" fill={`url(#${id}dotfade)`} /></mask>
        <clipPath id={`${id}sun`}><circle cx="100" cy="128" r="46" /></clipPath>
        <filter id={`${id}grain`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0 0.1  0 0 0 0.22 0" />
        </filter>
      </defs>
      <rect width="200" height="250" fill={`url(#${id}bg)`} />
      {/* 放射光 */}
      <g transform="translate(100 128)" opacity="0.22">
        {Array.from({ length: 16 }, (_, i) => <path key={i} d="M0 0 L-9 -170 L9 -170 Z" fill="#fff6e0" transform={`rotate(${i * 22.5})`} />)}
      </g>
      <g clipPath={`url(#${id}sun)`}>
        <rect x="50" y="80" width="100" height="100" fill="#ffe08a" />
        {[134, 144, 152, 159, 165].map((y, i) => <rect key={y} x="50" y={y} width="100" height={2 + i} fill="#f08a5d" />)}
      </g>
      <path d="M0 178 L38 140 L62 160 L96 122 L130 158 L152 142 L200 182 L200 250 L0 250 Z" fill="#8a3f62" />
      <path d="M0 196 L44 168 L80 186 L118 160 L160 188 L200 172 L200 250 L0 250 Z" fill="#5a2a4f" />
      {/* 舞台灯与人群剪影 */}
      <path d="M100 178 L60 250 L140 250 Z" fill="#fff3c4" opacity="0.18" />
      <rect x="64" y="196" width="72" height="8" rx="1" fill="#2b1528" />
      {crowd.map((c, i) => (
        <g key={i} fill="#2b1528">
          <circle cx={c.x} cy={226 - c.r} r={c.r} />
          <rect x={c.x - c.r - 1} y={226} width={c.r * 2 + 2} height="30" rx="3" />
          {c.up && <path d={`M${c.x + c.r - 1} 228 L${c.x + c.r + 5} 206`} stroke="#2b1528" strokeWidth="2.6" strokeLinecap="round" />}
        </g>
      ))}
      <rect width="200" height="250" fill={`url(#${id}dots)`} mask={`url(#${id}dotmask)`} />
      {/* 标题区与边框 */}
      <rect x="18" y="20" width="118" height="16" rx="1" fill="#3b1f3a" />
      <rect x="18" y="40" width="80" height="7" rx="1" fill="#3b1f3a" opacity="0.6" />
      <rect x="150" y="20" width="32" height="27" rx="2" fill="none" stroke="#3b1f3a" strokeWidth="1.4" />
      <rect x="156" y="27" width="20" height="4" fill="#3b1f3a" opacity="0.7" />
      <rect x="156" y="35" width="14" height="3" fill="#3b1f3a" opacity="0.45" />
      <rect x="8" y="8" width="184" height="234" fill="none" stroke="#fff3d9" strokeWidth="1.2" opacity="0.7" />
      <rect width="200" height="250" filter={`url(#${id}grain)`} />
    </svg>
  )
}

export function AvatarArt() {
  const id = useId()
  const eye = (cx: number) => (
    <g>
      <ellipse cx={cx} cy="111" rx="8.4" ry="9.6" fill="#fff" />
      <ellipse cx={cx} cy="112" rx="6.6" ry="8.2" fill={`url(#${id}iris)`} />
      <ellipse cx={cx} cy="113" rx="3" ry="4" fill="#1d1640" />
      <circle cx={cx - 2.4} cy="108.2" r="2.1" fill="#fff" />
      <circle cx={cx + 2.6} cy="116" r="1" fill="#fff" opacity="0.8" />
      <path d={`M${cx - 10} 104 Q${cx} 97 ${cx + 10} 103.5`} fill="none" stroke="#2a1b3d" strokeWidth="2.6" strokeLinecap="round" />
      <path d={`M${cx + 8} 103 l3.4 -2`} stroke="#2a1b3d" strokeWidth="1.4" strokeLinecap="round" />
    </g>
  )
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#cfe7ff" />
          <stop offset="0.55" stopColor="#a596ff" />
          <stop offset="1" stopColor="#ff99b7" />
        </linearGradient>
        <linearGradient id={`${id}skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe6d8" />
          <stop offset="1" stopColor="#f7c9b4" />
        </linearGradient>
        <linearGradient id={`${id}hair`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a3466" />
          <stop offset="1" stopColor="#24183a" />
        </linearGradient>
        <radialGradient id={`${id}iris`} cx="0.5" cy="0.7" r="0.7">
          <stop offset="0" stopColor="#9fe3ff" />
          <stop offset="0.6" stopColor="#5a7dff" />
          <stop offset="1" stopColor="#2d2a8c" />
        </radialGradient>
        <linearGradient id={`${id}shirt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff7f0" />
          <stop offset="1" stopColor="#e8dcf5" />
        </linearGradient>
        <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <rect width="200" height="250" fill={`url(#${id}bg)`} />
      <circle cx="100" cy="112" r="74" fill="#fff" opacity="0.22" />
      {[[34, 50, 1], [168, 72, 0.7], [152, 30, 0.5], [40, 168, 0.6]].map(([x, y, s]) => <path key={`${x}${y}`} d="M0 -6 L1.4 -1.4 L6 0 L1.4 1.4 L0 6 L-1.4 1.4 L-6 0 L-1.4 -1.4 Z" fill="#fff" transform={`translate(${x} ${y}) scale(${s})`} />)}
      <path d="M52 112 C44 50 156 50 148 112 L154 176 C140 190 60 190 46 176 Z" fill={`url(#${id}hair)`} />
      <rect x="90" y="140" width="20" height="26" fill="#f2b9a3" />
      <path d="M36 250 C40 192 72 168 100 168 C128 168 160 192 164 250 Z" fill={`url(#${id}shirt)`} />
      <path d="M86 168 L100 186 L114 168" fill="none" stroke="#b9a6d9" strokeWidth="1.6" />
      <path d="M66 102 C66 70 134 70 134 102 C134 132 118 151 100 153 C82 151 66 132 66 102 Z" fill={`url(#${id}skin)`} />
      <ellipse cx="66" cy="114" rx="5" ry="8" fill="#f7c9b4" />
      <ellipse cx="134" cy="114" rx="5" ry="8" fill="#f7c9b4" />
      <circle cx="66" cy="124" r="2" fill="#ffd36e" />
      <circle cx="134" cy="124" r="2" fill="#ffd36e" />
      {eye(85)}
      {eye(115)}
      <path d="M78 94 Q85 90 92 93 M108 93 Q115 90 122 94" fill="none" stroke="#2a1b3d" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M100 122 l-1.4 4 l2.2 0.4" fill="none" stroke="#d99a86" strokeWidth="1" strokeLinecap="round" />
      <path d="M94 133 Q100 137.5 106 133" fill="#e8737f" stroke="#c2566a" strokeWidth="0.9" strokeLinecap="round" />
      <ellipse cx="80" cy="126" rx="7" ry="3.6" fill="#ff8fa8" opacity="0.45" filter={`url(#${id}blur)`} />
      <ellipse cx="120" cy="126" rx="7" ry="3.6" fill="#ff8fa8" opacity="0.45" filter={`url(#${id}blur)`} />
      {/* 刘海与高光 */}
      <path d="M60 104 C56 56 144 56 140 104 C132 86 120 78 110 76 C113 87 105 94 98 96 C100 86 93 79 85 77 C82 90 72 97 60 104 Z" fill={`url(#${id}hair)`} />
      <path d="M78 66 Q100 58 122 66" fill="none" stroke="#b9a6ff" strokeWidth="2.4" strokeLinecap="round" opacity="0.6" />
      <path d="M58 120 C56 140 60 160 54 176 M142 120 C144 140 140 160 146 176" fill="none" stroke="#24183a" strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}

export function MarbleProductArt() {
  const id = useId()
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id={`${id}wall`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#efe9e0" />
          <stop offset="1" stopColor="#d8cfc2" />
        </linearGradient>
        <linearGradient id={`${id}top`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f3ee" />
          <stop offset="1" stopColor="#e2ddd5" />
        </linearGradient>
        <filter id={`${id}marble`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves="4" seed="7" />
          <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.43  0 0 0 0 0.4  -1.4 0 0 0 0.75" />
        </filter>
        <linearGradient id={`${id}jar`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c9b8a4" />
          <stop offset="0.3" stopColor="#f6efe6" />
          <stop offset="0.65" stopColor="#e5d8c8" />
          <stop offset="1" stopColor="#b6a38c" />
        </linearGradient>
        <linearGradient id={`${id}lid`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8f7b5c" />
          <stop offset="0.4" stopColor="#e8d4a8" />
          <stop offset="0.6" stopColor="#a68c5f" />
          <stop offset="1" stopColor="#d9c08f" />
        </linearGradient>
        <linearGradient id={`${id}dropper`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a5a3c" />
          <stop offset="0.35" stopColor="#d99a6c" />
          <stop offset="1" stopColor="#6e4329" />
        </linearGradient>
        <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
      </defs>
      <rect width="200" height="250" fill={`url(#${id}wall)`} />
      <ellipse cx="60" cy="40" rx="80" ry="50" fill="#fff" opacity="0.5" filter={`url(#${id}blur)`} />
      <rect y="150" width="200" height="100" fill={`url(#${id}top)`} />
      <rect y="150" width="200" height="100" filter={`url(#${id}marble)`} opacity="0.55" />
      <path d="M0 188 C40 176 70 198 110 184 S170 170 200 178 M20 250 C50 220 90 236 130 214 S180 206 200 196" fill="none" stroke="#9b958c" strokeWidth="0.7" opacity="0.45" />
      <path d="M0 150 H200" stroke="#fff" strokeWidth="1.2" opacity="0.8" />
      {/* 精华液瓶 */}
      <ellipse cx="138" cy="186" rx="16" ry="4" fill="#3d2a1e" opacity="0.25" filter={`url(#${id}blur)`} />
      <rect x="126" y="122" width="24" height="64" rx="5" fill={`url(#${id}dropper)`} />
      <rect x="130" y="128" width="3" height="52" rx="1.5" fill="#fff" opacity="0.4" />
      <rect x="131" y="146" width="14" height="18" rx="1" fill="#f6efe6" opacity="0.85" />
      <rect x="132" y="108" width="12" height="14" rx="2" fill="#2b2421" />
      <rect x="134" y="92" width="8" height="18" rx="4" fill="#3b322d" />
      {/* 面霜罐 */}
      <ellipse cx="88" cy="200" rx="40" ry="7" fill="#3d2a1e" opacity="0.28" filter={`url(#${id}blur)`} />
      <path d="M52 160 V194 A36 8 0 0 0 124 194 V160 Z" fill={`url(#${id}jar)`} />
      <rect x="64" y="172" width="48" height="14" rx="1" fill="#fffaf3" opacity="0.8" />
      <rect x="76" y="177" width="24" height="2" rx="1" fill="#7a6650" opacity="0.8" />
      <path d="M50 140 V160 A38 8 0 0 0 126 160 V140 Z" fill={`url(#${id}lid)`} />
      <ellipse cx="88" cy="140" rx="38" ry="8" fill="#ead6ac" />
      <ellipse cx="80" cy="138.5" rx="20" ry="3" fill="#fff" opacity="0.5" />
      {/* 蒙版只圈出背景，产品轮廓保持不变 */}
      <path d="M44 132 Q88 118 132 132 L132 90 Q140 82 148 90 L156 184 Q100 214 44 204 Z" fill="none" stroke="#c26855" strokeWidth="1.1" strokeDasharray="4 3" />
      <rect x="14" y="16" width="62" height="18" rx="9" fill="#fff" opacity="0.85" />
      <circle cx="25" cy="25" r="3.2" fill="#c26855" />
      <rect x="32" y="22.6" width="36" height="4.8" rx="2.4" fill="#5c5a60" opacity="0.6" />
    </svg>
  )
}

const CATS = [
  { bg: ['#ffe2c6', '#f7b98a'], mist: '#fff3e6', fur: ['#f5a25a', '#d9762f'] },
  { bg: ['#dfe6ff', '#b9b3f2'], mist: '#f3f0ff', fur: ['#f2b06e', '#cc7a3a'] },
  { bg: ['#ffe4ea', '#f4a7b5'], mist: '#fff2f4', fur: ['#f7b47a', '#de8546'] },
  { bg: ['#fff1cf', '#efc77d'], mist: '#fffaf0', fur: ['#ee9a50', '#c86a2a'] },
]

export function SleepingCatArt({ variant }: { variant: number }) {
  const id = useId()
  const p = CATS[variant % CATS.length]
  return (
    <svg {...svgProps} viewBox="0 0 200 200">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.bg[0]} />
          <stop offset="1" stopColor={p.bg[1]} />
        </linearGradient>
        <radialGradient id={`${id}fur`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor={p.fur[0]} />
          <stop offset="1" stopColor={p.fur[1]} />
        </radialGradient>
        <filter id={`${id}mist`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" /></filter>
        <filter id={`${id}blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      <rect width="200" height="200" fill={`url(#${id}bg)`} />
      <circle cx="150" cy="54" r="26" fill="#fff" opacity="0.55" filter={`url(#${id}blur)`} />
      <ellipse cx="100" cy="150" rx="70" ry="9" fill="#5a3a22" opacity="0.18" filter={`url(#${id}blur)`} />
      <g transform="translate(100 124) scale(1.3) translate(-100 -124)">
      <path d="M150 140 C176 132 178 104 160 98 C150 95 146 106 156 110 C166 114 160 128 142 132 Z" fill={`url(#${id}fur)`} />
      <ellipse cx="104" cy="120" rx="54" ry="34" fill={`url(#${id}fur)`} />
      {[[92, 96], [108, 95], [124, 98]].map(([x, y]) => <path key={x} d={`M${x} ${y} q4 10 -2 20`} fill="none" stroke={p.fur[1]} strokeWidth="4" strokeLinecap="round" opacity="0.8" />)}
      <circle cx="62" cy="118" r="27" fill={`url(#${id}fur)`} />
      <path d="M44 102 L42 80 L60 94 Z M70 94 L84 80 L82 102 Z" fill={p.fur[1]} />
      <path d="M47 99 L46 86 L56 94 Z M74 94 L81 86 L80 98 Z" fill="#ffc7b0" />
      <path d="M50 120 q5 4 10 0 M66 120 q5 4 10 0" fill="none" stroke="#5a3218" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M61 127 l2 2 l2 -2" fill="#e88b7a" stroke="#c2564a" strokeWidth="0.8" />
      <path d="M38 126 h-12 M38 130 l-11 3 M86 126 h12 M86 130 l11 3" stroke="#fff" strokeOpacity="0.85" strokeWidth="0.9" strokeLinecap="round" />
      <ellipse cx="52" cy="108" rx="7" ry="4" fill="#fff" opacity="0.3" />
      </g>
      <ellipse cx="100" cy="146" rx="90" ry="22" fill={p.mist} opacity="0.75" filter={`url(#${id}mist)`} />
      <ellipse cx="40" cy="60" rx="50" ry="14" fill={p.mist} opacity="0.5" filter={`url(#${id}mist)`} />
    </svg>
  )
}
