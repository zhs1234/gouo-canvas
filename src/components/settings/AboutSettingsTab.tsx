import { BRAND } from '../../config/brand'
import { GithubIcon } from '../icons'

export default function AboutSettingsTab() {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center pb-8 px-6">
      {/* 保留上游项目的 MIT 许可署名。 */}
      <div className="flex flex-col items-center">
        <div className="mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-[1.75rem] border border-blue-200/70 bg-gradient-to-br from-blue-50 to-blue-100 p-3 dark:border-blue-300/15 dark:from-blue-400/10 dark:to-blue-600/15">
          <img src={BRAND.logoUrl} alt={`${BRAND.name} Logo`} className="h-full w-full object-contain" />
        </div>
        <h4 className="text-[17px] font-bold text-gray-800 dark:text-gray-100">{BRAND.name} · {BRAND.nameEn}</h4>
        <p className="mt-1.5 text-[13px] text-gray-500 dark:text-gray-400">{BRAND.slogan}</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">by {BRAND.team}</p>
      </div>

      <p className="mt-8 mb-6 max-w-[360px] text-center text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
        {BRAND.description}。本产品由 {BRAND.team} 负责设计与运营。
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <a
          href={BRAND.repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-all hover:bg-blue-600 dark:bg-white dark:text-gray-900 dark:hover:bg-blue-400"
        >
          <GithubIcon className="h-4 w-4 opacity-80" />
          项目 GitHub
        </a>
        <a
          href={BRAND.source.repositoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-gray-100/80 px-5 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white"
        >
          <GithubIcon className="h-4 w-4 opacity-70" />
          开源致谢
        </a>
      </div>
      <p className="mt-4 max-w-[420px] text-center text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
        本站基于开源项目 {BRAND.source.name}（MIT）修改，原作者 @{BRAND.source.author}。
      </p>
    </div>
  )
}
