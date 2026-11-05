import { outro } from '../ui/popup';

// Shared full-screen overlay for the dedicated editors at #/e/<id>:
// dimmed board behind, surface centered, own floating chrome. z-index
// sits below tool-pop (60) so popups opened inside editors still work.
export interface EditorScrim {
  node: HTMLElement;
  close(): void;
}

export function openScrim(cls: string): EditorScrim {
  const node = document.createElement('div');
  node.className = `ed-scrim ${cls}`;
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  document.body.appendChild(node);
  return {
    node,
    close() {
      outro(node);
    },
  };
}
