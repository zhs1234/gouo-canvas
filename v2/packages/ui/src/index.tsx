import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
export function Button({ className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`button ${className}`} {...props} />
}
export function Panel({ title, children }: PropsWithChildren<{ title: string }>) {
  return <section className="panel"><h2>{title}</h2>{children}</section>
}
export function Notice({ children, error = false }: PropsWithChildren<{ error?: boolean }>) {
  return <p className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{children}</p>
}
