import type { AgentStatus } from '@vfe/protocol';

import type { HudEvent } from '../../src/content/hud/mount';
import { destroyHud, mountHud } from '../../src/content/hud/mount';

interface HudHarness {
  events: HudEvent[];
  mount: () => void;
  destroy: () => void;
  setStatus: (status: AgentStatus) => void;
  setMessage: (text: string, kind?: 'info' | 'error') => void;
  setTranscript: (text: string) => void;
}

let controller: ReturnType<typeof mountHud> | null = null;

const harness: HudHarness = {
  events: [],
  mount: () => {
    controller = mountHud({ onEvent: (event) => harness.events.push(event) });
  },
  destroy: () => {
    destroyHud();
    controller = null;
  },
  setStatus: (status) => controller?.setStatus(status),
  setMessage: (text, kind) => controller?.setMessage(text, kind),
  setTranscript: (text) => controller?.setTranscript(text),
};

(globalThis as unknown as { VfeHudHarness: HudHarness }).VfeHudHarness = harness;
