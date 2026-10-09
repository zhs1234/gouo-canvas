import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { API } from 'utils/api';
import { showError, showSuccess } from 'utils/common';

const labels = { reserved: '预扣未发送', dispatched: '已发送，生成中', needs_review: '待核对', settled: '已结算', refunded: '已退款' };

export default function GouoBilling() {
  const [draft, setDraft] = useState({ status: 'needs_review', user_id: '', request_id: '' });
  const [query, setQuery] = useState(draft);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), size: '20' });
      Object.entries(query).forEach(([key, value]) => { if (value.trim()) params.set(key, value.trim()); });
      const response = await API.get(`/api/gouo/admin/image-charges?${params}`);
      if (!response.data.success) throw new Error(response.data.message);
      setRows(response.data.data.data || []);
      setTotal(response.data.data.total_count);
    } catch (error) {
      showError(error.response?.data?.message || error.message || '读取图片账务失败');
    } finally {
      setLoading(false);
    }
  }, [page, query]);
  useEffect(() => { void load(); }, [load]);

  const resolve = async (event) => {
    event.preventDefault();
    if (!selected || !action || !note.trim() || saving) return;
    setSaving(true);
    try {
      const response = await API.post(`/api/gouo/admin/image-charges/${encodeURIComponent(selected.id)}/resolve`, { status: action, note: note.trim() });
      if (!response.data.success) throw new Error(response.data.message);
      showSuccess('账务处理完成，额度和日志已同步更新');
      setSelected(null);
      await load();
    } catch (error) {
      showError(error.response?.data?.message || error.message || '处理失败，请刷新状态后核对');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h3">光构图片账务</Typography>
      <Alert severity="info" sx={{ my: 2 }}>未发送的中断请求约 20 分钟后自动退款。已发送但结果未知的请求需要核对渠道记录；确认失败才退款，确认成功才结算。处理会记录管理员及核对依据。</Alert>
      <Stack component="form" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery({ ...draft }); }} direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField select label="状态" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} sx={{ minWidth: 180 }}>
          <MenuItem value="">全部状态</MenuItem>
          {Object.entries(labels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
        <TextField label="用户 ID" type="number" inputProps={{ min: 1 }} value={draft.user_id} onChange={(event) => setDraft({ ...draft, user_id: event.target.value })} />
        <TextField label="请求编号" value={draft.request_id} onChange={(event) => setDraft({ ...draft, request_id: event.target.value })} sx={{ flex: 1 }} />
        <Button type="submit" variant="contained" disabled={loading}>查询</Button>
        <Button onClick={() => void load()} disabled={loading}>刷新</Button>
      </Stack>
      <TableContainer>
        <Table>
          <TableHead><TableRow>{['请求 / 时间', '用户 / 渠道', '模型 / 单价', '状态', '说明 / 日志', '处理'].map((title) => <TableCell key={title}>{title}</TableCell>)}</TableRow></TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell sx={{ maxWidth: 250, overflowWrap: 'anywhere' }}>{row.id}<Typography variant="caption" display="block">{new Date(row.created_at * 1000).toLocaleString('zh-CN')}</Typography></TableCell>
                <TableCell>用户 {row.user_id}<br />渠道 {row.channel_id || '未发送'} · {row.attempts} 次尝试</TableCell>
                <TableCell>{row.model_name}<br />¥{row.price_cny} · {row.quota} 额度</TableCell>
                <TableCell><Chip label={labels[row.status] || row.status} color={row.status === 'needs_review' ? 'warning' : 'default'} size="small" /></TableCell>
                <TableCell sx={{ maxWidth: 300, overflowWrap: 'anywhere' }}>{row.note || '—'}{row.log_id > 0 && <Typography variant="caption" display="block">日志 #{row.log_id}{row.resolved_by > 0 ? ` · 管理员 ${row.resolved_by}` : ''}</Typography>}</TableCell>
                <TableCell><Button disabled={row.status !== 'needs_review' || loading} onClick={() => { setSelected(row); setAction(''); setNote(''); }}>核对处理</Button></TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={6} align="center">{loading ? '读取中…' : '没有符合条件的请求'}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
        <Button disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <Typography>第 {page} / {Math.max(1, Math.ceil(total / 20))} 页 · {total} 条</Typography>
        <Button disabled={loading || page * 20 >= total} onClick={() => setPage(page + 1)}>下一页</Button>
      </Stack>
      <Dialog open={Boolean(selected)} onClose={() => { if (!saving) setSelected(null); }} fullWidth maxWidth="sm" aria-labelledby="billing-resolution-title">
        <Box component="form" onSubmit={resolve}>
          <DialogTitle id="billing-resolution-title">核对图片请求</DialogTitle>
          <DialogContent>
            <Typography sx={{ overflowWrap: 'anywhere', mb: 2 }}>请求 {selected?.id}<br />用户 {selected?.user_id} · {selected?.model_name} · ¥{selected?.price_cny}</Typography>
            <TextField select required fullWidth label="核对结果" value={action} onChange={(event) => setAction(event.target.value)} sx={{ mt: 1 }}>
              <MenuItem value="refunded">确认失败，退回预扣额度</MenuItem>
              <MenuItem value="settled">确认成功，结算预扣额度</MenuItem>
            </TextField>
            <TextField required fullWidth multiline minRows={3} label="核对依据（渠道记录、时间或工单编号）" value={note} onChange={(event) => setNote(event.target.value)} inputProps={{ maxLength: 1000 }} sx={{ mt: 2 }} />
          </DialogContent>
          <DialogActions><Button disabled={saving} onClick={() => setSelected(null)}>取消</Button><Button type="submit" variant="contained" disabled={saving || !action || !note.trim()}>{saving ? '处理中…' : '确认处理'}</Button></DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
