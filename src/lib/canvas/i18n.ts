import i18next from 'i18next'
import zhCN from './zhCN'

// 独立实例避免画布的语言初始化修改宿主应用。
const i18n = i18next.createInstance()
void i18n.init({ lng: 'zh-CN', fallbackLng: 'zh-CN', resources: { 'zh-CN': { translation: zhCN } }, interpolation: { escapeValue: false }, initAsync: false })
export default i18n
