import type { Element, EmbedKind, TypeContent } from '../state/schema';
import { embedDoc } from '../state/schema';
import { t } from '../strings';
import { EMBED_ALLOW, embedSrc, hostOf, urlTitle } from '../ui/embeds';
import { ICONS } from '../ui/icons';
import { parseUrlText } from '../ui/files';
import type { CardCtx } from './factory';
import type { CardView } from './note';
import { cardBg } from '../ui/theme';

interface Linkish {
  url: string;
  title: string;
  caption: string;
  showPreview: boolean;
  desc?: string;
  image?: string;
}

function read(el: Element): Linkish | null {
  const c = el.content;
  if ('link' in c) return c.link;
  if ('embed' in c) return c.embed;
  return null;
}

const PLACEHOLDER: Record<EmbedKind, string> = {
  audio: t('pasteAudioPh'),
  map: t('pasteMapPh'),
  video: t('pasteVideoPh'),
};

const KIND_ICON: Record<EmbedKind, string> = {
  audio: ICONS.audio,
  map: ICONS.map,
  video: ICONS.video,
};

// Link cards and audio/map/video embeds share one card family: a media
// block on top (hero placeholder or embed thumbnail), URL chip, title and
// caption below. Empty cards show a paste-a-link input.
export class LinkCard implements CardView {
  id: string;
  node: HTMLElement;
  editing = false;
  private ctx: CardCtx;
  private kind: EmbedKind | null;
  private emptyEl: HTMLElement;
  private urlInput: HTMLInputElement;
  private heroEl: HTMLElement;
  private glyphEl: HTMLElement;
  private playBtn: HTMLButtonElement;
  private frame: HTMLIFrameElement | null = null;
  private chipEl: HTMLElement;
  private titleEl: HTMLElement;
  private descEl: HTMLElement;
  private capEl: HTMLElement;
  private heroImg: HTMLImageElement | null = null;
  private handle: HTMLElement;
  playing = false;
  private noPreview = false;
  private selected = false;
  private downSelected = false;
  private downAt = { x: 0, y: 0 };
  private lastTitle: string | null = null;
  private lastCap: string | null = null;

