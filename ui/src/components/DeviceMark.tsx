import { useDevices } from '../store'
import Icon from './Icon'

// The machine's own operating system mark: Apple on a Mac, the window grid on
// Windows, a penguin on Linux. Anything else keeps the plain monitor.
const paths = {
  apple: 'M16.37 12.62c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.89-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.78 1.3 10.33.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.38.82 1.4-.02 2.28-1.27 3.13-2.52.99-1.45 1.4-2.85 1.42-2.92-.03-.01-2.72-1.04-2.75-4.14zM13.86 4.96c.71-.86 1.19-2.06 1.06-3.26-1.02.04-2.26.68-3 1.54-.66.76-1.24 1.98-1.08 3.16 1.14.09 2.31-.58 3.02-1.44z',
  windows: 'M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z',
  // A penguin: body, with the belly, eyes and beak cut out.
  linux: 'M12 2.5c-2.6 0-4 2.2-4 5 0 1.4-.5 2.4-1.4 3.9C5.5 13.2 4.6 15 4.6 17c0 1.6.9 2.7 2.2 3.1.6.2 1.2.1 1.7-.3.9.9 2.1 1.4 3.5 1.4s2.6-.5 3.5-1.4c.5.4 1.1.5 1.7.3 1.3-.4 2.2-1.5 2.2-3.1 0-2-1-3.8-2-5.6-.9-1.5-1.4-2.5-1.4-3.9 0-2.8-1.4-5-4-5zM12 11.5c-1.7 0-3 1.7-3 4s1.3 4 3 4 3-1.7 3-4-1.3-4-3-4zM10.6 5.5a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6zm2.8 0a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6zM10.9 7.7h2.2L12 9.1z',
}

export function OsMark({ os, size = 16, className }: { os?: string; size?: number; className?: string }) {
  const key = os === 'darwin' ? 'apple' : os === 'windows' ? 'windows' : os === 'linux' ? 'linux' : ''
  if (!key) return <Icon name="monitor" size={size} className={className} />
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="currentColor" fillRule="evenodd" d={paths[key]} />
    </svg>
  )
}

// DeviceMark looks the machine up by id, for places that only know its id.
export function DeviceMark({ deviceId, os, size = 16, className }: { deviceId?: string; os?: string; size?: number; className?: string }) {
  const { value: devices } = useDevices()
  const found = os ?? devices?.find((device) => device.id === deviceId)?.os
  return <OsMark os={found} size={size} className={className} />
}
