import { useSelector, useDispatch } from 'react-redux';
import { useEffect, useContext } from 'react';
import { UserContext } from 'contexts/UserContext';
import { useNavigate } from 'react-router-dom';
import { API } from 'utils/api';
import { LOGIN } from 'store/actions';
import { ADMIN_ONLY_MESSAGE, showError } from 'utils/common';

const AuthGuard = ({ children }) => {
  const account = useSelector((state) => state.account);
  const { isUserLoaded } = useContext(UserContext);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const denied = Boolean(account.user) && account.user.role < 10;

  useEffect(() => {
    if (isUserLoaded && !account.user) {
      navigate('/login');
      return;
    }
    if (!denied) return;
    // 覆盖第三方登录、WebAuthn 和已有会话等不经过密码登录表单的入口
    showError(ADMIN_ONLY_MESSAGE);
    void API.get('/api/user/logout')
      .catch(() => {})
      .finally(() => {
        localStorage.removeItem('user');
        dispatch({ type: LOGIN, payload: null });
        navigate('/login');
      });
  }, [account, navigate, isUserLoaded, denied, dispatch]);

  // 在用户信息加载完成前不渲染子组件
  if (!isUserLoaded || denied) {
    return null;
  }

  return children;
};

export default AuthGuard;
