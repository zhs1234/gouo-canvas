// material-ui
import { Link, Container, Box } from '@mui/material';
import React from 'react';
import { useSelector } from 'react-redux';

// ==============================|| FOOTER - AUTHENTICATION 2 & 3 ||============================== //

const Footer = () => {
  const siteInfo = useSelector((state) => state.siteInfo);

  return (
    <Container sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '64px', borderRadius: 0 }}>
      <Box sx={{ textAlign: 'center' }}>
        {siteInfo.footer_html ? (
          <div className="custom-footer" dangerouslySetInnerHTML={{ __html: siteInfo.footer_html }}></div>
        ) : (
          <>
            © {new Date().getFullYear()} {siteInfo.system_name} · xgouo ·{' '}
            <Link href="https://github.com/zhs1234/gouo-canvas" target="_blank" rel="noreferrer">
              GitHub
            </Link>{' '}
            · 基于{' '}
            <Link href="https://github.com/MartialBE/one-hub" target="_blank" rel="noreferrer">
              One Hub
            </Link>{' '}
            开源项目二次开发（
            <Link href="https://opensource.org/licenses/mit-license.php" target="_blank" rel="noreferrer">
              MIT
            </Link>
            ）
          </>
        )}
      </Box>
    </Container>
  );
};

export default Footer;
