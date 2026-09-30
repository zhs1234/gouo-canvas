import { Link, type LinkProps } from 'react-router-dom'
export default function NextLink({ href, ...props }: Omit<LinkProps, 'to'> & { href: string }) {
  return <Link to={href.startsWith('/canvas') ? href.replace('/canvas', '/') : href} {...props} />
}
