import { createHash } from 'node:crypto';

export const SYSTEMS = {
  A1: ['风格本体与立场', 'Identity and stance'],
  B1: ['色彩语法', 'Color grammar'], B2: ['光线逻辑', 'Lighting logic'],
  B3: ['构图与空间', 'Composition and space'], B4: ['尺度关系', 'Scale relations'],
  C1: ['造型与线质', 'Shape and stroke'], C2: ['边缘控制', 'Edge hierarchy'],
  C3: ['完成度分配', 'Finish allocation'], C4: ['媒介与肌理', 'Medium and texture'],
  D1: ['通用主体融入规则', 'Subject integration'], E1: ['信息密度', 'Information density'],
  E2: ['视觉锚点', 'Visual anchors'], E3: ['张力关系', 'Visual tension']
};
export const CATEGORIES = ['character', 'product', 'space', 'poster', 'typography'];
const fail = message => { throw new Error(message); };
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const numericTokens = x => (x.match(/\d+(?:\.\d+)?/g) || []).sort().join('|');
const strings = x => typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strings) : object(x) ? Object.values(x).flatMap(strings) : [];
function pair(value, path) {
  if (!object(value) || !nonempty(value.zh) || !nonempty(value.en)) fail(`${path}: requires zh and en`);
  if (numericTokens(value.zh) !== numericTokens(value.en)) fail(`${path}: bilingual numbers differ`);
}
function exactKeys(value, keys, path) {
  if (!object(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail(`${path}: invalid fields`);
}
function finiteRatio(x) { return Number.isFinite(x) && x >= 0 && x <= 1; }
export function canonical(x) {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (object(x)) return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  return JSON.stringify(x);
}
export const hash = x => createHash('sha256').update(canonical(x)).digest('hex');
export const hanCount = x => [...x].filter(c => /\p{Script=Han}/u.test(c)).length;

export function validateProfile(p) {
  exactKeys(p, ['schema_version', 'id', 'name', 'status', 'sources', 'excluded_source_elements', 'style', 'bridge'], 'profile');
  if (p.schema_version !== '1.0' || !/^[A-Z][A-Z0-9-]+$/.test(p.id)) fail('profile: invalid version or id');
  if (!['fixture', 'draft', 'reviewed'].includes(p.status)) fail('profile: invalid status');
  pair(p.name, 'name');
  if (!Array.isArray(p.sources) || !p.sources.length) fail('sources required');
  for (const s of p.sources) {
    if (!nonempty(s.id) || !nonempty(s.location) || typeof s.viewed !== 'boolean') fail('invalid source');
    if (p.status === 'reviewed' && (!s.viewed || !/^[a-f0-9]{64}$/i.test(s.sha256 || ''))) fail('reviewed source requires viewed=true and sha256');
  }
  if (new Set(p.sources.map(s => s.id)).size !== p.sources.length) fail('duplicate source id');
  if (!Array.isArray(p.excluded_source_elements)) fail('excluded list required');
  p.excluded_source_elements.forEach((v, i) => pair(v, `excluded[${i}]`));
  const st = p.style;
  exactKeys(st, ['rules', 'parameters', 'anchors', 'negative', 'concise_zh'], 'style');
  exactKeys(st.rules, Object.keys(SYSTEMS), 'rules');
  for (const [id, r] of Object.entries(st.rules)) {
    exactKeys(r, ['state', 'kind', 'confidence', 'source_ids', 'zh', 'en'], id);
    pair(r, id);
    if (!['active', 'not_applicable', 'unknown'].includes(r.state)) fail(`${id}: invalid state`);
    if (!['observation', 'inference', 'user_requirement', 'design_choice'].includes(r.kind)) fail(`${id}: invalid evidence kind`);
    if (!finiteRatio(r.confidence)) fail(`${id}: confidence out of range`);
    if (!Array.isArray(r.source_ids) || r.source_ids.some(s => !p.sources.some(v => v.id === s))) fail(`${id}: unknown source id`);
    if (r.kind === 'observation' && (!r.source_ids.length || r.source_ids.some(s => !p.sources.find(v => v.id === s).viewed))) fail(`${id}: observation requires viewed source`);
    if (p.status === 'reviewed' && r.state === 'unknown') fail(`${id}: unresolved rule in reviewed profile`);
  }
  const q = st.parameters;
  exactKeys(q, ['palette', 'negative_space', 'subject_area', 'light_temperature_k'], 'parameters');
  if (!Array.isArray(q.palette) || !q.palette.length) fail('palette required');
  for (const c of q.palette) {
    exactKeys(c, ['role', 'hex', 'ratio'], 'palette color');
    if (!['dominant', 'secondary', 'accent'].includes(c.role) || !/^#[a-f0-9]{6}$/i.test(c.hex) || !finiteRatio(c.ratio)) fail('invalid palette color');
  }
  if (Math.abs(q.palette.reduce((s, c) => s + c.ratio, 0) - 1) > 1e-6) fail('palette ratios must sum to 1');
  if (new Set(q.palette.map(c => c.hex.toUpperCase())).size !== q.palette.length) fail('duplicate palette color');
  for (const k of ['negative_space', 'subject_area']) {
    const v = q[k];
    if (v !== null && (!Array.isArray(v) || v.length !== 2 || !v.every(finiteRatio) || v[0] > v[1])) fail(`${k}: invalid range`);
  }
  const t = q.light_temperature_k;
  if (t !== null && (!Array.isArray(t) || t.length !== 2 || !t.every(v => Number.isFinite(v) && v > 0) || t[0] > t[1])) fail('invalid temperature');
  if (!Array.isArray(st.anchors) || st.anchors.length !== 5 || st.anchors.some(k => !st.rules[k] || st.rules[k].state !== 'active') || new Set(st.anchors).size !== 5) fail('five distinct active anchors required');
  if (!Array.isArray(st.negative) || !st.negative.length) fail('negative guards required');
  st.negative.forEach((v, i) => pair(v, `negative[${i}]`));
  if (!nonempty(st.concise_zh) || hanCount(st.concise_zh) < 50 || hanCount(st.concise_zh) > 105) fail('concise style core must contain 50–105 Han characters');
  if (strings(st).some(v => /\{\{|\}\}/.test(v))) fail('style must not contain placeholders');
  const styleText = canonical(st).toLowerCase();
  for (const v of p.excluded_source_elements) {
    for (const term of [v.zh, v.en]) {
      if (styleText.includes(term.toLowerCase())) fail(`source content leaks into style: ${term}`);
    }
  }
  exactKeys(p.bridge, ['color', 'material', 'space', 'focus'], 'bridge');
  for (const k of ['color', 'material', 'space']) pair(p.bridge[k], `bridge.${k}`);
  exactKeys(p.bridge.focus, CATEGORIES, 'bridge.focus');
  for (const c of CATEGORIES) pair(p.bridge.focus[c], `bridge.focus.${c}`);
  return p;
}

export function validateTask(t) {
  exactKeys(t, ['mode', 'category', 'aspect_ratio', 'series_anchor', 'frames'], 'task');
  if (!['TEMPLATE', 'SWITCH', 'EXPAND', 'TRANSFER'].includes(t.mode)) fail('invalid mode');
  if (!CATEGORIES.includes(t.category)) fail('invalid category');
  if (!/^\d{1,3}:\d{1,3}$/.test(t.aspect_ratio) || t.aspect_ratio.split(':').some(v => +v === 0)) fail('invalid aspect ratio');
  pair(t.series_anchor, 'series_anchor');
  if (!Array.isArray(t.frames) || !t.frames.length || t.frames.length > 9) fail('requires 1–9 frames');
  if (t.mode !== 'EXPAND' && t.frames.length !== 1) fail('only EXPAND accepts multiple frames');
  if (t.mode === 'EXPAND' && t.frames.length < 2) fail('EXPAND requires at least two frames');
  for (const [i, f] of t.frames.entries()) {
    exactKeys(f, ['subject', 'action', 'environment', 'detail', 'text', 'layout'], `frame[${i}]`);
    for (const k of Object.keys(f)) {
      pair(f[k], `frame[${i}].${k}`);
      if (t.mode !== 'TEMPLATE' && strings(f[k]).some(v => /\{\{|\}\}/.test(v))) fail('unresolved theme placeholder');
    }
  }
  return t;
}
const ZH_KEYS = {
  meta: '元数据', style_dna_locked: '风格基因锁死区', adaptation_bridge: '主题自适应转译桥', theme_slot: '主题可变插槽区',
  schema_version: '架构版本', id: '风格编号', name: '风格名称', mode: '模式', status: '证据状态', style_hash: '风格哈希', series_hash: '系列锚点哈希', excluded_source_elements: '原图剥离黑名单',
  rules: '分系统规则', parameters: '共享数值参数', anchors: '风格一致性五锚点', negative: '防漂移禁令', concise_zh: '中文短版固定核',
  state: '适用状态', kind: '证据类别', confidence: '置信度', source_ids: '来源编号', description: '描述',
  palette: '调色板', role: '色彩角色', hex: '色值', ratio: '比例', negative_space: '留白面积区间', subject_area: '主体面积区间', light_temperature_k: '光源色温开尔文区间',
  category: '主体品类', color: '色域转译', material: '材质转译', space: '空间转译', focus: '细节重心',
  subject: '核心主体', action: '状态动作', environment: '环境场域', detail: '焦点细节', text: '准确文案', layout: '目标版式', aspect_ratio: '画幅比例', series_anchor: '系列内容锚点'
};
function project(x, lang) {
  if (Array.isArray(x)) return x.map(v => project(v, lang));
  if (!object(x)) return x;
  if (Object.hasOwn(x, 'zh') && Object.hasOwn(x, 'en')) {
    const rest = Object.fromEntries(Object.entries(x).filter(([k]) => !['zh', 'en'].includes(k)));
    return Object.keys(rest).length ? project({ ...rest, description: x[lang] }, lang) : x[lang];
  }
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [lang === 'zh' ? (ZH_KEYS[k] || k) : k, project(v, lang)]));
}
function parameterText(q, lang) {
  const palette = q.palette.map(c => `${c.role} ${c.hex} ${+(c.ratio * 100).toFixed(4)}%`).join(', ');
  const range = v => v === null ? (lang === 'zh' ? '未测定，不推测' : 'unmeasured; do not invent') : v.map(x => +(x * 100).toFixed(4)).join('–') + '%';
  return lang === 'zh'
    ? `调色板：${palette}。留白面积：${range(q.negative_space)}；主体面积：${range(q.subject_area)}；色温：${q.light_temperature_k?.join('–') ?? '未测定'} K。`
    : `Palette: ${palette}. Negative space: ${range(q.negative_space)}; subject area: ${range(q.subject_area)}; temperature: ${q.light_temperature_k?.join('–') ?? 'unmeasured'} K.`;
}
function natural(st, bridge, theme, lang) {
  const sentence = id => `${SYSTEMS[id][lang === 'zh' ? 0 : 1]}: ${st.rules[id][lang]}`;
  const stop = lang === 'zh' ? '。' : '\n';
  const sep = lang === 'zh' ? '；' : '; ';
  const p1 = ['A1', 'C1', 'C2', 'C3', 'C4', 'D1'].map(sentence).join(stop);
  const p2 = Object.entries(theme).map(([k, v]) => `${lang === 'zh' ? ZH_KEYS[k] || k : k}: ${typeof v === 'string' ? v : v[lang]}`).join(sep)
    + stop + ['color', 'material', 'space', 'focus'].map(k => bridge[k][lang]).join(stop);
  const p3 = ['B1', 'B2', 'B3', 'B4', 'E1', 'E2', 'E3'].map(sentence).join(stop)
    + stop + parameterText(st.parameters, lang) + stop
    + (lang === 'zh' ? '禁止：' : 'Avoid: ') + st.negative.map(v => v[lang]).join(sep);
  return `[P1 ${lang === 'zh' ? '固定风格' : 'LOCKED STYLE'}]\n${p1}\n\n[P2 ${lang === 'zh' ? '可替换主题与适配' : 'REPLACEABLE THEME AND ADAPTATION'}]\n${p2}\n\n[P3 ${lang === 'zh' ? '固定光色空间与禁令' : 'LOCKED COLOR SPACE AND GUARDS'}]\n${p3}`;
}

export function compile(profile, task) {
  validateProfile(profile); validateTask(task);
  const original = canonical(profile);
  const styleHash = hash(profile.style);
  const bridge = { category: task.category, color: profile.bridge.color, material: profile.bridge.material, space: profile.bridge.space, focus: profile.bridge.focus[task.category] };
  const templateSlot = Object.fromEntries(['subject', 'action', 'environment', 'detail', 'text', 'layout'].map(k => [k, { zh: `{{${ZH_KEYS[k]}}}`, en: `{{${k.toUpperCase()}}}` }]));
  const conciseTemplate = `【主题槽：{{主体}}，{{状态}}，{{场景}}，{{细节}}】；${profile.style.concise_zh}；画幅{{比例}}。`;
  const results = task.frames.map((frame, i) => {
    const theme = { ...frame, aspect_ratio: task.aspect_ratio, series_anchor: task.series_anchor };
    const { concise_zh: shortCore, ...publicStyle } = profile.style;
    const common = { meta: { schema_version: '1.0', id: profile.id, name: profile.name, status: profile.status, mode: task.mode, style_hash: styleHash, series_hash: hash(task.series_anchor), excluded_source_elements: profile.excluded_source_elements }, style_dna_locked: publicStyle, adaptation_bridge: bridge, theme_slot: theme };
    const concise = `${frame.subject.zh}，${frame.action.zh}，${frame.environment.zh}，${frame.detail.zh}；${profile.style.concise_zh}；画幅${task.aspect_ratio}。`;
    if (task.mode !== 'TEMPLATE' && (hanCount(concise) < 90 || hanCount(concise) > 140)) fail(`frame ${i + 1}: concise prompt must contain 90–140 Han characters; got ${hanCount(concise)}. Edit short theme or concise_zh; no silent truncation.`);
    return {
      zh_json: project(common, 'zh'), en_json: project(common, 'en'),
      zh_concise: { template: conciseTemplate, ready: task.mode === 'TEMPLATE' ? null : concise, han_count: task.mode === 'TEMPLATE' ? null : hanCount(concise), scope: '五锚点摘要；完整规则见 JSON 与自然语言版。含文字或复杂版式时使用自然语言版。' },
      natural_language: {
        zh_template: natural(profile.style, bridge, { ...templateSlot, aspect_ratio: '{{比例}}', series_anchor: task.series_anchor }, 'zh'),
        en_template: natural(profile.style, bridge, { ...templateSlot, aspect_ratio: '{{ASPECT_RATIO}}', series_anchor: task.series_anchor }, 'en'),
        zh_ready: task.mode === 'TEMPLATE' ? null : natural(profile.style, bridge, theme, 'zh'),
        en_ready: task.mode === 'TEMPLATE' ? null : natural(profile.style, bridge, theme, 'en')
      }
    };
  });
  if (canonical(profile) !== original) fail('compiler mutated profile');
  return { style_id: profile.id, style_hash: styleHash, mode: task.mode, visual_validation: 'not_run', results };
}

export function reviseRule(profile, id, replacement) {
  validateProfile(profile);
  if (!Object.hasOwn(SYSTEMS, id)) fail('unknown revision field');
  const next = structuredClone(profile);
  next.style.rules[id] = replacement;
  next.status = profile.status === 'fixture' ? 'fixture' : 'draft';
  validateProfile(next);
  return { profile: next, audit: { field: id, before: hash(profile.style), after: hash(next.style), visual_validation: 'not_run', note: '锚点摘要若受影响，应另行审核，不能宣称已完成视觉复核。' } };
}
