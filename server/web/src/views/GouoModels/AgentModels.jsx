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
  TextField,
  Typography
} from '@mui/material';
import { API } from 'utils/api';
import { showError, showSuccess } from 'utils/common';

const formatPoints = (value) => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const validPoints = (value) => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e7;

export default function AgentModels() {
  const [rows, setRows] = useState([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [listedOnly, setListedOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get('/api/gouo/admin/agent-models');
      if (!response) return; // 请求失败时 API 拦截器已经提示过，不再重复
      if (!response.data.success) throw new Error(response.data.message);
      setRows(response.data.data.models || []);
      setDefaultModel(response.data.data.default_model || '');
    } catch (error) {
      showError(error.response?.data?.message || error.message || '读取 Agent 模型失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (body, message) => {
    setSaving(true);
    try {
      const response = await API.put('/api/gouo/admin/agent-models', body);
      if (!response) return; // 请求失败时 API 拦截器已经提示过，不再重复
      if (!response.data.success) throw new Error(response.data.message);
      showSuccess(message);
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
      const response = await API.put('/api/gouo/admin/settings', { GouoAgentDefaultModel: model });
      if (!response) return; // 请求失败时 API 拦截器已经提示过，不再重复
      if (!response.data.success) throw new Error(response.data.message);
      showSuccess(model ? `默认 Agent 模型已设为 ${model}` : '已清除默认 Agent 模型，客户端使用排在第一的模型');
      setDefaultModel(model);
    } catch (error) {
      showError(error.response?.data?.message || error.message || '设置默认模型失败');
    }
  };

  const filtered = rows.filter(
    (row) =>
      // 后台识别为图片模型的归图片标签页，这里默认不列出
      (showAll || (row.kind !== 'image' && (row.listed || row.channels.length > 0))) &&
      (!listedOnly || row.listed) &&
      `${row.model} ${row.name}`.toLowerCase().includes(keyword.trim().toLowerCase())
  );
  // 按次计费的模型两个价格都留空时保持按次计费，只保存其他字段
  const keepTimes = editing && editing.times_points !== null && editing.input_points === '' && editing.output_points === '';
  const valid =
    editing &&
    (keepTimes || (validPoints(editing.input_points) && validPoints(editing.output_points))) &&
    Number.isInteger(Number(editing.gouo_max_tokens || 0)) &&
    Number(editing.gouo_max_tokens || 0) >= 0 &&
    Number(editing.gouo_max_tokens || 0) <= 1000000 &&
    editing.name.trim().length <= 40 &&
    editing.description.trim().length <= 100 &&
    Number.isInteger(Number(editing.gouo_sort || 0));

  return (
    <Box>
      <Alert severity="info" sx={{ my: 2 }}>
        Agent
        只列出已上架的文本模型：上架即声明模型能输出文本并支持工具调用。还需要至少一个启用中的渠道支持它并允许流式输出，渠道分组包含用户所在分组，用户令牌没有限制该模型。
        价格按“积分/百万 token”填写，实际扣费还会乘以用户分组倍率；在这里保存的价格不会被上游价格同步覆盖。默认模型用于新对话
        {defaultModel ? `，当前为 ${defaultModel}` : '，当前未设置，客户端使用排在第一的模型'}。
      </Alert>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <TextField label="搜索模型" value={keyword} onChange={(event) => setKeyword(event.target.value)} sx={{ minWidth: 260 }} />
        <FormControlLabel
          control={<Switch checked={listedOnly} onChange={(event) => setListedOnly(event.target.checked)} />}
          label="只看已上架"
        />
        <FormControlLabel
          control={<Switch checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />}
          label="显示全部模型（含图片模型和没有渠道的）"
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
              {['模型', '价格（积分/百万 token）', '能力', '支持的渠道', '客户端', '操作'].map((title) => (
                <TableCell key={title}>{title}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((row) => {
              const free = row.priced && !row.input_points && !row.output_points;
              return (
                <TableRow key={row.model}>
                  <TableCell sx={{ maxWidth: 240, overflowWrap: 'anywhere' }}>
                    {row.model}
                    {row.model === defaultModel && <Chip label="默认" color="primary" size="small" sx={{ ml: 1 }} />}
                    {row.kind === 'image' && <Chip label="图片模型" color="warning" variant="outlined" size="small" sx={{ ml: 1 }} />}
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
                    {row.listed && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        排序 {row.gouo_sort}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 240 }}>
                    {!row.priced ? (
                      <Typography variant="caption" color="text.secondary">
                        尚无价格记录
                      </Typography>
                    ) : free ? (
                      <Typography variant="body2" color="error.main" fontWeight={600}>
                        免费（输入、输出均为 0）
                      </Typography>
                    ) : row.price_type === 'times' ? (
                      <>
                        <Typography variant="body2">按次计费：每次 {formatPoints(row.input_points)} 积分</Typography>
                        <Typography variant="caption" display="block" color="warning.main">
                          不能用于 Agent，填写按 token 的价格后可用
                        </Typography>
                      </>
                    ) : (
                      <>
                        <Typography variant="body2">输入 {formatPoints(row.input_points)}</Typography>
                        <Typography variant="body2">输出 {formatPoints(row.output_points)}</Typography>
                      </>
                    )}
                    {row.price_warning && (
                      <Typography variant="caption" display="block" color="warning.main">
                        {row.price_warning}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.listed ? `工具调用 · ${row.vision ? '可看图' : '不看图'}` : '—'}
                    {row.listed && row.gouo_max_tokens > 0 && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        单次回复最多 {row.gouo_max_tokens.toLocaleString('zh-CN')} token
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
                          color={channel.status === 1 && channel.stream ? 'default' : 'warning'}
                          sx={{ mr: 0.5, mb: 0.5 }}
                          label={`${channel.name}（${channel.groups.join('、') || '无分组'}）${channel.status === 1 ? '' : ' · 已禁用'}${
                            channel.stream ? '' : ' · 未开流式'
                          }`}
                        />
                      ))
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        没有渠道
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={row.visible ? 'success' : 'default'} label={row.visible ? '可见' : '不可见'} />
                    <Typography variant="caption" display="block">
                      {row.visible ? `分组 ${row.open_groups.join('、')} 可见` : row.reason}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        onClick={() => {
                          // 按次计费的价格不是每百万 token 的价格，不预填，由管理员重新填写；取 12 位精度避免浮点误差出现在输入框里
                          const points =
                            row.priced && row.price_type !== 'times'
                              ? [row.input_points, row.output_points].map((value) => Number(Number(value).toPrecision(12)))
                              : null;
                          setEditing({
                            model: row.model,
                            listed: row.listed,
                            name: row.name || '',
                            description: row.description || '',
                            gouo_sort: row.gouo_sort || 0,
                            vision: row.vision,
                            gouo_max_tokens: row.gouo_max_tokens || 0,
                            times_points: row.price_type === 'times' ? row.input_points : null,
                            input_points: points ? points[0] : '',
                            output_points: points ? points[1] : '',
                            // 记下打开时的价格：没改价格就不提交，后端只在填写价格时才锁定，免得上游同步的价格被锁住
                            initial_points: points,
                            // 排序和回复上限也只在改动时提交，都没改时后端不重写价格记录
                            initial_sort: row.gouo_sort || 0,
                            initial_max_tokens: row.gouo_max_tokens || 0
                          });
                        }}
                      >
                        {row.listed ? '编辑' : '上架'}
                      </Button>
                      {row.listed && (
                        <Button
                          size="small"
                          color="warning"
                          disabled={saving}
                          onClick={() => void save({ model: row.model, listed: false }, `${row.model} 已在客户端下架`)}
                        >
                          下架
                        </Button>
                      )}
                      {row.listed && row.model !== defaultModel && (
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
        aria-labelledby="gouo-agent-model-title"
      >
        {editing && (
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!valid) return;
              void save(
                {
                  model: editing.model,
                  listed: true,
                  name: editing.name,
                  description: editing.description,
                  vision: editing.vision,
                  ...(Number(editing.gouo_sort || 0) === editing.initial_sort ? {} : { gouo_sort: Number(editing.gouo_sort || 0) }),
                  ...(Number(editing.gouo_max_tokens || 0) === editing.initial_max_tokens
                    ? {}
                    : { gouo_max_tokens: Number(editing.gouo_max_tokens || 0) }),
                  ...(keepTimes ||
                  (editing.initial_points?.[0] === Number(editing.input_points) &&
                    editing.initial_points?.[1] === Number(editing.output_points))
                    ? {}
                    : { input_points: Number(editing.input_points), output_points: Number(editing.output_points) })
                },
                `${editing.model} 已保存并上架`
              );
            }}
          >
            <DialogTitle id="gouo-agent-model-title">{editing.model}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {editing.times_points !== null && (
                  <Alert severity="warning">
                    该模型当前按次计费（每次 {formatPoints(editing.times_points)} 积分），按次计费的模型不会出现在客户端 Agent
                    中。填写每百万 token 的输入和输出价格后改为按 token 计费即可使用；两个价格都留空则保持按次计费，只保存其他字段。
                  </Alert>
                )}
                <TextField
                  label="显示名称"
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  inputProps={{ maxLength: 40 }}
                  helperText="客户端 Agent 模型列表显示的名称，留空时显示模型 ID"
                />
                <TextField
                  label="说明"
                  value={editing.description}
                  onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                  inputProps={{ maxLength: 100 }}
                  helperText="一句话说明，显示在客户端模型名称后面"
                />
                <TextField
                  label="排序"
                  type="number"
                  value={editing.gouo_sort}
                  onChange={(event) => setEditing({ ...editing, gouo_sort: event.target.value })}
                  inputProps={{ step: 1 }}
                  helperText="数字小的排在前面"
                />
                <TextField
                  required={editing.times_points === null}
                  label="输入价格（积分/百万 token）"
                  type="number"
                  value={editing.input_points}
                  onChange={(event) => setEditing({ ...editing, input_points: event.target.value })}
                  inputProps={{ min: 0, max: 1e7, step: 'any' }}
                  error={editing.input_points !== '' && Number(editing.input_points) === 0}
                  helperText={
                    Number(editing.input_points) === 0 && editing.input_points !== '' ? '填 0 表示输入免费' : '实际扣费还会乘以用户分组倍率'
                  }
                />
                <TextField
                  required={editing.times_points === null}
                  label="输出价格（积分/百万 token）"
                  type="number"
                  value={editing.output_points}
                  onChange={(event) => setEditing({ ...editing, output_points: event.target.value })}
                  inputProps={{ min: 0, max: 1e7, step: 'any' }}
                  error={editing.output_points !== '' && Number(editing.output_points) === 0}
                  helperText={
                    Number(editing.output_points) === 0 && editing.output_points !== ''
                      ? '填 0 表示输出免费'
                      : '实际扣费还会乘以用户分组倍率'
                  }
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={Boolean(editing.vision)}
                      onChange={(event) => setEditing({ ...editing, vision: event.target.checked })}
                    />
                  }
                  label="能看图（Agent 会把参考图直接发给模型）"
                />
                <TextField
                  label="单次回复最多输出 token"
                  type="number"
                  value={editing.gouo_max_tokens}
                  onChange={(event) => setEditing({ ...editing, gouo_max_tokens: event.target.value })}
                  inputProps={{ min: 0, max: 1000000, step: 1 }}
                  helperText="0 表示不限。服务端给光构客户端的每次请求带上 max_completion_tokens；需要上游支持该参数，部分中转会忽略，请先实测。推理模型的思考过程也计入输出"
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button disabled={saving} onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button type="submit" variant="contained" disabled={saving || !valid}>
                {saving ? '保存中…' : '保存并上架'}
              </Button>
            </DialogActions>
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
