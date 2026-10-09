import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
// material-ui
import { useTheme } from '@mui/material/styles';
import { Avatar, ButtonBase } from '@mui/material';
import User1 from 'assets/images/users/user-round.svg';

// ==============================|| PROFILE MENU ||============================== //

const Profile = ({ toggleProfileDrawer }) => {
  const theme = useTheme();
  const account = useSelector((state) => state.account);

  return (
    <>
      {/* 用户头像按钮 */}
      <ButtonBase
        aria-label="打开账户菜单"
        aria-haspopup="dialog"
        onClick={toggleProfileDrawer}
        sx={{
          cursor: 'pointer',
          position: 'relative',
          width: '48px',
          height: '48px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          borderRadius: '50%',
          '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 3 },
          background: `linear-gradient(90deg, 
            ${theme.palette.primary.main}, 
            ${theme.palette.secondary.main}, 
            ${theme.palette.primary.light}, 
            ${theme.palette.primary.main})`
        }}
      >
        <Avatar
          src={account.user?.avatar_url || User1}
          sx={{
            ...theme.typography.mediumAvatar,
            cursor: 'pointer',
            width: '45px',
            height: '45px',
            border: '1px solid',
            borderColor: (theme) => (theme.palette.mode === 'dark' ? theme.palette.background.paper : '#ffffff'),
            bgcolor: '#FFFFFF',
            variant: 'rounded',
            transition: 'transform 0.2s ease-in-out, background-color 0.2s ease-in-out',
            '&:hover': {
              transform: 'scale(1.03)'
            }
          }}
        />
      </ButtonBase>
    </>
  );
};

Profile.propTypes = {
  toggleProfileDrawer: PropTypes.func
};

export default Profile;
