import { IS_DEBUG } from './conf.js'

export default function log(...args: any[]) {
  if (!IS_DEBUG) return
  queueMicrotask(() => {
    console.log(...args)
  })
}
