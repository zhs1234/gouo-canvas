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
import { GOUO_POINTS_PER_CNY, renderGouoPoints, showError, showSuccess } from 'utils/common';

// 客户端能看到的条件：开启光构、配置有效、至少一个启用中的渠道支持它（还需用户分组匹配、令牌未限制）
const visibility = (row) => {
  if (!row.gouo_enabled) return { ok: false, text: '未启用' };
  if (row.error) return { ok: false, text: row.error };
  const groups = [...new Set(row.channels.filter((channel) => channel.status === 1).flatMap((channel) => channel.groups))];
  if (!groups.length) return { ok: false, text: '没有启用中的渠道支持此模型' };
  return { ok: true, text: `分组 ${groups.join('、')} 可见` };
};

export default function GouoModels() {
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
        gouo_max_outputs: Number(values.gouo_max_outputs)
      });
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
      if (!response.data.success) throw new Error(response.data.message);
      showSuccess(model ? `默认模型已设为 ${model}` : '已清除默认模型，客户端使用目录第一个');
      setDefaultModel(model);
    } catch (error) {
      showError(error.response?.data?.message || error.message || '设置默认模型失败');
    }
  };

  const filtered = rows.filter(
    (row) =>
      (showAll || row.gouo_enabled || row.channels.length > 0) &&
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
    (!editing.gouo_mask || editing.gouo_reference);

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h3">光构模型</Typography>
      <Alert severity="info" sx={{ my: 2 }}>
        客户端只显示同时满足以下条件的模型：在这里启用并填写有效售价；至少一个启用中的渠道支持它，且渠道分组包含用户所在分组；用户令牌没有限制该模型。
        修改立即生效，多实例部署时其他实例最多 1 分钟同步。默认模型用于用户未手动选择、或所选模型已下架的情况
        {defaultModel ? `，当前为 ${defaultModel}` : '，当前未设置，客户端使用目录第一个'}。
      </Alert>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <TextField label="搜索模型" value={keyword} onChange={(event) => setKeyword(event.target.value)} sx={{ minWidth: 260 }} />
        <FormControlLabel
          control={<Switch checked={enabledOnly} onChange={(event) => setEnabledOnly(event.target.checked)} />}
          label="只看已启用"
        />
        <FormControlLabel
          control={<Switch checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />}
          label="显示没有渠道的已定价模型"
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
                    {!row.priced && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        尚无价格记录
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{row.gouo_enabled ? `${renderGouoPoints(row.gouo_price_cny)}/张` : '—'}</TableCell>
                  <TableCell>
                    {row.gouo_enabled
                      ? `${row.gouo_reference ? '参考图' : '无参考图'} · ${row.gouo_mask ? '遮罩' : '无遮罩'} · 单次最多 ${row.gouo_max_outputs} 张`
                      : '—'}
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
                            gouo_enabled: true
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
                  required
                  label="售价（积分/张）"
                  type="number"
                  inputProps={{ min: 0.0001, max: 10000 * GOUO_POINTS_PER_CNY, step: 'any' }}
                  value={editing.gouo_points}
                  onChange={(event) => setEditing({ ...editing, gouo_points: event.target.value })}
                  helperText={`1 元 = ${GOUO_POINTS_PER_CNY} 积分${Number(editing.gouo_points) > 0 ? `，折合 ¥${Number((editing.gouo_points / GOUO_POINTS_PER_CNY).toPrecision(12))}/张` : ''}`}
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
