import { vi } from 'vitest'

// Mock posthog-js in test environments to avoid DOM/window dependency issues
vi.mock('posthog-js', () => {
  const dummyPosthog = {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    on: vi.fn(),
    people: {
      set: vi.fn()
    }
  }
  return {
    default: dummyPosthog,
    ...dummyPosthog
  }
})
