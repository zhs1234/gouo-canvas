import { Icon } from '@iconify/react';

const icons = {
  IconBrandGithubCopilot: () => <Icon width={20} icon="solar:box-minimalistic-bold-duotone" />
};

const Billing = {
  id: 'billing',
  title: 'Billing',
  type: 'group',
  children: [
    {
      id: 'model_price',
      title: '可用模型',
      type: 'item',
      url: '/panel/model_price',
      icon: icons.IconBrandGithubCopilot,
      breadcrumbs: false,
      isAdmin: false
    }
  ]
};

export default Billing;
