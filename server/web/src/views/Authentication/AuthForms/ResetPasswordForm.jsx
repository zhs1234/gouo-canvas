import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { showError, showSuccess } from 'utils/common';
import { API } from 'utils/api';

const ResetPasswordForm = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [inputs, setInputs] = useState({ email: '', token: '' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    setInputs({
      email: searchParams.get('email') || '',
      token: searchParams.get('token') || ''
    });
  }, [searchParams]);

  const submit = async () => {
    if (password.length < 8 || password.length > 20) {
      showError('新密码必须为 8 到 20 个字符');
      return;
    }
    if (password !== confirmPassword) {
      showError('两次输入的新密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      const response = await API.post('/api/user/reset', {
        ...inputs,
        new_password: password
      });
      if (!response.data.success) throw new Error(response.data.message);
      setCompleted(true);
      showSuccess('密码已重置');
      setTimeout(() => navigate('/login'), 1200);
    } catch (error) {
      showError(error.message || '重置密码失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (!inputs.email || !inputs.token) {
    return (
      <Typography variant="h3" sx={{ textDecoration: 'none' }}>
        重置链接无效或已过期
      </Typography>
    );
  }

  if (completed) return <Alert severity="success">密码已重置，正在返回登录页…</Alert>;

  return (
    <Stack spacing={2} padding="24px">
      <TextField
        label="新密码"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        inputProps={{ minLength: 8, maxLength: 20 }}
        fullWidth
      />
      <TextField
        label="确认新密码"
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        inputProps={{ minLength: 8, maxLength: 20 }}
        fullWidth
      />
      <Button
        fullWidth
        onClick={() => void submit()}
        disabled={submitting || !password || !confirmPassword}
        size="large"
        variant="contained"
      >
        {submitting ? '重置中…' : '设置新密码'}
      </Button>
    </Stack>
  );
};

export default ResetPasswordForm;
