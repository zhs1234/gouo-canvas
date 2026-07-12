import { useSelector } from 'react-redux';

/**
 * if you want to use image instead of <svg> uncomment following.
 *
 * import logoDark from 'assets/images/logo-dark.svg';
 * import logo from 'assets/images/logo.svg';
 *
 */

// ==============================|| LOGO SVG ||============================== //

const Logo = ({ isMini = false }) => {
  const siteInfo = useSelector((state) => state.siteInfo);

  if (siteInfo.isLoading) {
    return null; // 数据加载未完成时不显示 logo
  }

  const logoToDisplay = siteInfo.logo ? siteInfo.logo : '/gouo-logo.svg';

  return (
    <img
      src={logoToDisplay}
      alt={siteInfo.system_name}
      style={{
        height: isMini ? '28px' : '50px',
        maxWidth: isMini ? '48px' : 'none',
        objectFit: 'contain',
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    />
  );
};

export default Logo;
