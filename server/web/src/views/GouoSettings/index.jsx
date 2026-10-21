import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Divider, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { API } from 'utils/api';
import { showError, showSuccess } from 'utils/common';
import ConfirmDialog from 'ui-component/confirm-dialog';

const EMPTY = {
  GouoNotice: '',
  GouoRedemptionHelp: '',
  GouoSupportContact: '',
  GouoTopupUrl: '',
  GouoDefaultImageModel: '',
  GouoCanvasEnabled: 'true',
  GouoAgentEnabled: 'true',
  GouoAgentDefaultModel: '',
  GouoAgentSystemPrompt: '',
  GouoAgentSiteGuide: '',
  GouoMaxImagesPerTask: '10',
  GouoAllowLowModeration: 'false',
  GouoAgentMaxRounds: '8',
  GouoAgentConfirmImages: '4',
  GouoSkillsEnabled: 'true',
  GouoSkillImportEnabled: 'true',
  GouoSkillGithubImport: 'false',
  GouoCloudLibraryEnabled: 'true',
  GouoAssetUserQuotaBytes: String(2 * 1024 ** 3),
  GouoAssetMaxFileBytes: String(25 * 1024 ** 2),
  GouoTrashRetentionDays: '3'
};

export default function GouoSettings() {
  const [saved, setSaved] = useState(EMPTY);
  const [values, setValues] = useState(EMPTY);
  const [models, setModels] = useState([]);
  const [agentModels, setAgentModels] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmShorten, setConfirmShorten] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, catalog, site] = await Promise.all([
        API.get('/api/gouo/admin/settings'),
        API.get('/api/gouo/admin/models'),
        API.get('/api/status')
      ]);
      if (!settings || !catalog || !site) return; // 请求失败时 API 拦截器已经提示过，不再重复
      if (!settings.data.success) throw new Error(settings.data.message);
      const next = { ...EMPTY, ...settings.data.data };
      setSaved(next);
      setValues(next);
      setModels((catalog.data.data?.models || []).filter((row) => row.gouo_enabled).map((row) => row.model));
      setAgentModels(settings.data.agent_models || []);
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
  // 缩短保留期会在下一次清理时彻底删除超期内容，无法恢复，保存前要确认
  const shortensTrash = 'GouoTrashRetentionDays' in changed && Number(values.GouoTrashRetentionDays) < Number(saved.GouoTrashRetentionDays);
  const save = async () => {
    setSaving(true);
    try {
      const response = await API.put('/api/gouo/admin/settings', changed);
      if (!response) return; // 请求失败时 API 拦截器已经提示过，不再重复
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
  const options =
    values.GouoDefaultImageModel && !models.includes(values.GouoDefaultImageModel) ? [...models, values.GouoDefaultImageModel] : models;
  const agentOptions =
    values.GouoAgentDefaultModel && !agentModels.includes(values.GouoAgentDefaultModel)
      ? [...agentModels, values.GouoAgentDefaultModel]
      : agentModels;
  // 字节数按整数 GB / MB 填写，避免小数输入被换算打断
  const sizeField = (key, unit) => ({
    value: values[key] ? String(Math.round(Number(values[key]) / unit)) : '',
    onChange: (event) =>
      setValues({ ...values, [key]: event.target.value === '' ? '' : String(Math.round(Number(event.target.value)) * unit) }),
    disabled: loading || saving,
    fullWidth: true,
    type: 'number'
  });
  const toggle = (key, label, helper) => (
    <Box>
      <FormControlLabel
        control={
          <Switch
            checked={values[key] === 'true'}
            onChange={(event) => setValues({ ...values, [key]: event.target.checked ? 'true' : 'false' })}
            disabled={loading || saving}
          />
        }
        label={label}
      />
      <Typography variant="caption" display="block" color="text.secondary" sx={{ ml: 6 }}>
        {helper}
      </Typography>
    </Box>
  );

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
          helperText="在用户中心的兑换页展示，可填写获取方式、发放条件、处理时间或活动公告。文字里的 http(s) 网址可直接点击；单独一行的图片网址显示为图片。"
        />
        <TextField
          label="客服联系方式"
          multiline
          minRows={2}
          {...field('GouoSupportContact')}
          inputProps={{ maxLength: 2000 }}
          helperText="在用户中心的“充值与账务帮助”展示，用户可复制。文字里的 http(s) 网址可直接点击；单独一行的图片网址（如微信、群二维码）显示为图片。"
        />
        <TextField
          label="购买兑换码链接"
          {...field('GouoTopupUrl')}
          inputProps={{ maxLength: 500 }}
          placeholder="https://"
          helperText="填写卡网等购买兑换码的网址，充值页会显示「购买兑换码」按钮；留空则不显示。"
        />
        <Divider textAlign="left">功能与生成</Divider>
        {toggle('GouoCanvasEnabled', '开放画布', '关闭后客户端隐藏画布入口和“我的画布”；已保存的画布保留，重新开放后可继续使用。')}
        {toggle(
          'GouoAgentEnabled',
          '开放 Agent',
          '关闭后客户端隐藏 Agent 入口、创作会话和画布里的 Agent 按钮，Agent 模型目录返回为空；已保存的会话保留。'
        )}
        <TextField
          select
          label="一次最多生成张数"
          {...field('GouoMaxImagesPerTask')}
          helperText="限制客户端一次提交的图片总数（1–10 张），生成页、画布和 Agent 都受此限制。每张仍按单图请求计费。"
        >
          {Array.from({ length: 10 }, (_, index) => String(index + 1)).map((value) => (
            <MenuItem key={value} value={value}>
              {value} 张
            </MenuItem>
          ))}
        </TextField>
        {toggle(
          'GouoAllowLowModeration',
          '允许用户选择宽松审核',
          '开启后用户可把上游内容审核调成宽松（low）；关闭时服务端拒绝宽松审核，客户端隐藏该选项，一律按自动审核。'
        )}
        <Divider textAlign="left">Agent</Divider>
        <TextField
          select
          label="默认 Agent 模型"
          {...field('GouoAgentDefaultModel')}
          helperText={
            values.GouoAgentDefaultModel && !agentModels.includes(values.GouoAgentDefaultModel)
              ? '该模型目前不满足 Agent 条件，当前不生效，新对话使用目录中的第一个。'
              : '新对话默认使用的对话模型；用户可在对话中切换。列表为“模型详情”中输出文本且带 tools 标签的模型，用户还需有对应渠道和分组。'
          }
        >
          <MenuItem value="">未设置（使用目录中的第一个）</MenuItem>
          {agentOptions.map((model) => (
            <MenuItem key={model} value={model}>
              {model}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="每条消息最多工具轮数"
          {...field('GouoAgentMaxRounds')}
          helperText="Agent 处理一条用户消息时最多调用几轮工具（1–20），每轮都会消耗一次对话请求的 token。"
        >
          {Array.from({ length: 20 }, (_, index) => String(index + 1)).map((value) => (
            <MenuItem key={value} value={value}>
              {value} 轮
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="生成超过几张图片时请用户确认"
          {...field('GouoAgentConfirmImages')}
          helperText="单条用户消息内 Agent 合计提交的图片超过这个张数时，先弹窗让用户确认费用（1–10 张）。"
        >
          {Array.from({ length: 10 }, (_, index) => String(index + 1)).map((value) => (
            <MenuItem key={value} value={value}>
              {value} 张
            </MenuItem>
          ))}
        </TextField>
        {toggle(
          'GouoSkillsEnabled',
          '开放技能',
          '技能是写给 Agent 的创作方法说明（内置 9 个，用户也可以导入）。关闭后 Agent 不再列出和使用技能，客户端隐藏技能入口；用户导入的技能保留。'
        )}
        {toggle(
          'GouoSkillImportEnabled',
          '允许用户导入技能',
          '关闭后客户端隐藏导入入口，只能使用内置技能和已导入的技能。导入的技能按文档同步到服务端，计入用户空间。'
        )}
        {toggle(
          'GouoSkillGithubImport',
          '允许所有用户从 GitHub 链接导入',
          '管理员始终可以从 GitHub 链接导入；开启后普通用户也可以。上传压缩包导入不受这项影响。'
        )}
        <TextField
          label="Agent 附加提示词"
          multiline
          minRows={3}
          {...field('GouoAgentSystemPrompt')}
          inputProps={{ maxLength: 4000 }}
          helperText="附加在内置规则之后，用于补充语气、品牌或业务要求，最多 4000 字；不能放宽计费确认、工具和安全规则。在新的一轮对话中生效。"
        />
        <TextField
          label="Agent 网站使用说明"
          multiline
          minRows={6}
          {...field('GouoAgentSiteGuide')}
          inputProps={{ maxLength: 8000 }}
          helperText="用户问到本站怎么用时，Agent 按需读取这份说明再回答，不随每次对话发送；最多 8000 字。功能或入口变化后请同步修改。清空后 Agent 不再提供这项查询。在新的一轮对话中生效。"
        />
        <Divider textAlign="left">云端作品库</Divider>
        {toggle(
          'GouoCloudLibraryEnabled',
          '开放云端作品库',
          '关闭后客户端不再上传和同步作品、画布与会话，生成结果只保存在用户浏览器；已保存的云端内容保留。用户刷新页面后生效。'
        )}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            label="默认每用户空间（GB）"
            {...sizeField('GouoAssetUserQuotaBytes', 1024 ** 3)}
            inputProps={{ min: 1, max: 1024, step: 1 }}
            helperText="未单独设置配额的用户使用此值，可在“光构存储”为个别用户调整。只约束用户上传的参考图和遮罩，服务端保存的生成图不计入限制。"
          />
          <TextField
            label="单文件上传上限（MB）"
            {...sizeField('GouoAssetMaxFileBytes', 1024 ** 2)}
            inputProps={{ min: 1, max: 100, step: 1 }}
            helperText="参考图、遮罩等单个上传文件的上限，1–100 MB。调高时同步调整 Nginx 的 client_max_body_size（部署模板为 32 MB）和 CDN 限制。"
          />
          <TextField
            label="回收站保留天数"
            {...field('GouoTrashRetentionDays')}
            type="number"
            inputProps={{ min: 1, max: 30, step: 1 }}
            helperText="1–30 天。缩短后，已超过新保留期的内容会在下一次清理（每小时一次）时彻底删除，无法恢复。"
          />
        </Stack>
        {status && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary">
              账号入口（在“设置 → 系统设置”修改，仅 root）：
            </Typography>
            <Chip
              size="small"
              color={status.register_enabled ? 'success' : 'default'}
              label={status.register_enabled ? '开放注册' : '已关闭注册'}
            />
            <Chip
              size="small"
              color={status.password_login ? 'success' : 'default'}
              label={status.password_login ? '允许密码登录' : '已关闭密码登录'}
            />
          </Stack>
        )}
        <Box>
          <Button
            variant="contained"
            disabled={loading || saving || !Object.keys(changed).length}
            onClick={() => (shortensTrash ? setConfirmShorten(true) : void save())}
          >
            {saving ? '保存中…' : '保存'}
          </Button>
        </Box>
      </Stack>
      <ConfirmDialog
        open={confirmShorten}
        onClose={() => setConfirmShorten(false)}
        title="缩短回收站保留天数"
        content={`保留天数将从 ${saved.GouoTrashRetentionDays} 天改为 ${values.GouoTrashRetentionDays} 天。下一次清理（每小时一次）时，回收站里已超过新保留期的作品、画布、会话和收藏夹，以及已注销账号的云端数据会被彻底删除，无法恢复。`}
        action={
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              setConfirmShorten(false);
              void save();
            }}
          >
            确认缩短并保存
          </Button>
        }
      />
    </Box>
  );
}
