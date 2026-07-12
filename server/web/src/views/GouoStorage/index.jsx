import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  Stack,
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

const formatBytes = (bytes = 0) => {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

const GouoStorage = () => {
  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quotaDrafts, setQuotaDrafts] = useState({});
  const [selectedUser, setSelectedUser] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [taskPage, setTaskPage] = useState(1);
  const [taskTotal, setTaskTotal] = useState(0);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResponse, usersResponse] = await Promise.all([
        API.get('/api/gouo/admin/storage'),
        API.get('/api/gouo/admin/storage/users?page=1&size=100')
      ]);
      if (!summaryResponse.data.success) throw new Error(summaryResponse.data.message);
      if (!usersResponse.data.success) throw new Error(usersResponse.data.message);
      setSummary(summaryResponse.data.data);
      setUsers(usersResponse.data.data.data || []);
    } catch (error) {
      showError(error.message || '读取光构存储统计失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateQuota = async (user) => {
    const quotaGB = Number(quotaDrafts[user.user_id] ?? user.quota_bytes / 1024 ** 3);
    if (!Number.isFinite(quotaGB) || quotaGB < 0) {
      showError('请输入有效的 GB 配额');
      return;
    }
    try {
      const response = await API.put(`/api/gouo/admin/storage/users/${user.user_id}/quota`, {
        quota_bytes: Math.round(quotaGB * 1024 ** 3)
      });
      if (!response.data.success) throw new Error(response.data.message);
      showSuccess('用户存储配额已更新');
      await loadData();
    } catch (error) {
      showError(error.message || '更新存储配额失败');
    }
  };

  const loadUserTasks = async (user, page = 1) => {
    setSelectedUser(user);
    setTaskPage(page);
    setTasksLoading(true);
    try {
      const response = await API.get(`/api/gouo/admin/storage/users/${user.user_id}/tasks?page=${page}&size=12`);
      if (!response.data.success) throw new Error(response.data.message);
      setTasks(response.data.data.data || []);
      setTaskTotal(Number(response.data.data.total_count || 0));
    } catch (error) {
      showError(error.message || '读取用户作品失败');
    } finally {
      setTasksLoading(false);
    }
  };

  if (loading && !summary) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const stats = summary?.summary || {};
  return (
    <Box sx={{ mt: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h3">光构云端存储</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            查看作品、资产和用户磁盘配额。隐藏作品不会自动清理。
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => void loadData()} disabled={loading}>
          刷新
        </Button>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          ['资产大小', formatBytes(stats.total_bytes)],
          ['图片资产', Number(stats.asset_count || 0).toLocaleString()],
          ['作品任务', Number(stats.task_count || 0).toLocaleString()],
          ['回收站作品', Number(stats.hidden_count || 0).toLocaleString()],
          ['使用用户', Number(stats.user_count || 0).toLocaleString()]
        ].map(([label, value]) => (
          <Grid item xs={12} sm={6} lg key={label}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" variant="body2">
                  {label}
                </Typography>
                <Typography variant="h3" sx={{ mt: 1 }}>
                  {value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card>
        <Box sx={{ px: 3, pt: 3, pb: 2 }}>
          <Typography variant="h4">用户存储占用</Typography>
        </Box>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table sx={{ minWidth: 900, tableLayout: 'fixed' }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 120 }}>用户</TableCell>
                <TableCell sx={{ width: 180 }}>已用空间</TableCell>
                <TableCell sx={{ width: 220 }}>占用率</TableCell>
                <TableCell sx={{ width: 80 }}>图片数</TableCell>
                <TableCell align="right" sx={{ width: 210 }}>
                  配额（GB）
                </TableCell>
                <TableCell align="right" sx={{ width: 120 }}>
                  作品
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => {
                const percent = user.quota_bytes > 0 ? Math.min(100, (user.used_bytes / user.quota_bytes) * 100) : 100;
                return (
                  <TableRow key={user.user_id}>
                    <TableCell>
                      <Typography fontWeight={600}>{user.username || `用户 ${user.user_id}`}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        ID {user.user_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {formatBytes(user.used_bytes)} / {formatBytes(user.quota_bytes)}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <LinearProgress
                          color={percent >= 100 ? 'error' : percent >= 80 ? 'warning' : 'primary'}
                          variant="determinate"
                          value={percent}
                          sx={{ flex: 1, height: 7, borderRadius: 4 }}
                        />
                        <Typography variant="caption" sx={{ minWidth: 42, textAlign: 'right' }}>
                          {percent > 0 && percent < 1 ? `${percent.toFixed(2)}%` : `${percent.toFixed(0)}%`}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>{Number(user.asset_count || 0).toLocaleString()}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" justifyContent="flex-end" spacing={1}>
                        <TextField
                          size="small"
                          type="number"
                          value={quotaDrafts[user.user_id] ?? (user.quota_bytes / 1024 ** 3).toFixed(2)}
                          onChange={(event) => setQuotaDrafts((current) => ({ ...current, [user.user_id]: event.target.value }))}
                          inputProps={{ min: 0, step: 0.25 }}
                          sx={{ width: 100 }}
                        />
                        <Button size="small" variant="outlined" onClick={() => void updateQuota(user)}>
                          保存
                        </Button>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" onClick={() => void loadUserTasks(user)}>
                        查看作品
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!users.length && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    暂无云端资产
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={Boolean(selectedUser)} onClose={() => setSelectedUser(null)} maxWidth="lg" fullWidth>
        <DialogTitle>{selectedUser?.username || `用户 ${selectedUser?.user_id}`}的云端作品</DialogTitle>
        <DialogContent dividers>
          {tasksLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              <Grid container spacing={2}>
                {tasks.map((task) => {
                  const outputs = (task.assets || []).filter((item) => item.role === 'output');
                  return (
                    <Grid item xs={12} sm={6} md={4} key={task.id}>
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        {outputs.length ? (
                          <Box
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: outputs.length > 1 ? 'repeat(2, 1fr)' : '1fr',
                              gap: 0.5,
                              bgcolor: 'action.hover'
                            }}
                          >
                            {outputs.map((item) => (
                              <Box
                                component="img"
                                key={item.asset_id}
                                src={item.asset.content_url}
                                alt={task.prompt || '用户生成作品'}
                                onClick={() => setPreview({ task, asset: item.asset })}
                                sx={{
                                  width: '100%',
                                  height: 220,
                                  objectFit: 'cover',
                                  cursor: 'zoom-in',
                                  display: 'block'
                                }}
                              />
                            ))}
                          </Box>
                        ) : (
                          <Box
                            sx={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover' }}
                          >
                            <Typography color="text.secondary">
                              {task.status === 'error' ? '生成失败，无输出图片' : '暂无输出图片'}
                            </Typography>
                          </Box>
                        )}
                        <CardContent>
                          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                            <Chip
                              size="small"
                              color={task.status === 'done' ? 'success' : 'error'}
                              label={task.status === 'done' ? '已完成' : '失败'}
                            />
                            {task.hidden_at > 0 && <Chip size="small" label="回收站" />}
                          </Stack>
                          <Typography
                            sx={{
                              mt: 1.5,
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              minHeight: 60
                            }}
                          >
                            {task.prompt || '无提示词'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {task.model || '未知模型'} · {new Date(task.client_created_at || task.created_at).toLocaleString()}
                          </Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
              {!tasks.length && (
                <Typography align="center" color="text.secondary" sx={{ py: 8 }}>
                  该用户暂无云端作品
                </Typography>
              )}
              {taskTotal > 12 && (
                <Stack direction="row" justifyContent="center" alignItems="center" spacing={2} sx={{ mt: 3 }}>
                  <Button disabled={taskPage <= 1} onClick={() => void loadUserTasks(selectedUser, taskPage - 1)}>
                    上一页
                  </Button>
                  <Typography>
                    第 {taskPage} / {Math.ceil(taskTotal / 12)} 页
                  </Typography>
                  <Button disabled={taskPage >= Math.ceil(taskTotal / 12)} onClick={() => void loadUserTasks(selectedUser, taskPage + 1)}>
                    下一页
                  </Button>
                </Stack>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} maxWidth="xl">
        <DialogTitle>{preview?.task.prompt || '作品预览'}</DialogTitle>
        <DialogContent dividers sx={{ p: 1, bgcolor: 'common.black' }}>
          {preview && (
            <Box
              component="img"
              src={preview.asset.content_url}
              alt={preview.task.prompt || '用户生成作品'}
              sx={{ display: 'block', maxWidth: '90vw', maxHeight: '82vh', objectFit: 'contain' }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default GouoStorage;
