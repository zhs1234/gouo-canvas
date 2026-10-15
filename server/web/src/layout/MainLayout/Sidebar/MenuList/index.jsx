// material-ui
import { Typography } from '@mui/material';

// project imports
import NavGroup from './NavGroup';
import menuItem from 'menu-items';
import { useIsAdmin, useIsRoot } from 'utils/common';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

// ==============================|| SIDEBAR MENU LIST ||============================== //
const MenuList = ({ isMini = false }) => {
  const userIsAdmin = useIsAdmin();
  const userIsRoot = useIsRoot();
  const { t } = useTranslation();
  const siteInfo = useSelector((state) => state.siteInfo);
  menuItem.items.forEach((group) => {
    group.children.forEach((item) => {
      item.title = t(item.id);
    });
  });

  return (
    <>
      {menuItem.items.map((item) => {
        if (item.type !== 'group') {
          return (
            <Typography key={item.id} variant="h6" color="error" align="center">
              {t('menu.error')}
            </Typography>
          );
        }

        const visible = (child) =>
          (!child.isAdmin || userIsAdmin) &&
          (!child.isRoot || userIsRoot) &&
          !(siteInfo.UserInvoiceMonth === false && child.id === 'invoice');
        // 折叠分组里的子项也要过滤，过滤后为空的分组不显示
        const filteredChildren = item.children
          .filter(visible)
          .map((child) => (child.children ? { ...child, children: child.children.filter(visible) } : child))
          .filter((child) => !child.children || child.children.length > 0);

        if (filteredChildren.length === 0) {
          return null;
        }

        return <NavGroup key={item.id} item={{ ...item, children: filteredChildren }} isMini={isMini} />;
      })}
    </>
  );
};

export default MenuList;
