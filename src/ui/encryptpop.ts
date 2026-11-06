import { t } from '../strings';
import { haspopup, openToolPopup, type ToolPopup } from './popup';

export type EncryptPopupOpts =
  | {
      mode: 'enable';
      onExport(): void;
      onEnable(passphrase: string): Promise<void>;
    }
  | {
      mode: 'disable';
      onDisable(passphrase: string): Promise<boolean>;
    };

export function openEncryptPopup(anchor: HTMLElement | DOMRect, opts: EncryptPopupOpts): ToolPopup {
  haspopup(anchor, 'dialog');
  const node = document.createElement('div');
  node.className = 'qc-body enc-pop';

  const title = document.createElement('div');
  title.className = 'sp-title';
  title.textContent = opts.mode === 'enable' ? t('encEnable') : t('encRemove');
  node.appendChild(title);

  if (opts.mode === 'enable') {
    const warn = document.createElement('div');
    warn.className = 'ts-head agent-how';
    warn.textContent = t('encWarn');
    const expBtn = document.createElement('button');
    expBtn.type = 'button';
    expBtn.className = 'pop-row';
    const expLab = document.createElement('span');
    expLab.className = 'pop-label';
    expLab.textContent = t('encExportFirst');
    expBtn.appendChild(expLab);
    expBtn.addEventListener('click', () => opts.onExport());
    node.append(warn, expBtn);
  }

  const pass = document.createElement('input');
  pass.type = 'password';
  pass.name = 'passphrase';
  pass.className = 'qc-input';
  pass.placeholder = t('passphrasePh');
  pass.autocomplete = opts.mode === 'enable' ? 'new-password' : 'current-password';
  node.appendChild(pass);

  let confirmInput: HTMLInputElement | null = null;
  if (opts.mode === 'enable') {
    confirmInput = document.createElement('input');
    confirmInput.type = 'password';
    confirmInput.name = 'passphrase-confirm';
    confirmInput.className = 'qc-input';
    confirmInput.placeholder = t('passphraseConfirmPh');
    confirmInput.autocomplete = 'new-password';
    node.appendChild(confirmInput);
  }

  const err = document.createElement('div');
  err.className = 'enc-err';
  err.hidden = true;
  node.appendChild(err);

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'qc-add';
  submit.textContent = opts.mode === 'enable' ? t('encEnable') : t('encRemove');
  node.appendChild(submit);

  const pop = openToolPopup(anchor, node, true);

  let busy = false;
  const run = async () => {
    if (busy) return;
    const p1 = pass.value;
    if (!p1) return;
    if (opts.mode === 'enable') {
      if (p1 !== (confirmInput?.value ?? '')) {
        err.textContent = t('encMismatch');
        err.hidden = false;
        return;
      }
      busy = true;
      submit.disabled = true;
      try {
        await opts.onEnable(p1);
        pop.close();
      } catch {
        err.textContent = t('errCrash');
        err.hidden = false;
      } finally {
        busy = false;
        submit.disabled = false;
      }
    } else {
      busy = true;
      submit.disabled = true;
      try {
        const ok = await opts.onDisable(p1);
        if (ok) {
          pop.close();
        } else {
          err.textContent = t('unlockFail');
          err.hidden = false;
          pass.select();
        }
      } catch {
        err.textContent = t('errCrash');
        err.hidden = false;
      } finally {
        busy = false;
        submit.disabled = false;
      }
    }
  };

  submit.addEventListener('click', () => void run());
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      void run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      pop.close();
    }
  };
  pass.addEventListener('keydown', onKey);
  confirmInput?.addEventListener('keydown', onKey);
  pass.focus();
  return pop;
}
