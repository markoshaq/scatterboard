import { setBox, unlockWithPassphrase } from '../persist/crypto';
import { t } from '../strings';
import { choice } from './toast';

export function waitForUnlock(root: HTMLElement, onReset: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'lock-screen';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', t('unlockTitle'));

    const card = document.createElement('div');
    card.className = 'lock-card';

    const title = document.createElement('div');
    title.className = 'sp-title';
    title.textContent = t('unlockTitle');

    const help = document.createElement('div');
    help.className = 'ts-head agent-how';
    help.textContent = t('unlockHelp');

    const pass = document.createElement('input');
    pass.type = 'password';
    pass.name = 'unlock-passphrase';
    pass.className = 'qc-input';
    pass.placeholder = t('passphrasePh');
    pass.autocomplete = 'current-password';

    const err = document.createElement('div');
    err.className = 'enc-err';
    err.hidden = true;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qc-add';
    btn.textContent = t('unlockBtn');

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'pop-row stp-danger';
    const resetLab = document.createElement('span');
    resetLab.className = 'pop-label';
    resetLab.textContent = t('setReset');
    reset.appendChild(resetLab);

    card.append(title, help, pass, err, btn, reset);
    wrap.appendChild(card);
    root.appendChild(wrap);

    let busy = false;
    const submit = async () => {
      if (busy || !pass.value) return;
      busy = true;
      btn.disabled = true;
      err.hidden = true;
      try {
        const box = await unlockWithPassphrase(pass.value);
        if (!box) {
          err.textContent = t('unlockFail');
          err.hidden = false;
          pass.select();
          return;
        }
        setBox(box);
        wrap.remove();
        resolve();
      } finally {
        busy = false;
        btn.disabled = false;
      }
    };

    btn.addEventListener('click', () => void submit());
    pass.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    });
    reset.addEventListener('click', () => {
      choice(t('resetAllQ'), t('resetAllAct'), () => void onReset());
    });
    pass.focus();
  });
}
