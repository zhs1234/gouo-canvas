import { Panel, Notice } from '@gouo/ui'
const rows = [
  ['GPT Image 2.5 Sunburst', 'gpt-image-2.5-sunburst', 'Images / Responses'],
  ['GPT Image 2.5 Flare', 'gpt-image-2.5-flare', 'Images / Responses'],
  ['Gemini 图片模型', '按实际渠道填写，不与 GPT Image 2.5 混用', 'Gemini Content / Interactions'],
  ['FLUX / fal 端点', '按供应商端点版本填写', 'fal Queue / Native'],
  ['Seedream / 千问 / 万相', '按区域、渠道及版本填写', '兼容 Images 或 Native'],
]
export default function Models() {
  return <Panel title="模型接入清单（不是已上线模型）">
    <Notice>所有条目均待本平台真实渠道验证。模型名称、接口协议、支持操作与计费必须分别确认。</Notice>
    <div className="table-scroll"><table><thead><tr><th>模型家族</th><th>上游标识</th><th>适配方向</th><th>本平台状态</th></tr></thead><tbody>
      {rows.map(([name, id, protocol]) => <tr key={name}><td>{name}</td><td>{id}</td><td>{protocol}</td><td>待验证</td></tr>)}
    </tbody></table></div>
    <p>本页是开发范围清单。上线时由服务端模型目录替换，禁止直接把此清单当成可用模型菜单。</p>
  </Panel>
}
