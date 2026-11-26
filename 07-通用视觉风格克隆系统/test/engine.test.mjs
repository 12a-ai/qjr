import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compile, validateProfile, validateTask, reviseRule, SYSTEMS, CATEGORIES, canonical, hash, hanCount } from '../src/engine.mjs';
const load = async name => JSON.parse(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
const base = await load('fixture-profile');
const sw = await load('task-switch');
const tr = await load('task-transfer');
const ex = await load('task-expand');
const tp = await load('task-template');
const clone = structuredClone;

test('13 systems and five distinct anchors are explicit', () => {
  assert.equal(Object.keys(SYSTEMS).length, 13);
  assert.equal(validateProfile(base).style.anchors.length, 5);
});
test('four outputs compile from one source and contain all rules', () => {
  const r = compile(base, sw).results[0];
  assert.deepEqual(Object.keys(r), ['zh_json', 'en_json', 'zh_concise', 'natural_language']);
  for (const id of Object.keys(SYSTEMS)) {
    assert.equal(r.en_json.style_dna_locked.rules[id].description, base.style.rules[id].en);
    assert.equal(r.zh_json['风格基因锁死区']['分系统规则'][id]['描述'], base.style.rules[id].zh);
    assert.ok(r.natural_language.en_ready.includes(base.style.rules[id].en));
    assert.ok(r.natural_language.zh_ready.includes(base.style.rules[id].zh));
  }
  assert.deepEqual(r.en_json.style_dna_locked.parameters.palette.map(c => c.ratio), [.65, .25, .1]);
  assert.deepEqual(r.zh_json['风格基因锁死区']['共享数值参数']['调色板'].map(c => c['比例']), [.65, .25, .1]);
  assert.equal(r.zh_concise.han_count, hanCount(r.zh_concise.ready));
});
test('SWITCH preserves source and style hash', () => {
  const before = canonical(base);
  assert.equal(compile(base, sw).style_hash, hash(base.style));
  assert.equal(canonical(base), before);
});
test('EXPAND freezes style and series anchors in every frame', () => {
  const r = compile(base, ex);
  assert.equal(r.results.length, 3);
  assert.equal(new Set(r.results.map(v => v.en_json.meta.style_hash)).size, 1);
  assert.equal(new Set(r.results.map(v => v.en_json.meta.series_hash)).size, 1);
  assert.equal(r.visual_validation, 'not_run');
});
test('TRANSFER changes category and subject while keeping style', () => {
  const a = compile(base, sw).results[0]; const b = compile(base, tr).results[0];
  assert.deepEqual(a.en_json.style_dna_locked, b.en_json.style_dna_locked);
  assert.notEqual(a.en_json.adaptation_bridge.focus, b.en_json.adaptation_bridge.focus);
  assert.equal(b.en_json.theme_slot.text, '山');
});
test('TEMPLATE contains reusable slots without invented ready prompts', () => {
  const r = compile(base, tp).results[0];
  assert.ok(r.zh_concise.template.includes('{{主体}}'));
  assert.ok(r.natural_language.en_template.includes('{{SUBJECT}}'));
  assert.equal(r.zh_concise.ready, null);
  assert.equal(r.natural_language.en_ready, null);
});
test('natural language P1 and P3 remain identical between themes and modes', () => {
  for (const lang of ['zh', 'en']) {
    const a = compile(base, sw).results[0].natural_language[`${lang}_ready`].split(/\n\n/);
    const b = compile(base, tr).results[0].natural_language[`${lang}_ready`].split(/\n\n/);
    assert.equal(a[0], b[0]); assert.equal(a[2], b[2]); assert.notEqual(a[1], b[1]);
  }
});
for (const category of CATEGORIES) test(`category ${category} selects explicit translation bridge`, () => {
  const t = clone(sw); t.category = category;
  const r = compile(base, t).results[0];
  assert.equal(r.en_json.adaptation_bridge.focus, base.bridge.focus[category].en);
  for (const k of ['color','material','space','focus']) assert.ok(r.natural_language.zh_ready.includes(r.zh_json['主题自适应转译桥'][{color:'色域转译', material:'材质转译', space:'空间转译', focus:'细节重心'}[k]]));
});
test('revision changes exactly one system and gives before/after hashes', () => {
  const rule = clone(base.style.rules.C2); rule.zh += '焦点保持清晰。'; rule.en += ' Keep the focal edge crisp.';
  const result = reviseRule(base, 'C2', rule);
  assert.notEqual(result.audit.before, result.audit.after);
  for (const id of Object.keys(SYSTEMS).filter(x => x !== 'C2')) assert.deepEqual(result.profile.style.rules[id], base.style.rules[id]);
  assert.equal(base.style.rules.C2.zh.includes('焦点保持清晰'), false);
});
const invalidProfiles = [
 ['missing subsystem', p => delete p.style.rules.C2, /invalid fields/],
 ['extra subsystem', p => p.style.rules.Z9 = p.style.rules.C2, /invalid fields/],
 ['untranslated field', p => p.style.rules.B1.en = '', /requires zh and en/],
 ['bilingual number mismatch', p => p.style.rules.B1.zh += '占比70%', /numbers differ/],
 ['palette sum', p => p.style.parameters.palette[0].ratio = .5, /sum to 1/],
 ['negative palette ratio', p => p.style.parameters.palette[0].ratio = -.2, /invalid palette/],
 ['malformed hex', p => p.style.parameters.palette[0].hex = '#XX', /invalid palette/],
 ['duplicate palette color', p => p.style.parameters.palette[1].hex = p.style.parameters.palette[0].hex, /duplicate palette/],
 ['range order', p => p.style.parameters.negative_space = [.8,.2], /invalid range/],
 ['range overflow', p => p.style.parameters.subject_area = [0,2], /invalid range/],
 ['temperature invalid', p => p.style.parameters.light_temperature_k = [-20,3000], /temperature/],
 ['duplicate anchors', p => p.style.anchors[0] = 'B1', /five distinct/],
 ['unknown anchor', p => p.style.anchors[0] = 'Z1', /five distinct/],
 ['source content pollution', p => p.style.rules.C1.zh += '原图测试旧舟', /leaks into style/],
 ['fake observation', p => p.style.rules.A1.kind = 'observation', /viewed source/],
 ['invalid confidence', p => p.style.rules.A1.confidence = 2, /confidence/],
 ['missing source', p => p.style.rules.A1.source_ids = ['MISSING'], /unknown source/],
 ['duplicate source ids', p => p.sources.push(clone(p.sources[0])), /duplicate source/],
 ['unseen reviewed source', p => p.status = 'reviewed', /reviewed source/],
 ['unknown state', p => p.style.rules.C1.state = 'invented', /invalid state/],
 ['unknown evidence kind', p => p.style.rules.C1.kind = 'fact', /evidence kind/],
 ['placeholder in style', p => p.style.rules.C1.zh += '{{主题}}', /placeholders/],
 ['missing bridge category', p => delete p.bridge.focus.poster, /invalid fields/],
 ['too long concise core', p => p.style.concise_zh = '汉'.repeat(106), /50–105/],
 ['empty negative', p => p.style.negative = [], /negative guards/]
];
for (const [name, change, expected] of invalidProfiles) test(`reject profile: ${name}`, () => {
  const p = clone(base); change(p); assert.throws(() => validateProfile(p), expected);
});
const invalidTasks = [
 ['unknown mode', t => t.mode = 'DRAW', /invalid mode/],
 ['unknown category', t => t.category = 'guess', /category/],
 ['zero ratio', t => t.aspect_ratio = '0:4', /aspect ratio/],
 ['non-numeric ratio', t => t.aspect_ratio = 'wide', /aspect ratio/],
 ['empty frame list', t => t.frames = [], /1–9/],
 ['too many frames', t => t.frames = Array(10).fill(t.frames[0]), /1–9/],
 ['SWITCH multiple frames', t => t.frames.push(clone(t.frames[0])), /only EXPAND/],
 ['EXPAND single frame', t => t.mode = 'EXPAND', /at least two/],
 ['unresolved theme', t => t.frames[0].subject = {zh:'{{主体}}',en:'{{SUBJECT}}'}, /unresolved/],
 ['unexpected style override', t => t.style = {}, /invalid fields/],
 ['missing field', t => delete t.frames[0].environment, /invalid fields/]
];
for (const [name, change, expected] of invalidTasks) test(`reject task: ${name}`, () => {
  const t = clone(sw); change(t); assert.throws(() => validateTask(t), expected);
});
test('overlong concise output fails without truncating user text', () => {
  const t = clone(sw); t.frames[0].subject.zh = '长'.repeat(150);
  assert.throws(() => compile(base, t), /90–140/);
});
test('multicolor styles allow multiple colors in each palette role', () => {
  const p = clone(base);
  p.style.parameters.palette[0].ratio = .55;
  p.style.parameters.palette.push({role:'dominant',hex:'#E2D8C5',ratio:.1});
  assert.equal(validateProfile(p).style.parameters.palette.length,4);
  assert.equal(compile(p,sw).results[0].en_json.style_dna_locked.parameters.palette.length,4);
});
test('invalid input fails before creating output; CLI exports files and refuses overwrite', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'qjr-style-'));
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const profile = fileURLToPath(new URL('../examples/fixture-profile.json', import.meta.url));
  const task = fileURLToPath(new URL('../examples/task-switch.json', import.meta.url));
  const target = join(temp, 'out');
  const run = spawnSync(process.execPath, [cli, profile, task, target], {encoding:'utf8'});
  assert.equal(run.status, 0, run.stderr);
  for (const f of ['01-zh.json','02-en.json','03-中文简易.txt','04-自然语言.txt']) await access(join(target,'frame-01',f));
  assert.equal(spawnSync(process.execPath, [cli, profile, task, target]).status, 1);
  const bad = join(temp, 'bad');
  assert.equal(spawnSync(process.execPath, [cli, join(temp,'missing.json'), task, bad]).status, 1);
  await assert.rejects(access(bad));
});