  constructor(el: Element, ctx: CardCtx) {
    this.id = el.id;
    this.ctx = ctx;
    this.kind = embedDoc(el)?.kind ?? null;
    const isEmbed = this.kind !== null;
    this.node = document.createElement('div');
    this.node.className = `card ${isEmbed ? 'embed' : 'link'}`;
    this.node.dataset.id = el.id;

    this.emptyEl = document.createElement('div');
    this.emptyEl.className = 'lk-empty';
    this.urlInput = document.createElement('input');
    this.urlInput.type = 'url';
    this.urlInput.name = 'card-link-url';
    this.urlInput.className = 'lk-url-input';
    this.urlInput.placeholder = this.kind ? PLACEHOLDER[this.kind] : t('pasteLinkPh');
    this.urlInput.dataset.noclick = '1';
    this.emptyEl.appendChild(this.urlInput);

    this.heroEl = document.createElement('div');
    this.heroEl.className = 'lk-hero';
    this.glyphEl = document.createElement('div');
    this.glyphEl.className = 'lk-glyph';
    this.glyphEl.innerHTML = this.kind ? KIND_ICON[this.kind] : ICONS.link;
    this.playBtn = document.createElement('button');
    this.playBtn.type = 'button';
    this.playBtn.className = 'em-play';
    this.playBtn.innerHTML = ICONS.play;
    this.playBtn.dataset.noclick = '1';
    this.heroEl.append(this.glyphEl, this.playBtn);
    if (!isEmbed) this.playBtn.style.display = 'none';

    const meta = document.createElement('div');
    meta.className = 'lk-meta';
    this.chipEl = document.createElement('div');
    this.chipEl.className = 'lk-chip';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'lk-title';
    this.titleEl.dataset.ph = t('addTitle');
    this.descEl = document.createElement('div');
    this.descEl.className = 'lk-desc';
    this.capEl = document.createElement('div');
    this.capEl.className = 'lk-cap';
    this.capEl.dataset.ph = t('captionPlaceholder');
    meta.append(this.chipEl, this.titleEl, this.descEl, this.capEl);

    this.handle = document.createElement('div');
    this.handle.className = 'resize-handle';
    this.handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.ctx.events.onResizeHandle(this.id, e);
    });
    this.node.append(this.emptyEl, this.heroEl, meta, this.handle);

    this.urlInput.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.urlInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commitUrl();
      } else if (e.key === 'Escape') {
        this.urlInput.value = '';
        this.urlInput.blur();
      }
    });
    this.urlInput.addEventListener('blur', () => this.commitUrl());

    this.node.addEventListener('pointerdown', (e) => {
      this.downSelected = this.selected;
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    this.chipEl.addEventListener('click', (e) => {
      const c = this.content();
      if (!this.downSelected || !c?.url || this.dragged(e)) return;
      window.open(c.url, '_blank');
    });
    this.titleEl.addEventListener('click', (e) => {
      if (this.downSelected && !this.editing && !this.dragged(e)) this.ctx.events.onEditField(this.id, 'title');
    });
    this.capEl.addEventListener('click', (e) => {
      if (this.downSelected && !this.editing && !this.dragged(e)) this.ctx.events.onEditField(this.id, 'caption');
    });
    this.playBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.play();
    });

    const onFieldInput = (field: 'title' | 'caption') => {
      const c = this.content();
      if (!c) return;
      const v = field === 'title' ? this.titleEl.innerText.replace(/\n/g, '') : this.capEl.innerText.replace(/\n/g, '');
      this.dispatch(field === 'title' ? { ...c, title: v } : { ...c, caption: v });
    };
    this.titleEl.addEventListener('input', () => onFieldInput('title'));
    this.capEl.addEventListener('input', () => onFieldInput('caption'));
    for (const f of [this.titleEl, this.capEl]) {
      f.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.ctx.events.onEditEnd(this.id);
        }
      });
      f.addEventListener('blur', () => {
        if (this.editing) this.ctx.events.onEditEnd(this.id);
      });
    }

    this.ctx.events.observeNode?.(this);
    this.update(el);
  }

  private dragged(e: MouseEvent): boolean {
    return Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4;
  }

  private content(): Linkish | null {
    const el = this.ctx.doc.elements[this.id];
    return el ? read(el) : null;
  }

  private dispatch(patch: Linkish) {
    const el = this.ctx.doc.elements[this.id];
    if (!el) return;
    const content: TypeContent =
      'link' in el.content ? { link: { ...patch } } : { embed: { kind: this.kind!, ...patch } };
    this.ctx.events.onContent(this.id, content);
  }

  private commitUrl() {
    const c = this.content();
    const url = parseUrlText(this.urlInput.value);
    if (c?.url || !url) {
      this.urlInput.value = '';
      return;
    }
    this.dispatch({ ...c!, url, title: urlTitle(url) ?? hostOf(url) });
    this.urlInput.value = '';
    if (this.editing) this.ctx.events.onEditEnd(this.id);
  }

  private play() {
    const c = this.content();
    if (!this.kind || !c?.url) return;
    const src = embedSrc(this.kind, c.url);
    if (!src) return;
    this.playing = true;
    this.renderHero();
  }

  private renderHero() {
    const c = this.content();
    const url = c?.url ?? '';
    const src = this.kind && url ? embedSrc(this.kind, url) : null;
    this.noPreview = !!this.kind && !!url && !src;
    this.node.classList.toggle('no-preview', this.noPreview);
    // Embeds need the network: offline shows a placeholder instead of
    // the play affordance or a mounting iframe.
    if (this.kind && url && !navigator.onLine) {
      this.frame?.remove();
      this.frame = null;
      this.playing = false;
      this.glyphEl.style.display = 'none';
      this.playBtn.style.display = 'none';
      let off = this.heroEl.querySelector<HTMLElement>('.em-offline');
      if (!off) {
        off = document.createElement('div');
        off.className = 'em-offline';
        this.heroEl.appendChild(off);
      }
      off.textContent = t('embedOffline');
      return;
    }
    this.heroEl.querySelector('.em-offline')?.remove();
    // Unfurled link cards show the remote hero image instead of the glyph.
    const img = !this.kind ? c?.image : undefined;
    if (img) {
      if (!this.heroImg) {
        this.heroImg = document.createElement('img');
        this.heroImg.className = 'lk-hero-img';
        this.heroImg.alt = '';
        this.heroImg.draggable = false;
        this.heroEl.insertBefore(this.heroImg, this.glyphEl);
      }
      if (this.heroImg.src !== img) this.heroImg.src = img;
      this.heroImg.style.display = '';
      this.glyphEl.style.display = 'none';
    } else {
      this.heroImg?.remove();
      this.heroImg = null;
      this.glyphEl.style.display = '';
    }
    if (this.playing && src) {
      if (this.heroImg) this.heroImg.style.display = 'none';
      if (!this.frame) {
        this.frame = document.createElement('iframe');
        this.frame.className = 'em-frame';
        this.frame.allow = EMBED_ALLOW;
        this.frame.allowFullscreen = true;
        this.heroEl.insertBefore(this.frame, this.glyphEl);
      }
      if (this.frame.src !== src) this.frame.src = src;
      this.glyphEl.style.display = 'none';
      this.playBtn.style.display = 'none';
      return;
    }
    // Not playing (or src lost while playing): clear the flag so the
    // layer can cull this card again.
    this.frame?.remove();
    this.frame = null;
    this.playing = false;
    if (!img) this.glyphEl.style.display = '';
    this.playBtn.style.display = this.kind && url && src ? '' : 'none';
  }

  update(el: Element) {
    const s = this.node.style;
    s.left = `${el.x}px`;
    s.top = `${el.y}px`;
    s.width = `${el.w ?? 280}px`;
    s.background = cardBg(el.color);
    const c = read(el);
    if (!c) return;
    const hasUrl = !!c.url;
    this.node.classList.toggle('empty', !hasUrl);
    this.node.classList.toggle('has-cap', !!c.caption);
    this.heroEl.style.display = hasUrl && c.showPreview ? '' : 'none';
    if (!hasUrl) {
      // Clearing the url hides the hero; drop a live embed frame so it
      // does not keep playing audio invisibly.
      this.frame?.remove();
      this.frame = null;
      this.playing = false;
      return;
    }
    const host = hostOf(c.url);
    if (this.chipEl.textContent !== host) {
      this.chipEl.textContent = host;
      this.chipEl.title = c.url;      this.chipEl.setAttribute('aria-label', c.url);
    }
    if (!this.editing && c.title !== this.lastTitle) {
      this.titleEl.textContent = c.title;
      this.lastTitle = c.title;
    }
    if (!this.editing && c.caption !== this.lastCap) {
      this.capEl.textContent = c.caption;
      this.lastCap = c.caption;
    }
    const desc = c.desc ?? '';
    if (this.descEl.textContent !== desc) this.descEl.textContent = desc;
    this.descEl.style.display = desc ? '' : 'none';
    this.renderHero();
  }

  setSelected(on: boolean) {
    this.selected = on;
    this.node.classList.toggle('selected', on);
  }

  setHandle(on: boolean) {
    this.node.classList.toggle('handle', on);
  }

  private focusField(field?: string) {
    const c = this.content();
    const hasUrl = !!c?.url;
    if (!hasUrl) {
      this.urlInput.focus();
      return;
    }
    const target = field === 'caption' ? this.capEl : this.titleEl;
    target.contentEditable = 'true';
    target.focus();
    const sel = getSelection()!;
    sel.selectAllChildren(target);
    sel.collapseToEnd();
  }

  beginEdit(_pos?: { x: number; y: number }, field?: string) {
    this.editing = true;
    this.node.classList.add('editing');
    this.focusField(field);
  }

  endEdit(): string {
    this.editing = false;
    this.node.classList.remove('editing');
    this.titleEl.contentEditable = 'false';
    this.capEl.contentEditable = 'false';
    if (this.node.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    getSelection()?.removeAllRanges();
    return '';
  }

  destroy() {
    this.ctx.events.unobserveNode?.(this);
    this.node.remove();
  }
}
