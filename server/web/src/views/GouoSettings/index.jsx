import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { API } from 'utils/api';
import { showError, showSuccess } from 'utils/common';

const EMPTY = { GouoNotice: '', GouoRedemptionHelp: '', GouoSupportContact: '', GouoDefaultImageModel: '' };

export default function GouoSettings() {
  const [saved, setSaved] = useState(EMPTY);
  const [values, setValues] = useState(EMPTY);
  const [models, setModels] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, catalog, site] = await Promise.all([
        API.get('/api/gouo/admin/settings'),
        API.get('/api/gouo/admin/models'),
        API.get('/api/status')
      ]);
      if (!settings.data.success) throw new Error(settings.data.message);
      const next = { ...EMPTY, ...settings.data.data };
      setSaved(next);
      setValues(next);
      setModels((catalog.data.data?.models || []).filter((row) => row.gouo_enabled).map((row) => row.model));
      setStatus(site.data.data || null);
    } catch (error) {
      showError(error.response?.data?.message || error.message || '读取光构设置失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== saved[key]));
  const save = async () => {
    setSaving(true);
    try {
      const response = await API.put('/api/gouo/admin/settings', changed);
      if (!response.data.success) throw new Error(response.data.message);
      const next = { ...EMPTY, ...response.data.data };
      setSaved(next);
      setValues(next);
      showSuccess('已保存，客户端切回页面或刷新后生效');
    } catch (error) {
      showError(error.response?.data?.message || error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };
  const field = (key) => ({
    value: values[key],
    onChange: (event) => setValues({ ...values, [key]: event.target.value }),
    disabled: loading || saving,
    fullWidth: true
  });
  // 已设置但现已下架的默认模型仍列出，方便看出它不再生效
  const options = values.GouoDefaultImageModel && !models.includes(values.GouoDefaultImageModel) ? [...models, values.GouoDefaultImageModel] : models;

  return (
    <Box sx={{ mt: 2, maxWidth: 880 }}>
      <Typography variant="h3">光构设置</Typography>
      <Alert severity="info" sx={{ my: 2 }}>
        这里的设置直接作用于光构客户端，管理员均可修改。用户切回客户端页面或刷新后生效。
      </Alert>
      <Stack spacing={3}>
        <TextField
          label="创作页公告"
          {...field('GouoNotice')}
          inputProps={{ maxLength: 200 }}
          helperText="显示在客户端创作页顶部，单行，最多 200 字。留空时显示默认介绍；用户关闭后，公告内容变化时会再次显示。"
        />
        <TextField
          select
          label="默认图片模型"
          {...field('GouoDefaultImageModel')}
          helperText={
            values.GouoDefaultImageModel && !models.includes(values.GouoDefaultImageModel)
              ? '该模型未在光构启用，当前不生效，客户端使用目录中的第一个。'
              : '用户未手动选择模型、或所选模型已下架时使用；未设置或对用户不可用时，使用模型目录中的第一个。'
          }
        >
          <MenuItem value="">未设置（使用目录中的第一个）</MenuItem>
          {options.map((model) => (
            <MenuItem key={model} value={model}>
              {model}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="兑换码获取说明"
          multiline
          minRows={2}
          {...field('GouoRedemptionHelp')}
          inputProps={{ maxLength: 2000 }}
          helperText="在用户中心的兑换页展示，可填写获取方式、发放条件或处理时间。留空时提示尚未配置。"
        />
        <TextField
          label="客服联系方式"
          multiline
          minRows={2}
          {...field('GouoSupportContact')}
          inputProps={{ maxLength: 2000 }}
          helperText="在用户中心的“充值与账务帮助”展示，用户可复制；单独的 HTTP(S) 网址可直接打开。"
        />
        {status && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary">
              账号入口（在“设置 → 系统设置”修改，仅 root）：
            </Typography>
            <Chip size="small" color={status.register_enabled ? 'success' : 'default'} label={status.register_enabled ? '开放注册' : '已关闭注册'} />
            <Chip size="small" color={status.password_login ? 'success' : 'default'} label={status.password_login ? '允许密码登录' : '已关闭密码登录'} />
          </Stack>
        )}
        <Box>
          <Button variant="contained" disabled={loading || saving || !Object.keys(changed).length} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
