import { Box, Typography, Button, Container, Stack } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ArrowForward } from '@mui/icons-material';

const BaseIndex = () => {
  return (
    <Box
      sx={{
        minHeight: 'calc(100vh - 136px)',
        background:
          'radial-gradient(circle at 80% 20%, rgba(59, 130, 246, 0.24), transparent 32%), linear-gradient(135deg, #05070d 0%, #0f1f46 55%, #1e3a8a 100%)',
        color: 'white',
        p: 4
      }}
    >
      <Container maxWidth="lg">
        <Grid container columns={12} wrap="nowrap" alignItems="center" sx={{ minHeight: 'calc(100vh - 230px)' }}>
          <Grid md={7} lg={6}>
            <Stack spacing={3}>
              <Typography variant="h1" sx={{ fontSize: '4rem', color: '#fff', lineHeight: 1.5 }}>
                光构
              </Typography>
              <Typography variant="h4" sx={{ fontSize: '1.5rem', color: '#fff', lineHeight: 1.5 }}>
                让每一次想象，都有清晰的形状。
              </Typography>
              <Typography sx={{ maxWidth: 560, color: 'rgba(255,255,255,0.62)', fontSize: '1rem', lineHeight: 1.8 }}>
                光构是一站式 AI 视觉创作平台，为用户提供图片生成、编辑、额度管理与创作记录服务。
              </Typography>
              <Button
                variant="contained"
                endIcon={<ArrowForward />}
                href="/panel"
                sx={{
                  background: 'linear-gradient(90deg, #2563eb, #1d4ed8)',
                  color: '#fff',
                  width: 'fit-content',
                  px: 3,
                  py: 1.2,
                  boxShadow: '0 16px 40px rgba(59, 130, 246, 0.28)'
                }}
              >
                进入光构控制台
              </Button>
            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};

export default BaseIndex;
