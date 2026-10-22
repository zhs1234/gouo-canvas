import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import { API } from 'utils/api';
import { formatPointsMoney, GOUO_POINTS_PER_CNY, renderGouoPoints, showError, showSuccess } from 'utils/common';
import AgentModels from './AgentModels';

const SIZE_TIERS = ['1K', '2K', '4K'];
const QUALITY_OPTIONS = [
  ['low', '低'],
  ['medium', '中'],
  ['high', '高'],
  ['xhigh', '超高 xhigh'],
  ['max', '极致 max']
];
// 画质“不限”只包括低、中、高，超高和极致必须显式开放
const DEFAULT_QUALITIES = ['low', 'medium', 'high'];
const QUALITY_KEYS = QUALITY_OPTIONS.map(([key]) => key);
const qualityLabel = (value) => QUALITY_OPTIONS.find(([key]) => key === value)?.[1] || value;
const ratioValid = (value) => Number(value) > 0 && Number(value) <= 100;
// 系数缺省按 1 计，只提交不为 1 的键
const ratioMap = (keys, values) => Object.fromEntries(keys.map((key) => [key, Number(values[key])]).filter(([, value]) => value !== 1));
// 能力列里的成本相关限制，未设置的不显示
const limitText = (row) =>
  [
    row.gouo_sizes?.length ? `分辨率 ${row.gouo_sizes.join('/')}` : '仅自动尺寸',
    row.gouo_qualities?.length && `画质 ${row.gouo_qualities.map(qualityLabel).join('/')}`,
    row.gouo_max_inputs > 0 && `参考图最多 ${row.gouo_max_inputs} 张`,
    row.gouo_transparent && '原生透明背景'
  ]
    .filter(Boolean)
    .join(' · ');
const hasRatios = (row) =>
  [row.gouo_tier_ratios, row.gouo_quality_ratios].some((ratios) => Object.values(ratios || {}).some((value) => value !== 1));

// 客户端能看到的条件：开启光构、配置有效、至少一个启用中的渠道支持它且渠道分组是有效的用户分组（还需令牌未限制）
const visibility = (row) => {
  if (!row.gouo_enabled) return { ok: false, text: '未启用' };
  if (row.error) return { ok: false, text: row.error };
  if (!row.channels.some((channel) => channel.status === 1)) return { ok: false, text: '没有启用中的渠道支持此模型' };
  if (!row.open_groups.length) return { ok: false, text: '渠道分组都不是有效的用户分组，或渠道为“仅对话”' };
  return { ok: true, text: `分组 ${row.open_groups.join('、')} 可见` };
};