test('archived four-version samples exactly match current compiler', async () => {
  for (const mode of ['template', 'switch', 'expand', 'transfer']) {
    const output = compile(base, await load(`task-${mode}`));
    const archived = JSON.parse(await readFile(new URL(`../examples/outputs/${mode}/manifest.json`, import.meta.url),'utf8'));
    assert.deepEqual(archived, JSON.parse(JSON.stringify({...output,results:undefined})));
    for (const [i,r] of output.results.entries()) {
      const dir = `../examples/outputs/${mode}/frame-${String(i+1).padStart(2,'0')}/`;
      for (const [f,data] of [['01-zh.json',r.zh_json],['02-en.json',r.en_json]]) {
        assert.deepEqual(JSON.parse(await readFile(new URL(dir+f,import.meta.url),'utf8')),data);
      }
      const short = await readFile(new URL(dir+'03-中文简易.txt',import.meta.url),'utf8');
      assert.ok(short.includes(r.zh_concise.template));
      if(r.zh_concise.ready) assert.ok(short.includes(r.zh_concise.ready));
      const natural = await readFile(new URL(dir+'04-自然语言.txt',import.meta.url),'utf8');
      for (const value of Object.values(r.natural_language).filter(v=>v!==null)) assert.ok(natural.includes(value));
    }
  }
});
