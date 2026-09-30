import { lazy, Suspense, type ComponentType } from 'react'
export default function dynamic<T extends object>(loader: () => Promise<ComponentType<T>>, _options?: { ssr?: boolean }) {
  const Component = lazy(() => loader().then(defaultExport => ({ default: defaultExport })))
  return function Dynamic(props: T) { return <Suspense fallback={<div className="h-full bg-background" />}><Component {...props} /></Suspense> }
}