function ImageModels() {
  const [rows, setRows] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get('/api/gouo/admin/models');
      if (!response) return; // 请求失败时 API 拦截器已经提示过，不再重复
      if (!response.data.success) throw new Error(response.data.message);
      setRows(response.data.data.models || []);
      setDefaultModel(response.data.data.default_model || '');
    } catch (error) {
      showError(error.response?.data?.message || error.message || '读取光构模型失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (values) => {
    setSaving(true);
    try {
      const response = await API.put('/api/gouo/admin/models', {
        model: values.model,
        gouo_enabled: values.gouo_enabled,
        // 下架时沿用原售价，避免积分往返换算改动价格
        gouo_price_cny: values.gouo_points === undefined ? values.gouo_price_cny : Number(values.gouo_points) / GOUO_POINTS_PER_CNY,
        gouo_reference: values.gouo_reference,
        gouo_mask: values.gouo_mask,
        gouo_max_outputs: Number(values.gouo_max_outputs),
        // 只有编辑窗口会带上显示名称、说明和排序；下架按钮不传，保持原值
        ...(values.display_name !== undefined && {
          name: values.display_name,
          description: values.display_description,
          gouo_sort: Number(values.display_sort || 0),
          gouo_sizes: values.cap_sizes,
          // 恰好开放低、中、高即不限；勾了超高或极致必须显式提交列表
          gouo_qualities:
            values.cap_qualities.length === DEFAULT_QUALITIES.length && DEFAULT_QUALITIES.every((key) => values.cap_qualities.includes(key))
              ? []
              : values.cap_qualities,
          gouo_max_inputs: Number(values.cap_inputs || 0),
          gouo_tier_ratios: ratioMap(SIZE_TIERS, values.cap_tier_ratios),
          gouo_quality_ratios: ratioMap(QUALITY_KEYS, values.cap_quality_ratios),
          gouo_transparent: values.gouo_transparent
        })
      });
      if (!response) return; // 请求失败时 API 拦截器已经提示过，不再重复
      if (!response.data.success) throw new Error(response.data.message);
      showSuccess(values.gouo_enabled ? `${values.model} 已保存` : `${values.model} 已在客户端下架`);
      setEditing(null);
      await load();
    } catch (error) {
      showError(error.response?.data?.message || error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (model) => {
    try {
      const response = await API.put('/api/gouo/admin/settings', { GouoDefaultImageModel: model });
      if (!response) return; // 请求失败时 API 拦截器已经提示过，不再重复
      if (!response.data.success) throw new Error(response.data.message);
      showSuccess(model ? `默认模型已设为 ${model}` : '已清除默认模型，客户端使用目录第一个');
      setDefaultModel(model);
    } catch (error) {
      showError(error.response?.data?.message || error.message || '设置默认模型失败');
    }
  };

  const filtered = rows.filter(
    (row) =>
      // 后台识别为文本模型的归 Agent 标签页，这里默认不列出
      (showAll || (row.kind !== 'text' && (row.gouo_enabled || row.channels.length > 0))) &&
      (!enabledOnly || row.gouo_enabled) &&
      row.model.toLowerCase().includes(keyword.trim().toLowerCase())
  );
  const valid =
    editing &&
    Number(editing.gouo_points) > 0 &&
    Number(editing.gouo_points) <= 10000 * GOUO_POINTS_PER_CNY &&
    Number.isInteger(Number(editing.gouo_max_outputs)) &&
    Number(editing.gouo_max_outputs) >= 1 &&
    Number(editing.gouo_max_outputs) <= 10 &&
    (!editing.gouo_mask || editing.gouo_reference) &&
    editing.display_name.trim().length <= 40 &&
    editing.display_description.trim().length <= 100 &&
    Number.isInteger(Number(editing.display_sort || 0)) &&
    editing.cap_qualities.length > 0 &&
    Number.isInteger(Number(editing.cap_inputs || 0)) &&
    Number(editing.cap_inputs || 0) >= 0 &&
    Number(editing.cap_inputs || 0) <= 16 &&
    SIZE_TIERS.every((key) => ratioValid(editing.cap_tier_ratios[key])) &&
    QUALITY_KEYS.every((key) => ratioValid(editing.cap_quality_ratios[key]));
  // 价格预览：自动尺寸按 1K、自动画质按 high 计，与服务端扣费一致
  const previewTiers = editing ? [['自动尺寸', '1K'], ...editing.cap_sizes.map((tier) => [tier, tier])] : [];
  const previewPrice = (tier, quality) =>
    renderGouoPoints(
      (Number(editing.gouo_points) / GOUO_POINTS_PER_CNY) *
        Number(editing.cap_tier_ratios[tier]) *
        Number(editing.cap_quality_ratios[quality])
    );

  return (
    <Box>
      <Alert severity="info" sx={{ my: 2 }}>
        客户端只显示同时满足以下条件的模型：在这里启用并填写有效售价；至少一个启用中的渠道支持它，且渠道分组包含用户所在分组；用户令牌没有限制该模型。
        客户端按“排序”从小到大排列，相同时按模型 ID；显示名称和说明不影响价格确认。修改立即生效，多实例部署时其他实例最多 1
        分钟同步。默认模型用于用户未手动选择、或所选模型已下架的情况
        {defaultModel ? `，当前为 ${defaultModel}` : '，当前未设置，客户端使用排在第一的模型'}。
      </Alert>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <TextField label="搜索模型" value={keyword} onChange={(event) => setKeyword(event.target.value)} sx={{ minWidth: 260 }} />
        <FormControlLabel
          control={<Switch checked={enabledOnly} onChange={(event) => setEnabledOnly(event.target.checked)} />}
          label="只看已启用"
        />
        <FormControlLabel
          control={<Switch checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />}
          label="显示全部模型（含文本模型和没有渠道的）"
        />
        <Button onClick={() => void load()} disabled={loading}>
          刷新
        </Button>
        {defaultModel && <Button onClick={() => void setDefault('')}>清除默认模型</Button>}
      </Stack>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              {['模型', '售价', '能力', '支持的渠道', '客户端', '操作'].map((title) => (
                <TableCell key={title}>{title}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((row) => {
              const state = visibility(row);
              return (
                <TableRow key={row.model}>
                  <TableCell sx={{ maxWidth: 240, overflowWrap: 'anywhere' }}>
                    {row.model}
                    {row.model === defaultModel && <Chip label="默认" color="primary" size="small" sx={{ ml: 1 }} />}
                    {row.kind === 'text' && <Chip label="文本模型" color="warning" variant="outlined" size="small" sx={{ ml: 1 }} />}
                    {row.name && row.name !== row.model && (
                      <Typography variant="body2" display="block">
                        显示为「{row.name}」
                      </Typography>
                    )}
                    {row.description && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {row.description}
                      </Typography>
                    )}
                    {row.gouo_enabled && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        排序 {row.gouo_sort}
                      </Typography>
                    )}
                    {!row.priced && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        尚无价格记录
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.gouo_enabled ? `${renderGouoPoints(row.gouo_price_cny)}/张` : '—'}
                    {row.gouo_enabled && hasRatios(row) && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        基础价，按档位 × 画质系数计价
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.gouo_enabled
                      ? `${row.gouo_reference ? '参考图' : '无参考图'} · ${row.gouo_mask ? '遮罩' : '无遮罩'} · 单次最多 ${row.gouo_max_outputs} 张`
                      : '—'}
                    {row.gouo_enabled && limitText(row) && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {limitText(row)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    {row.channels.length ? (
                      row.channels.map((channel) => (
                        <Chip
                          key={channel.id}
                          size="small"
                          variant="outlined"
                          color={channel.status === 1 ? 'default' : 'warning'}
                          sx={{ mr: 0.5, mb: 0.5 }}
                          label={`${channel.name}（${channel.groups.join('、') || '无分组'}）${channel.status === 1 ? '' : ' · 已禁用'}`}
                        />
                      ))
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        没有渠道
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={state.ok ? 'success' : 'default'} label={state.ok ? '可见' : '不可见'} />
                    <Typography variant="caption" display="block">
                      {state.text}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        onClick={() =>
                          setEditing({
                            ...row,
                            // 避免 0.07 × 100 这类浮点误差出现在输入框里
                            gouo_points: row.gouo_price_cny ? Number((row.gouo_price_cny * GOUO_POINTS_PER_CNY).toPrecision(12)) : '',
                            gouo_max_outputs: row.gouo_max_outputs || 1,
                            gouo_enabled: true,
                            display_name: row.name || '',
                            display_description: row.description || '',
                            display_sort: row.gouo_sort || 0,
                            cap_sizes: row.gouo_sizes || [],
                            cap_qualities: row.gouo_qualities?.length ? row.gouo_qualities : DEFAULT_QUALITIES,
                            cap_inputs: row.gouo_max_inputs || 0,
                            cap_tier_ratios: Object.fromEntries(SIZE_TIERS.map((key) => [key, row.gouo_tier_ratios?.[key] ?? 1])),
                            cap_quality_ratios: Object.fromEntries(QUALITY_KEYS.map((key) => [key, row.gouo_quality_ratios?.[key] ?? 1])),
                            gouo_transparent: Boolean(row.gouo_transparent)
                          })
                        }
                      >
                        {row.gouo_enabled ? '编辑' : '启用'}
                      </Button>
                      {row.gouo_enabled && (
                        <Button size="small" color="warning" disabled={saving} onClick={() => void save({ ...row, gouo_enabled: false })}>
                          下架
                        </Button>
                      )}
                      {row.gouo_enabled && row.model !== defaultModel && (
                        <Button size="small" onClick={() => void setDefault(row.model)}>
                          设为默认
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  {loading ? '读取中…' : '没有符合条件的模型'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog
        open={Boolean(editing)}
        onClose={() => {
          if (!saving) setEditing(null);
        }}
        fullWidth
        maxWidth="sm"
        aria-labelledby="gouo-model-title"
      >
        {editing && (
          <Box
            component="form"
            // 表单包住标题、内容和按钮，要接上弹窗的纵向布局，内容过长时才会在弹窗内滚动
            sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (valid) void save(editing);
            }}
          >
            <DialogTitle id="gouo-model-title">{editing.model}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Alert severity="info">按每张成功生成的图片收费，生成与编辑同价，不叠加分组倍率；上游价格同步不会覆盖这里的配置。</Alert>
                <TextField
                  label="显示名称"
                  value={editing.display_name}
                  onChange={(event) => setEditing({ ...editing, display_name: event.target.value })}
                  inputProps={{ maxLength: 40 }}
                  helperText="客户端模型列表显示的名称，留空时显示模型 ID"
                />
                <TextField
                  label="说明"
                  value={editing.display_description}
                  onChange={(event) => setEditing({ ...editing, display_description: event.target.value })}
                  inputProps={{ maxLength: 100 }}
                  helperText="一句话说明，显示在客户端模型名称后面，例如“速度快，适合草图”"
                />
                <TextField
                  label="排序"
                  type="number"
                  value={editing.display_sort}
                  onChange={(event) => setEditing({ ...editing, display_sort: event.target.value })}
                  inputProps={{ step: 1 }}
                  helperText="数字小的排在前面"
                />
                <TextField
                  required
                  label="基础价（积分/张）"
                  type="number"
                  inputProps={{ min: 0.0001, max: 10000 * GOUO_POINTS_PER_CNY, step: 'any' }}
                  value={editing.gouo_points}
                  onChange={(event) => setEditing({ ...editing, gouo_points: event.target.value })}
                  helperText={`1 元 = ${GOUO_POINTS_PER_CNY} 积分${Number(editing.gouo_points) > 0 ? `，每张${formatPointsMoney(editing.gouo_points)}` : ''}；实际单价再乘以下方的档位和画质系数`}
                />
                <TextField
                  required
                  label="单次请求最多输出张数"
                  type="number"
                  inputProps={{ min: 1, max: 10, step: 1 }}
                  value={editing.gouo_max_outputs}
                  onChange={(event) => setEditing({ ...editing, gouo_max_outputs: event.target.value })}
                  helperText="只约束直接调用 API 时单个请求的 n；光构客户端按张拆成单图请求"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={Boolean(editing.gouo_reference)}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          gouo_reference: event.target.checked,
                          gouo_mask: event.target.checked && editing.gouo_mask
                        })
                      }
                    />
                  }
                  label="支持参考图编辑"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={Boolean(editing.gouo_mask)}
                      disabled={!editing.gouo_reference}
                      onChange={(event) => setEditing({ ...editing, gouo_mask: event.target.checked })}
                    />
                  }
                  label="支持遮罩编辑（需同时支持参考图）"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={Boolean(editing.gouo_transparent)}
                      onChange={(event) => setEditing({ ...editing, gouo_transparent: event.target.checked })}
                    />
                  }
                  label="原生透明背景（输出需为 PNG 或 WebP）"
                />
                <Alert severity="warning">
                  按张计价时，尺寸越大、画质越高、参考图越多，上游成本越高。以下限制由服务端校验，客户端只显示允许的选项。gpt-image-2.5
                  系列支持超高/极致画质和原生透明背景；gpt-image-2 的透明背景仅为预览，可能报错。
                </Alert>
                <Box>
                  <Typography variant="body2">支持的分辨率</Typography>
                  {SIZE_TIERS.map((tier) => (
                    <FormControlLabel
                      key={tier}
                      control={
                        <Checkbox
                          checked={editing.cap_sizes.includes(tier)}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              cap_sizes: event.target.checked
                                ? SIZE_TIERS.filter((key) => key === tier || editing.cap_sizes.includes(key))
                                : editing.cap_sizes.filter((key) => key !== tier)
                            })
                          }
                        />
                      }
                      label={tier}
                    />
                  ))}
                  <Typography variant="caption" display="block" color="text.secondary">
                    只勾选上游实际支持的档位，客户端只显示勾选的档位；都不勾选时只能用自动尺寸。1K 约 1024×1536，2K 约 2048×2048，4K 约
                    3840×2160。
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2">开放的画质</Typography>
                  {QUALITY_OPTIONS.map(([value, label]) => (
                    <FormControlLabel
                      key={value}
                      control={
                        <Checkbox
                          checked={editing.cap_qualities.includes(value)}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              cap_qualities: event.target.checked
                                ? QUALITY_OPTIONS.map(([key]) => key).filter((key) => key === value || editing.cap_qualities.includes(key))
                                : editing.cap_qualities.filter((key) => key !== value)
                            })
                          }
                        />
                      }
                      label={label}
                    />
                  ))}
                  <Typography variant="caption" display="block" color={editing.cap_qualities.length ? 'text.secondary' : 'error'}>
                    {editing.cap_qualities.length
                      ? '只勾选低、中、高表示不限；超高和极致成本远高于高画质（极致约为低画质的 30 倍），必须勾选才开放。“自动”画质可能被上游选成高画质，只在开放高画质时提供。'
                      : '至少开放一种画质'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    价格系数
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
                    {SIZE_TIERS.map((key) => (
                      <TextField
                        key={key}
                        size="small"
                        type="number"
                        label={`${key} 档位`}
                        value={editing.cap_tier_ratios[key]}
                        error={!ratioValid(editing.cap_tier_ratios[key])}
                        onChange={(event) =>
                          setEditing({ ...editing, cap_tier_ratios: { ...editing.cap_tier_ratios, [key]: event.target.value } })
                        }
                        inputProps={{ min: 0.01, max: 100, step: 'any' }}
                        sx={{ width: 130 }}
                      />
                    ))}
                  </Stack>
                  <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} sx={{ mt: 1 }}>
                    {QUALITY_OPTIONS.map(([key, label]) => (
                      <TextField
                        key={key}
                        size="small"
                        type="number"
                        label={`画质 ${label}`}
                        value={editing.cap_quality_ratios[key]}
                        error={!ratioValid(editing.cap_quality_ratios[key])}
                        onChange={(event) =>
                          setEditing({ ...editing, cap_quality_ratios: { ...editing.cap_quality_ratios, [key]: event.target.value } })
                        }
                        inputProps={{ min: 0.01, max: 100, step: 'any' }}
                        sx={{ width: 130 }}
                      />
                    ))}
                  </Stack>
                  <Typography variant="caption" display="block" color="text.secondary">
                    实际单价 = 基础价 × 档位系数 × 画质系数；自动尺寸按 1K、自动画质按 high 计。系数大于 0、不超过 100，默认 1。
                  </Typography>
                </Box>
                {Number(editing.gouo_points) > 0 && (
                  <Box>
                    <Typography variant="body2">价格预览（积分/张）</Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>档位</TableCell>
                          {editing.cap_qualities.map((quality) => (
                            <TableCell key={quality}>{qualityLabel(quality)}</TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {previewTiers.map(([label, tier]) => (
                          <TableRow key={label}>
                            <TableCell>{label}</TableCell>
                            {editing.cap_qualities.map((quality) => (
                              <TableCell key={quality}>{previewPrice(tier, quality)}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
                <TextField
                  label="最多参考图张数"
                  type="number"
                  value={editing.cap_inputs}
                  disabled={!editing.gouo_reference}
                  onChange={(event) => setEditing({ ...editing, cap_inputs: event.target.value })}
                  inputProps={{ min: 0, max: 16, step: 1 }}
                  helperText="0 表示不限（客户端最多 16 张）；只在支持参考图时生效"
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button disabled={saving} onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button type="submit" variant="contained" disabled={saving || !valid}>
                {saving ? '保存中…' : '保存并启用'}
              </Button>
            </DialogActions>
          </Box>
        )}
      </Dialog>
    </Box>
  );
}

export default function GouoModels() {
  const [tab, setTab] = useState('image');
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h3">光构模型</Typography>
      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mt: 1 }}>
        <Tab value="image" label="图片模型" />
        <Tab value="agent" label="Agent 模型" />
      </Tabs>
      {tab === 'image' ? <ImageModels /> : <AgentModels />}
    </Box>
  );
}
