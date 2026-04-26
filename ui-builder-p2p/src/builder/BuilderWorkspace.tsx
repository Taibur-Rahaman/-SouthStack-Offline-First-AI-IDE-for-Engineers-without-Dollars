import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as Y from 'yjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import {
  cloneLastSidebarConversationItem,
  createDemoDoc,
  getInitialDoc,
  getElementsMap,
  moveChildInParent,
  readChildIds,
  readElement,
  ROOT_ID,
  updateElementContent,
  updateElementStyle,
  type UbElementJson,
  type UbElementType,
} from '../crdt/yjsDocument';
import { runImageToUiPipeline, runImageToUiPipelineFromUpload } from '../imageToUi/pipeline';
import { ROW_TOOLBAR_ID } from '../imageToUi/surgicalSlicer';
import { attachP2pAutosave } from '../p2p/p2pAutosave';
import { attachSouthstackWebRtcSync, type P2pRole, type P2pState } from '../p2p/southstackWebRtcSync';

type ServiceHealth = 'online' | 'offline' | 'checking';
type DeviceView = 'desktop' | 'mobile';

async function checkService(url: string): Promise<ServiceHealth> {
  try {
    const res = await fetch(url, { method: 'GET' });
    return res.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}

async function detectLanIpFromIce(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') return null;
  return new Promise((resolve) => {
    const seen = new Set<string>();
    const isUsable = (ip: string) => {
      if (!ip || ip === '127.0.0.1' || ip === '0.0.0.0') return false;
      if (ip.startsWith('169.254.')) return false;
      if (ip.startsWith('10.0.2.')) return false; // emulator/virtual common range
      if (ip.startsWith('10.2.0.')) return false; // user-reported unreachable virtual range
      return true;
    };
    const score = (ip: string) => {
      if (/^192\.168\./.test(ip)) return 0;
      if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 1;
      if (/^10\./.test(ip)) return 2;
      return 9;
    };
    const finalize = () => {
      const candidates = [...seen].filter(isUsable).sort((a, b) => score(a) - score(b));
      resolve(candidates[0] ?? null);
    };

    const pc = new RTCPeerConnection({ iceServers: [] });
    const timeout = setTimeout(() => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      finalize();
    }, 2500);

    pc.createDataChannel('lan-probe');
    pc.onicecandidate = (event) => {
      const cand = event.candidate?.candidate ?? '';
      const m = cand.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
      if (!m) return;
      const ip = m[1];
      if (!ip) return;
      seen.add(ip);
      // Wait until timeout to capture best candidate instead of first.
    };
    void pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => {
        clearTimeout(timeout);
        try {
          pc.close();
        } catch {
          /* ignore */
        }
        finalize();
      });
  });
}

function getResponsiveValue(
  style: UbElementJson['style'],
  key: 'width' | 'height' | 'gap',
  deviceView: DeviceView,
): string | number | undefined {
  if (!style) return undefined;
  const deviceKey = `${key}${deviceView === 'mobile' ? 'Mobile' : 'Desktop'}`;
  const direct = style[key];
  const deviceValue = style[deviceKey];
  if (deviceView === 'mobile' && key === 'width') return deviceValue ?? direct ?? '100%';
  return deviceValue ?? direct;
}

function styleObject(style: UbElementJson['style'], deviceView: DeviceView, type?: UbElementType): CSSProperties {
  if (!style) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined) continue;
    if (k === 'widthDesktop' || k === 'widthMobile' || k === 'heightDesktop' || k === 'heightMobile' || k === 'gapDesktop' || k === 'gapMobile') {
      continue;
    }
    out[k] = typeof v === 'number' ? v : v;
  }
  const resolvedWidth = getResponsiveValue(style, 'width', deviceView);
  const resolvedHeight = getResponsiveValue(style, 'height', deviceView);
  const resolvedGap = getResponsiveValue(style, 'gap', deviceView);
  if (resolvedWidth !== undefined) out.width = resolvedWidth;
  if (resolvedHeight !== undefined) out.height = resolvedHeight;
  if (resolvedGap !== undefined) out.gap = resolvedGap;
  if (deviceView === 'mobile' && type === 'column' && out.width === undefined) out.width = '100%';
  return out as CSSProperties;
}

function cssKeyToCamelCase(key: string): string {
  if (key.trim().startsWith('--')) return key.trim();
  return key
    .trim()
    .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function cssStyleBlockToPatch(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawDecl of block.split(';')) {
    const decl = rawDecl.trim();
    if (!decl) continue;
    const idx = decl.indexOf(':');
    if (idx <= 0) continue;
    const key = cssKeyToCamelCase(decl.slice(0, idx));
    const value = decl.slice(idx + 1).trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function serializeDocToHtmlCss(doc: Y.Doc): { html: string; css: string } {
  const elements = getElementsMap(doc);
  const root = readElement(doc, ROOT_ID);
  if (!root) return { html: '', css: '' };
  const lines: string[] = [];
  const cssLines: string[] = [];
  const indent = (n: number) => '  '.repeat(n);
  const emitNode = (id: string, depth: number) => {
    const el = readElement(doc, id);
    if (!el) return;
    const cls = `ub-el ub-el-${id}`;
    if (el.type === 'section' || el.type === 'column' || el.type === 'row') {
      lines.push(`${indent(depth)}<div data-ub-id="${id}" class="${cls}">`);
      for (const cid of el.children ?? []) emitNode(cid, depth + 1);
      lines.push(`${indent(depth)}</div>`);
    } else if (el.type === 'button') {
      lines.push(`${indent(depth)}<button data-ub-id="${id}" class="${cls}">${el.content ?? 'Button'}</button>`);
    } else if (el.type === 'image') {
      lines.push(`${indent(depth)}<img data-ub-id="${id}" class="${cls}" src="${el.src ?? ''}" alt="${el.content ?? ''}" />`);
    } else {
      lines.push(`${indent(depth)}<div data-ub-id="${id}" class="${cls}">${el.content ?? ''}</div>`);
    }
    if (el.style && Object.keys(el.style).length > 0) {
      const rulesSource = { ...el.style };
      if (id === ROOT_ID) {
        rulesSource.width = '390px';
        rulesSource.height = '693px';
        rulesSource.position = 'relative';
        rulesSource.overflow = 'hidden';
      }
      const rules = Object.entries(rulesSource)
        .map(([k, v]) => `  ${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${String(v)};`)
        .join('\n');
      cssLines.push(`[data-ub-id="${id}"] {\n${rules}\n}`);
    }
  };
  emitNode(ROOT_ID, 0);
  if (elements.size === 0) return { html: '', css: '' };
  return { html: lines.join('\n'), css: cssLines.join('\n\n') };
}

function applyHtmlTemplateToDoc(doc: Y.Doc, html: string): void {
  if (!html.trim()) return;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const nodes = parsed.querySelectorAll('[data-ub-id]');
  nodes.forEach((node) => {
    const id = node.getAttribute('data-ub-id');
    if (!id) return;
    const el = readElement(doc, id);
    if (!el) return;
    if (el.type === 'text' || el.type === 'button' || el.type === 'icon') {
      updateElementContent(doc, id, (node.textContent ?? '').trim());
    }
    if (el.type === 'image') {
      const src = node.getAttribute('src');
      if (src) updateElementStyle(doc, id, { backgroundImage: `url(${src})` });
    }
  });
}

function applyCssTemplateToDoc(doc: Y.Doc, css: string): void {
  const blocks = css.matchAll(/\[data-ub-id="([^"]+)"\]\s*\{([^}]*)\}/g);
  for (const match of blocks) {
    const id = match[1];
    const block = match[2];
    const el = readElement(doc, id);
    if (!el) continue;
    const patch = cssStyleBlockToPatch(block);
    if (Object.keys(patch).length > 0) updateElementStyle(doc, id, patch);
  }
}

function replaceTextInHtml(html: string, fromValue: string, toValue: string): { html: string; changed: boolean } {
  if (!html.trim() || !fromValue) return { html, changed: false };
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const nodes = parsed.querySelectorAll('[data-ub-id]');
  let changed = false;
  nodes.forEach((node) => {
    if (node.children.length > 0) return;
    const current = node.textContent ?? '';
    if (!current) return;
    if (!current.includes(fromValue)) return;
    node.textContent = current.split(fromValue).join(toValue);
    changed = true;
  });
  const nextHtml = (parsed.body.firstElementChild?.outerHTML ?? '').trim();
  return { html: nextHtml || html, changed };
}

function normalizeStyleKey(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, '');
  const aliases: Record<string, string> = {
    colour: 'color',
    fontsize: 'fontSize',
    fontweight: 'fontWeight',
    bgcolor: 'background',
    backgroundcolor: 'background',
    borderradius: 'borderRadius',
    minheight: 'minHeight',
    maxwidth: 'maxWidth',
  };
  if (aliases[key]) return aliases[key];
  return cssKeyToCamelCase(key);
}

function setNodeTextById(html: string, id: string, text: string): { html: string; changed: boolean } {
  if (!html.trim() || !id.trim()) return { html, changed: false };
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const node = parsed.querySelector(`[data-ub-id="${id.trim()}"]`);
  if (!node) return { html, changed: false };
  node.textContent = text;
  const nextHtml = (parsed.body.firstElementChild?.outerHTML ?? '').trim();
  return { html: nextHtml || html, changed: true };
}

function mergeCssRule(css: string, id: string, prop: string, value: string): string {
  const selector = `[data-ub-id="${id}"]`;
  const safeProp = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  const rx = new RegExp(`\\[data-ub-id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"]\\s*\\{([^}]*)\\}`, 'm');
  const match = css.match(rx);
  if (!match) {
    const block = `${selector} {\n  ${safeProp}: ${value};\n}`;
    return css.trim() ? `${css.trim()}\n\n${block}` : block;
  }
  const body = match[1] ?? '';
  const propRx = new RegExp(`(^|\\n)\\s*${safeProp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*[^;]+;?`, 'm');
  const nextBody = propRx.test(body) ? body.replace(propRx, `\n  ${safeProp}: ${value};`) : `${body.trimEnd()}\n  ${safeProp}: ${value};`;
  return css.replace(rx, `${selector} {${nextBody}\n}`);
}

function upsertCssVariables(css: string): string {
  const selector = `[data-ub-id="${ROOT_ID}"]`;
  let out = mergeCssRule(css, ROOT_ID, '--primary-font-weight', '800');
  out = mergeCssRule(out, ROOT_ID, '--primary-letter-spacing', '-0.48px');
  out = mergeCssRule(out, ROOT_ID, '--safe-area-top', '60px');
  out = mergeCssRule(out, ROOT_ID, 'padding-top', 'var(--safe-area-top)');
  const rootBlockRx = new RegExp(`\\[data-ub-id="${ROOT_ID}"]\\s*\\{([\\s\\S]*?)\\}`, 'm');
  const m = out.match(rootBlockRx);
  if (!m) return out;
  let block = m[1] ?? '';
  block = block.replace(/\bfont-weight\s*:\s*[^;]+;/g, 'font-weight: var(--primary-font-weight);');
  block = block.replace(/\bletter-spacing\s*:\s*[^;]+;/g, 'letter-spacing: var(--primary-letter-spacing);');
  out = out.replace(rootBlockRx, `${selector} {${block}}`);
  return out;
}

function applyWildcardDocStyles(doc: Y.Doc, promptLower: string): number {
  let changed = 0;
  const ids = [...getElementsMap(doc).keys()];
  if (promptLower.includes('all buttons') && promptLower.includes('blue')) {
    ids.forEach((id) => {
      const el = readElement(doc, id);
      if (el?.type !== 'button') return;
      updateElementStyle(doc, id, { background: '#2563eb', color: '#ffffff' });
      changed++;
    });
  }
  if (promptLower.includes('round all corners')) {
    ids.forEach((id) => {
      const el = readElement(doc, id);
      const hasVisualBox = !!(el?.style?.background || el?.style?.border);
      if (!el || !hasVisualBox) return;
      updateElementStyle(doc, id, { borderRadius: '12px' });
      changed++;
    });
  }
  if (promptLower.includes('set all text to white')) {
    ids.forEach((id) => {
      const el = readElement(doc, id);
      if (!el) return;
      if ((el.type === 'text' || el.type === 'button' || el.type === 'icon') && (el.content ?? '').trim()) {
        updateElementStyle(doc, id, { color: '#ffffff' });
        changed++;
      }
    });
  }
  return changed;
}

function applyPromptToHtmlCss(
  doc: Y.Doc,
  prompt: string,
  html: string,
  css: string,
  selectedId?: string | null,
): { html: string; css: string; message: string } {
  const p = prompt.toLowerCase().trim();
  if (!p) return { html, css, message: 'No change applied' };
  let nextHtml = html;
  let nextCss = css;
  let changed = false;

  const replaceMatch =
    prompt.match(/change(?:\s+number)?\s+(.+?)\s+to\s+(.+)/i) ||
    prompt.match(/replace\s+(.+?)\s+with\s+(.+)/i);
  if (replaceMatch) {
    const fromValue = replaceMatch[1]?.trim().replace(/^["']|["']$/g, '');
    const toValue = replaceMatch[2]?.trim().replace(/^["']|["']$/g, '');
    if (fromValue && toValue) {
      const replaced = replaceTextInHtml(nextHtml, fromValue, toValue);
      nextHtml = replaced.html;
      changed = changed || replaced.changed;
    }
  }

  const setTextMatch =
    prompt.match(/(?:set|change)\s+([a-zA-Z0-9_:-]+)\s+text\s+to\s+(.+)/i) ||
    prompt.match(/(?:set|change)\s+text\s+of\s+([a-zA-Z0-9_:-]+)\s+to\s+(.+)/i);
  if (setTextMatch) {
    const id = setTextMatch[1]?.trim();
    const text = setTextMatch[2]?.trim().replace(/^["']|["']$/g, '');
    if (id && text) {
      const next = setNodeTextById(nextHtml, id, text);
      nextHtml = next.html;
      changed = changed || next.changed;
    }
  }

  const setStyleMatch =
    prompt.match(/(?:set|change)\s+([a-zA-Z0-9_:-]+)\s+([a-zA-Z][a-zA-Z\s-]*)\s+to\s+(.+)/i) ||
    prompt.match(/(?:set|change)\s+([a-zA-Z][a-zA-Z\s-]*)\s+of\s+([a-zA-Z0-9_:-]+)\s+to\s+(.+)/i);
  if (setStyleMatch) {
    const looksLikeVariantA = /^[a-zA-Z0-9_:-]+$/.test(setStyleMatch[1] ?? '');
    const id = looksLikeVariantA ? setStyleMatch[1]?.trim() : setStyleMatch[2]?.trim();
    const styleKeyRaw = looksLikeVariantA ? setStyleMatch[2] : setStyleMatch[1];
    const styleValue = setStyleMatch[3]?.trim().replace(/^["']|["']$/g, '');
    const styleKey = normalizeStyleKey(styleKeyRaw ?? '');
    if (id && styleKey && styleValue) {
      nextCss = mergeCssRule(nextCss, id, styleKey, styleValue);
      changed = true;
    }
  }

  const genericStyleMatch = prompt.match(/(?:set|change|make)\s+([a-zA-Z][a-zA-Z\s-]*)\s+to\s+(.+)/i);
  if (genericStyleMatch) {
    const rawKey = genericStyleMatch[1]?.trim();
    const rawValue = genericStyleMatch[2]?.trim().replace(/^["']|["']$/g, '');
    const styleKey = normalizeStyleKey(rawKey ?? '');
    if (styleKey && rawValue) {
      const targetId = selectedId && readElement(doc, selectedId) ? selectedId : ROOT_ID;
      nextCss = mergeCssRule(nextCss, targetId, styleKey, rawValue);
      changed = true;
    }
  }

  const wildcardChanges = applyWildcardDocStyles(doc, p);
  if (wildcardChanges > 0) changed = true;

  if (p.includes('apply modern dark') || p.includes('apply shoepower') || p.includes('apply theme')) {
    nextCss = upsertCssVariables(nextCss);
    changed = true;
  }

  if (p.includes('add a new conversation item')) {
    const newId = cloneLastSidebarConversationItem(doc);
    if (newId) {
      const snap = serializeDocToHtmlCss(doc);
      nextHtml = snap.html;
      nextCss = snap.css;
      changed = true;
    }
  }

  if (p.includes('dark')) {
    nextCss += `\n\n[data-ub-id="${ROOT_ID}"] {\n  background: #0f172a;\n  color: #e2e8f0;\n}`;
    changed = true;
  }
  if (p.includes('light')) {
    nextCss += `\n\n[data-ub-id="${ROOT_ID}"] {\n  background: #f8fafc;\n  color: #0f172a;\n}`;
    changed = true;
  }
  if (p.includes('rounded')) {
    nextCss += `\n\n[data-ub-id="${ROOT_ID}"] {\n  border-radius: 16px;\n}`;
    changed = true;
  }
  return {
    html: nextHtml,
    css: nextCss.trim(),
    message: changed
      ? 'Applied changes to UI'
      : 'Prompt not understood. Try: "replace Conversation 5 with Conversation 6" or "set sidebar_item_5 text to Conversation 6" or "set main_action background to #22c55e"',
  };
}

function isDraggableLeaf(t: UbElementType): boolean {
  return t === 'button' || t === 'image' || t === 'text' || t === 'icon';
}

type UbNodeProps = {
  doc: Y.Doc;
  id: string;
  deviceView: DeviceView;
  selectedId: string | null;
  onSelect: (id: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
};

function TextUbLeaf({
  doc,
  id,
  el,
  deviceView,
  editing,
  setEditingId,
}: {
  doc: Y.Doc;
  id: string;
  el: UbElementJson;
  deviceView: DeviceView;
  editing: boolean;
  setEditingId: (v: string | null) => void;
}) {
  const s = styleObject(el.style, deviceView, el.type);
  const editingStyle: CSSProperties = {
    ...s,
    fontWeight: '800',
    letterSpacing: '-0.48px',
  };
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  if (editing) {
    return (
      <div className="ub-node-body">
        <div
          ref={ref}
          className="ub-text-editable ub-leaf-text"
          contentEditable
          suppressContentEditableWarning
          style={editingStyle}
          onBlur={(e) => {
            const t = e.currentTarget.innerText.replace(/\n/g, ' ').trim();
            updateElementContent(doc, id, t);
            setEditingId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              (e.target as HTMLElement).blur();
            }
          }}
        >
          {el.content ?? ''}
        </div>
      </div>
    );
  }

  return (
    <div className="ub-node-body">
      <div
        style={s}
        className="ub-leaf-text"
        onDoubleClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setEditingId(id);
        }}
      >
        {el.content ?? ''}
      </div>
    </div>
  );
}

function LeafBody({
  doc,
  id,
  el,
  deviceView,
  editingId,
  setEditingId,
}: {
  doc: Y.Doc;
  id: string;
  el: UbElementJson;
  deviceView: DeviceView;
  editingId: string | null;
  setEditingId: (v: string | null) => void;
}) {
  const s = styleObject(el.style, deviceView, el.type);
  if (el.type === 'button') {
    return (
      <div className="ub-node-body">
        <button type="button" className="ub-pill-glow" style={s}>
          {el.content ?? 'Button'}
        </button>
      </div>
    );
  }
  if (el.type === 'image') {
    return (
      <div className="ub-node-body">
        {el.src ? (
          <img src={el.src} alt={el.content ?? ''} style={s} />
        ) : (
          <span style={s}>Image</span>
        )}
      </div>
    );
  }
  if (el.type === 'icon') {
    return (
      <div className="ub-node-body ub-icon-body" style={s}>
        <span className="ub-icon-glyph" aria-hidden>
          {el.content ?? '•'}
        </span>
      </div>
    );
  }
  if (el.type === 'text') {
    return <TextUbLeaf doc={doc} id={id} el={el} deviceView={deviceView} editing={editingId === id} setEditingId={setEditingId} />;
  }
  return (
    <div className="ub-node-body">
      <div style={s}>{el.content ?? ''}</div>
    </div>
  );
}

type SortableRowProps = UbNodeProps & { parentId: string };

function SortableUbRow({ doc, id, parentId, deviceView, selectedId, onSelect, editingId, setEditingId }: SortableRowProps) {
  const el = readElement(doc, id);
  const selected = selectedId === id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { parentId },
    disabled: editingId === id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  if (!el) return null;

  const typeClass = `ub-node--${el.type}`;
  const leafClass = isDraggableLeaf(el.type) ? 'ub-leaf' : '';
  const leafKind = isDraggableLeaf(el.type) ? `ub-leaf--${el.type}` : '';

  return (
    <div ref={setNodeRef} style={style} className={`ub-sortable-wrap ub-node ${typeClass} ${leafClass} ${leafKind} ${selected ? 'ub-node--selected' : ''}`}>
      {selected ? (
        <button type="button" className="ub-selection-badge" aria-label="Drag to reorder" {...attributes} {...listeners}>
          ⠿
        </button>
      ) : null}
      <div
        className="ub-node-body"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
        role="presentation"
      >
        {el.type === 'section' || el.type === 'column' || el.type === 'row' ? (
          <ContainerSubtree doc={doc} el={el} deviceView={deviceView} selectedId={selectedId} onSelect={onSelect} editingId={editingId} setEditingId={setEditingId} />
        ) : (
          <LeafBody doc={doc} id={id} el={el} deviceView={deviceView} editingId={editingId} setEditingId={setEditingId} />
        )}
      </div>
    </div>
  );
}

type ContainerSubtreeProps = {
  doc: Y.Doc;
  el: UbElementJson;
  deviceView: DeviceView;
  selectedId: string | null;
  onSelect: (id: string) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
};

function ContainerSubtree({ doc, el, deviceView, selectedId, onSelect, editingId, setEditingId }: ContainerSubtreeProps) {
  const childIds = readChildIds(doc, el.id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const onDragOver = useCallback((e: DragOverEvent) => {
    const sid = e.over?.data.current?.sortable?.containerId;
    setDropTargetId(sid != null ? String(sid) : null);
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      setDropTargetId(null);
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const oldIndex = childIds.indexOf(String(active.id));
      const newIndex = childIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      moveChildInParent(doc, el.id, oldIndex, newIndex);
    },
    [childIds, doc, el.id],
  );

  const onDragCancel = useCallback(() => {
    setActiveId(null);
    setDropTargetId(null);
  }, []);

  const flexStyle = useMemo(() => {
    const base = styleObject(el.style, deviceView, el.type);
    if (el.type === 'column' || el.type === 'section') {
      return { ...base, display: 'flex', flexDirection: 'column' as const };
    }
    if (el.type === 'row') {
      return { ...base, display: 'flex', flexDirection: 'row' as const };
    }
    return base;
  }, [deviceView, el.style, el.type]);

  const sortStrategy = el.type === 'row' ? horizontalListSortingStrategy : verticalListSortingStrategy;

  const drop = dropTargetId === el.id && activeId ? ' ub-drop-target' : '';
  const hostClass =
    el.type === 'column' ? `ub-column-host${drop}` : el.type === 'row' ? `ub-row-host${drop}` : `ub-section-host${drop}`;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className={hostClass} style={flexStyle}>
        <SortableContext id={el.id} items={childIds} strategy={sortStrategy}>
          {childIds.map((cid) => (
            <SortableUbRow
              key={cid}
              doc={doc}
              id={cid}
              parentId={el.id}
              deviceView={deviceView}
              selectedId={selectedId}
              onSelect={onSelect}
              editingId={editingId}
              setEditingId={setEditingId}
            />
          ))}
        </SortableContext>
      </div>
      <DragOverlay dropAnimation={{ sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.35' } } }) }}>
        {activeId ? <OverlayNode doc={doc} id={activeId} deviceView={deviceView} editingId={editingId} setEditingId={setEditingId} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function OverlayNode({
  doc,
  id,
  deviceView,
  editingId,
  setEditingId,
}: {
  doc: Y.Doc;
  id: string;
  deviceView: DeviceView;
  editingId: string | null;
  setEditingId: (v: string | null) => void;
}) {
  const el = readElement(doc, id);
  if (!el) return null;
  return (
    <div className="ub-drag-ghost ub-drag-ghost--overlay ub-node">
      {el.type === 'section' || el.type === 'column' || el.type === 'row' ? (
        <div style={{ ...styleObject(el.style, deviceView, el.type), padding: 8, background: '#121212', borderRadius: 8 }}>Container</div>
      ) : (
        <LeafBody doc={doc} id={id} el={el} deviceView={deviceView} editingId={editingId} setEditingId={setEditingId} />
      )}
    </div>
  );
}

function UbRoot({
  doc,
  deviceView,
  selectedId,
  onSelect,
  editingId,
  setEditingId,
}: Omit<UbNodeProps, 'id'>) {
  const el = readElement(doc, ROOT_ID);
  if (!el) return <p>Missing root</p>;
  return (
    <div
      className={`ub-node ub-node--section ${selectedId === ROOT_ID ? 'ub-node--selected' : ''}`}
      style={styleObject(el.style, deviceView, el.type)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(ROOT_ID);
      }}
      role="presentation"
    >
      {selectedId === ROOT_ID ? (
        <span className="ub-selection-badge ub-selection-badge--root" style={{ cursor: 'default' }} aria-hidden>
          ◆
        </span>
      ) : null}
      <ContainerSubtree doc={doc} el={el} deviceView={deviceView} selectedId={selectedId} onSelect={onSelect} editingId={editingId} setEditingId={setEditingId} />
    </div>
  );
}

function StyleInspector({
  doc,
  deviceView,
  selectedId,
}: {
  doc: Y.Doc;
  deviceView: DeviceView;
  selectedId: string | null;
}) {
  const el = selectedId ? readElement(doc, selectedId) : undefined;
  const [color, setColor] = useState('');
  const [padding, setPadding] = useState('');
  const [weight, setWeight] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [gap, setGap] = useState('');
  const isContainer = el?.type === 'section' || el?.type === 'column' || el?.type === 'row';

  const normalizeSizeInput = (value: string): string | undefined => {
    const raw = value.split('/')[0]?.trim() ?? '';
    if (!raw) return undefined;
    if (/^(auto|fit-content|max-content|min-content|inherit|initial|unset)$/i.test(raw)) return raw.toLowerCase();
    if (/^\d+(\.\d+)?$/.test(raw)) return `${raw}px`;
    return raw;
  };

  const buildResponsivePatch = (): Record<string, string | undefined> => {
    if (!selectedId || !el) return {};
    const patch: Record<string, string | undefined> = {};
    if (padding) patch.padding = padding;
    if (weight) patch.fontWeight = weight;
    const suffix = deviceView === 'mobile' ? 'Mobile' : 'Desktop';
    const normalizedWidth = normalizeSizeInput(width);
    const normalizedHeight = normalizeSizeInput(height);
    const normalizedGap = normalizeSizeInput(gap);
    if (normalizedWidth) {
      patch[`width${suffix}`] = normalizedWidth;
      patch.width = normalizedWidth;
    }
    if (normalizedHeight) {
      patch[`height${suffix}`] = normalizedHeight;
      patch.height = normalizedHeight;
    }
    if (normalizedGap && isContainer) {
      patch[`gap${suffix}`] = normalizedGap;
      patch.gap = normalizedGap;
    }
    if (el.type === 'button') {
      if (color) patch.background = color;
    } else if (color) {
      patch.color = color;
    }
    return patch;
  };

  useEffect(() => {
    if (!el?.style) {
      setColor('');
      setPadding('');
      setWeight('');
      setWidth('');
      setHeight('');
      setGap('');
      return;
    }
    setColor(String(el.style.color ?? ''));
    setPadding(String(el.style.padding ?? el.style.paddingTop ?? ''));
    setWeight(String(el.style.fontWeight ?? ''));
    const suffix = deviceView === 'mobile' ? 'Mobile' : 'Desktop';
    setWidth(String((el.style[`width${suffix}`] ?? el.style.width ?? '') as string));
    setHeight(String((el.style[`height${suffix}`] ?? el.style.height ?? '') as string));
    setGap(String((el.style[`gap${suffix}`] ?? el.style.gap ?? '') as string));
  }, [deviceView, el, selectedId]);

  useEffect(() => {
    if (!selectedId || !el) return;
    const patch = buildResponsivePatch();
    if (Object.keys(patch).length > 0) {
      const t = setTimeout(() => {
        updateElementStyle(doc, selectedId, patch);
      }, 120);
      return () => clearTimeout(t);
    }
  }, [color, padding, weight, width, height, gap, deviceView, doc, selectedId, el]);

  if (!selectedId || !el) return null;

  const apply = () => {
    const patch = buildResponsivePatch();
    updateElementStyle(doc, selectedId, patch);
  };

  return (
    <aside className="ub-inspector" onClick={(e) => e.stopPropagation()}>
      <h2 className="ub-inspector-title">Inspector</h2>
      <p className="ub-inspector-id">
        <code>{selectedId}</code> · {el.type}
      </p>
      <label className="ub-inspector-field">
        <span>{el.type === 'button' ? 'Button fill' : 'Text color'}</span>
        <input type="text" value={color} placeholder="#f8fafc" onChange={(e) => setColor(e.target.value)} />
      </label>
      <label className="ub-inspector-field">
        <span>Padding</span>
        <input type="text" value={padding} placeholder="12px" onChange={(e) => setPadding(e.target.value)} />
      </label>
      <label className="ub-inspector-field">
        <span>Font weight</span>
        <select value={weight} onChange={(e) => setWeight(e.target.value)}>
          <option value="">—</option>
          <option value="500">500</option>
          <option value="600">600</option>
          <option value="700">700</option>
          <option value="800">800</option>
        </select>
      </label>
      <label className="ub-inspector-field">
        <span>{deviceView === 'mobile' ? '📱 Width' : '🖥️ Width'}</span>
        <input type="text" value={width} placeholder={deviceView === 'mobile' ? '100%' : '320px'} onChange={(e) => setWidth(e.target.value)} />
      </label>
      <label className="ub-inspector-field">
        <span>{deviceView === 'mobile' ? '📱 Height' : '🖥️ Height'}</span>
        <input type="text" value={height} placeholder="auto or 120px" onChange={(e) => setHeight(e.target.value)} />
      </label>
      <label className="ub-inspector-field">
        <span>{deviceView === 'mobile' ? '📱 Gap' : '🖥️ Gap'}</span>
        <input type="text" value={gap} placeholder={isContainer ? '10px' : 'Container only'} onChange={(e) => setGap(e.target.value)} disabled={!isContainer} />
      </label>
      <button type="button" className="ub-inspector-apply" onClick={apply}>
        Apply styles (Yjs)
      </button>
      <p className="ub-inspector-hint">Double-click any text block to edit inline. Blur saves to Yjs.</p>
    </aside>
  );
}

function HtmlCssAiPanel({
  doc,
  revision,
  selectedId,
  onBeforeAiCommand,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  doc: Y.Doc;
  revision: number;
  selectedId: string | null;
  onBeforeAiCommand: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const [htmlText, setHtmlText] = useState('');
  const [cssText, setCssText] = useState('');
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatLog, setChatLog] = useState<string[]>([]);

  useEffect(() => {
    const snap = serializeDocToHtmlCss(doc);
    setHtmlText(snap.html);
    setCssText(snap.css);
  }, [doc, revision]);

  const onHtmlChange = useCallback(
    (value: string) => {
      setHtmlText(value);
      applyHtmlTemplateToDoc(doc, value);
    },
    [doc],
  );

  const onCssChange = useCallback(
    (value: string) => {
      setCssText(value);
      applyCssTemplateToDoc(doc, value);
    },
    [doc],
  );

  const onSendPrompt = useCallback(() => {
    const trimmed = chatPrompt.trim();
    if (!trimmed) return;
    onBeforeAiCommand();
    const next = applyPromptToHtmlCss(doc, trimmed, htmlText, cssText, selectedId);
    setChatLog((prev) => [...prev.slice(-5), `You: ${trimmed}`, `AI: ${next.message}`]);
    setChatPrompt('');
    setHtmlText(next.html);
    setCssText(next.css);
    applyHtmlTemplateToDoc(doc, next.html);
    applyCssTemplateToDoc(doc, next.css);
  }, [chatPrompt, cssText, doc, htmlText, onBeforeAiCommand, selectedId]);

  return (
    <aside className="ub-inspector" onClick={(e) => e.stopPropagation()}>
      <h2 className="ub-inspector-title">AI HTML/CSS</h2>
      <p className="ub-inspector-hint">Edit HTML/CSS below; changes apply to canvas in realtime.</p>
      <label className="ub-inspector-field">
        <span>HTML</span>
        <textarea
          value={htmlText}
          onChange={(e) => onHtmlChange(e.target.value)}
          rows={8}
          style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
        />
      </label>
      <label className="ub-inspector-field">
        <span>CSS</span>
        <textarea
          value={cssText}
          onChange={(e) => onCssChange(e.target.value)}
          rows={10}
          style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
        />
      </label>
      <label className="ub-inspector-field">
        <span>AI Chat</span>
        <input type="text" value={chatPrompt} placeholder="e.g. make dark theme and rounded corners" onChange={(e) => setChatPrompt(e.target.value)} />
      </label>
      <button type="button" className="ub-inspector-apply" onClick={onSendPrompt}>
        Send to AI
      </button>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" className="ub-btn-run ub-btn-secondary" disabled={!canUndo} onClick={onUndo}>
          Undo
        </button>
        <button type="button" className="ub-btn-run ub-btn-secondary" disabled={!canRedo} onClick={onRedo}>
          Redo
        </button>
      </div>
      <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
        {chatLog.map((line, idx) => (
          <span key={`${idx}-${line}`} className="ub-inspector-hint">
            {line}
          </span>
        ))}
      </div>
    </aside>
  );
}

export function BuilderWorkspace() {
  const [doc, setDoc] = useState(() => getInitialDoc());
  const [isLongUpload, setIsLongUpload] = useState(false);
  const [debugGroups, setDebugGroups] = useState(false);
  const [deviceView, setDeviceView] = useState<DeviceView>('desktop');
  const [historyStack, setHistoryStack] = useState<Uint8Array[]>([]);
  const [redoStack, setRedoStack] = useState<Uint8Array[]>([]);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>('btn_primary');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sliceMeta, setSliceMeta] = useState<{
    usedFallback: boolean;
    complexity: number;
    refined?: boolean;
  } | null>(null);
  const [sliceBusy, setSliceBusy] = useState(false);
  const [apiHealth, setApiHealth] = useState<ServiceHealth>('checking');
  const [signalHealth, setSignalHealth] = useState<ServiceHealth>('checking');
  const [roomId, setRoomId] = useState('southstack-room');
  const [p2pState, setP2pState] = useState<P2pState>('idle');
  const [p2pDetail, setP2pDetail] = useState('Not connected');
  const [p2pRole, setP2pRole] = useState<P2pRole | null>(null);
  const [shareHost, setShareHost] = useState(() =>
    typeof window !== 'undefined' ? window.location.hostname : 'localhost',
  );
  const [lanHosts, setLanHosts] = useState<string[]>([]);
  const [linkMenuOpen, setLinkMenuOpen] = useState(false);
  const [linkMenuPulse, setLinkMenuPulse] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rtcDetachRef = useRef<null | (() => void)>(null);
  const didHandleUrlJoinRef = useRef(false);
  const isEditing = editingId !== null;
  const signalBaseUrl = useMemo(() => `http://${shareHost}:8787`, [shareHost]);
  const apiBaseUrl = useMemo(() => `http://${shareHost}:8788`, [shareHost]);
  const inviteLink = useMemo(() => {
    const origin = `http://${shareHost}:5174`;
    const params = new URLSearchParams();
    params.set('room', roomId.trim() || 'southstack-room');
    params.set('join', '1');
    return `${origin}/?${params.toString()}`;
  }, [roomId, shareHost]);
  const inviteQrUrl = useMemo(
    () => `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(inviteLink)}`,
    [inviteLink],
  );

  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    doc.on('update', bump);
    return () => {
      doc.off('update', bump);
    };
  }, [doc]);

  useEffect(() => {
    return attachP2pAutosave(doc);
  }, [doc]);

  useEffect(() => {
    return () => {
      rtcDetachRef.current?.();
      rtcDetachRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!linkMenuOpen) return;
    const t = setTimeout(() => setLinkMenuOpen(false), 5000);
    return () => clearTimeout(t);
  }, [linkMenuOpen, linkMenuPulse]);

  useEffect(() => {
    let alive = true;
    const currentHost =
      typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const isLocalhost = currentHost === 'localhost' || currentHost === '127.0.0.1';
    if (!isLocalhost) {
      setShareHost(currentHost);
      return () => {
        alive = false;
      };
    }
    void fetch('http://127.0.0.1:8787/api/southstack/lan-hint', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        const ips = Array.isArray(data?.ips)
          ? data.ips.filter((v: unknown): v is string => typeof v === 'string')
          : [];
        if (ips.length) {
          setLanHosts(ips);
          setShareHost((prev) => (prev === 'localhost' || prev === '127.0.0.1' ? ips[0]! : prev));
        }
      })
      .catch(() => {
        if (alive) setShareHost(currentHost);
      });
    void detectLanIpFromIce().then((ip) => {
      if (!alive || !ip) return;
      setLanHosts((prev) => (prev.includes(ip) ? prev : [...prev, ip]));
      setShareHost((prev) => (prev === 'localhost' || prev === '127.0.0.1' ? ip : prev));
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const [api, signal] = await Promise.all([
        checkService(`${apiBaseUrl}/health`),
        checkService(`${signalBaseUrl}/health`),
      ]);
      if (!alive) return;
      setApiHealth(api);
      setSignalHealth(signal);
    };
    void refresh();
    const t = setInterval(() => {
      void refresh();
    }, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [apiBaseUrl, signalBaseUrl]);

  const applyPipelineResult = useCallback((res: Awaited<ReturnType<typeof runImageToUiPipeline>>) => {
    setDoc(res.doc);
    setHistoryStack([]);
    setRedoStack([]);
    setSliceMeta({
      usedFallback: res.usedFallback,
      complexity: res.complexityScore,
      refined: res.refinedWithSampledGradient,
    });
    setSelectedId('btn_primary');
    setEditingId(null);
  }, []);

  const onPickImage = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !file.type.startsWith('image/')) return;
      setSliceBusy(true);
      const localUrl = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        setIsLongUpload(probe.naturalHeight > probe.naturalWidth * 2);
        URL.revokeObjectURL(localUrl);
      };
      probe.onerror = () => URL.revokeObjectURL(localUrl);
      probe.src = localUrl;
      void runImageToUiPipelineFromUpload(file)
        .then(applyPipelineResult)
        .catch(() => {
          setSliceMeta({ usedFallback: true, complexity: -1 });
        })
        .finally(() => setSliceBusy(false));
    },
    [applyPipelineResult],
  );

  const startP2p = useCallback(
    (role: P2pRole) => {
      const cleanRoomId = roomId.trim();
      if (!cleanRoomId) {
        setP2pState('error');
        setP2pDetail('Room id is required');
        return;
      }
      rtcDetachRef.current?.();
      rtcDetachRef.current = attachSouthstackWebRtcSync(doc, {
        role,
        roomId: cleanRoomId,
        signalBaseUrl,
        onState: (state, detail) => {
          setP2pState(state);
          setP2pDetail(detail ?? state);
        },
      });
      setP2pRole(role);
    },
    [doc, roomId, signalBaseUrl],
  );

  useEffect(() => {
    if (didHandleUrlJoinRef.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room')?.trim();
    const join = params.get('join');
    if (room) setRoomId(room);
    if (room && join === '1') {
      didHandleUrlJoinRef.current = true;
      setTimeout(() => startP2p('auto'), 50);
      return;
    }
    didHandleUrlJoinRef.current = true;
  }, [startP2p]);

  const disconnectP2p = useCallback(() => {
    rtcDetachRef.current?.();
    rtcDetachRef.current = null;
    setP2pState('closed');
    setP2pDetail('Disconnected');
    setP2pRole(null);
  }, []);

  const pulseLinkMenu = useCallback(() => setLinkMenuPulse((v) => v + 1), []);

  const copyInviteLink = useCallback(() => {
    void navigator.clipboard?.writeText(inviteLink);
    setP2pDetail('Invite link copied');
  }, [inviteLink]);

  const snapshotCurrentDoc = useCallback(() => Y.encodeStateAsUpdate(doc), [doc]);

  const onBeforeAiCommand = useCallback(() => {
    const snap = snapshotCurrentDoc();
    setHistoryStack((prev) => [...prev, snap]);
    setRedoStack([]);
  }, [snapshotCurrentDoc]);

  const onUndoAi = useCallback(() => {
    setHistoryStack((prev) => {
      if (prev.length === 0) return prev;
      const restore = prev[prev.length - 1]!;
      setRedoStack((redoPrev) => [...redoPrev, snapshotCurrentDoc()]);
      const nextDoc = new Y.Doc();
      Y.applyUpdate(nextDoc, restore);
      setDoc(nextDoc);
      return prev.slice(0, -1);
    });
  }, [snapshotCurrentDoc]);

  const onRedoAi = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const restore = prev[prev.length - 1]!;
      setHistoryStack((historyPrev) => [...historyPrev, snapshotCurrentDoc()]);
      const nextDoc = new Y.Doc();
      Y.applyUpdate(nextDoc, restore);
      setDoc(nextDoc);
      return prev.slice(0, -1);
    });
  }, [snapshotCurrentDoc]);

  const downloadCode = useCallback(() => {
    const snap = serializeDocToHtmlCss(doc);
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
${snap.css}
    </style>
  </head>
  <body>
${snap.html}
  </body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ui-export.html';
    a.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  return (
    <div
      className={`ub-workspace ${debugGroups ? 'debug-active' : ''}`}
      data-is-editing={isEditing ? 'true' : 'false'}
      onClick={() => {
        setSelectedId(null);
        setEditingId(null);
      }}
    >
      <h1>Builder workspace</h1>
      <p className="ub-toolbar">
        <button
          type="button"
          className={`ub-btn-run ub-btn-secondary ${deviceView === 'desktop' ? 'ub-btn-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setDeviceView('desktop');
          }}
        >
          🖥️ Desktop
        </button>
        <button
          type="button"
          className={`ub-btn-run ub-btn-secondary ${deviceView === 'mobile' ? 'ub-btn-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setDeviceView('mobile');
          }}
        >
          📱 Mobile
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="ub-input-file" onChange={onPickImage} />
        <button type="button" className="ub-btn-run" disabled={sliceBusy} onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
          {sliceBusy ? 'Processing…' : 'Upload image'}
        </button>
        <button
          type="button"
          className={`ub-btn-run ub-btn-secondary ${debugGroups ? 'ub-btn-active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setDebugGroups((v) => !v);
          }}
        >
          Debug Groups
        </button>
        <button
          type="button"
          className="ub-btn-run ub-btn-secondary"
          onClick={(e) => {
            e.stopPropagation();
            downloadCode();
          }}
        >
          Download Code
        </button>
        {sliceMeta ? (
          <span className="ub-slice-meta">
            {sliceMeta.refined ? 'Refined hero + sampled gradient' : sliceMeta.usedFallback ? 'Fallback / heavy slice' : 'Projection slice'} · score{' '}
            {sliceMeta.complexity}
          </span>
        ) : null}
      </p>
      <p className="ub-toolbar ub-toolbar--p2p">
        <input
          type="text"
          className="ub-room-input"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="room id"
          onClick={(e) => e.stopPropagation()}
        />
        <div className="ub-link-menu-wrap" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="ub-btn-run"
            onClick={() => {
              setLinkMenuOpen((prev) => !prev);
              pulseLinkMenu();
            }}
          >
            Link device
          </button>
          {linkMenuOpen ? (
            <div className="ub-link-menu" onMouseMove={pulseLinkMenu} onClick={pulseLinkMenu}>
              <div className="ub-link-menu-actions">
                <button type="button" className="ub-btn-run" onClick={() => startP2p('host')}>
                  Host room
                </button>
                <button type="button" className="ub-btn-run" onClick={() => startP2p('guest')}>
                  Join room
                </button>
                <button type="button" className="ub-btn-run" onClick={() => startP2p('auto')}>
                  Auto host/join
                </button>
                <button type="button" className="ub-btn-run ub-btn-secondary" onClick={disconnectP2p}>
                  Disconnect
                </button>
              </div>
              <div className="ub-link-menu-share">
                <select
                  className="ub-link-field"
                  value={shareHost}
                  onChange={(e) => setShareHost(e.target.value)}
                >
                  {[shareHost, ...lanHosts].filter((v, i, arr) => arr.indexOf(v) === i).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <input readOnly value={inviteLink} className="ub-link-field" />
                <button type="button" className="ub-btn-run ub-btn-secondary" onClick={copyInviteLink}>
                  Copy link
                </button>
              </div>
              <img className="ub-link-qr" src={inviteQrUrl} alt="Device link QR" />
            </div>
          ) : null}
        </div>
        <span className={`ub-health-pill ub-health-pill--${p2pState === 'connected' ? 'online' : p2pState === 'error' ? 'offline' : 'checking'}`}>
          P2P {p2pRole ? `${p2pRole}` : 'idle'}: {p2pState}
        </span>
        <span className="ub-health-hint">{p2pDetail}</span>
      </p>
      <p className="ub-system-status">
        <span className={`ub-health-pill ub-health-pill--${apiHealth}`}>Image API: {apiHealth}</span>
        <span className={`ub-health-pill ub-health-pill--${signalHealth}`}>Signaling: {signalHealth}</span>
        <span className="ub-health-hint">Run `npm run start:all` inside `ui-builder-p2p` to launch full system.</span>
      </p>
      <div className="ub-workbench" onClick={(e) => e.stopPropagation()}>
        <div
          className={`ub-canvas ${deviceView === 'mobile' ? 'ub-canvas--mobile' : 'ub-canvas--desktop'} ${isLongUpload ? 'ub-canvas--long' : ''}`}
          style={isLongUpload ? { maxHeight: '78vh', overflowY: 'auto' } : undefined}
        >
          <UbRoot
            key={revision}
            doc={doc}
            deviceView={deviceView}
            selectedId={selectedId}
            onSelect={setSelectedId}
            editingId={editingId}
            setEditingId={setEditingId}
          />
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <StyleInspector doc={doc} deviceView={deviceView} selectedId={selectedId} />
          <HtmlCssAiPanel
            doc={doc}
            revision={revision}
            selectedId={selectedId}
            onBeforeAiCommand={onBeforeAiCommand}
            onUndo={onUndoAi}
            onRedo={onRedoAi}
            canUndo={historyStack.length > 0}
            canRedo={redoStack.length > 0}
          />
        </div>
      </div>
      <p className="ub-footnote">
        Reorder: <code>moveChildInParent</code> on each container&apos;s <code>onDragEnd</code> · Toolbar row <code>{ROW_TOOLBAR_ID}</code>
      </p>
    </div>
  );
}
