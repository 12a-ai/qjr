import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compile } from './engine.mjs';

const [profilePath, taskPath, outputPath] = process.argv.slice(2);
if (!profilePath || !taskPath || !outputPath || process.argv.length !== 5) {
  console.error('Usage: node src/cli.mjs <profile.json> <task.json> <new-output-directory>');
  process.exitCode = 1;
} else {
  try {
    const parse = async p => JSON.parse((await readFile(resolve(p), 'utf8')).replace(/^\uFEFF/, ''));
    const output = compile(await parse(profilePath), await parse(taskPath));
    const root = resolve(outputPath);
    // Exclusive creation prevents overwriting previous prompt archives.
    await mkdir(root);
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...output, results: undefined }, null, 2) + '\n');
    for (const [i, r] of output.results.entries()) {
      const dir = join(root, `frame-${String(i + 1).padStart(2, '0')}`);
      await mkdir(dir);
      await writeFile(join(dir, '01-zh.json'), JSON.stringify(r.zh_json, null, 2) + '\n');
      await writeFile(join(dir, '02-en.json'), JSON.stringify(r.en_json, null, 2) + '\n');
      await writeFile(join(dir, '03-中文简易.txt'), `通用母版\n${r.zh_concise.template}\n\n即用版\n${r.zh_concise.ready ?? '纯母版模式，不虚构主题'}\n\n${r.zh_concise.scope}\n`);
      await writeFile(join(dir, '04-自然语言.txt'), Object.entries(r.natural_language).filter(([, v]) => v !== null).map(([k, v]) => `${k}\n${v}`).join('\n\n') + '\n');
    }
    console.log(JSON.stringify({ output: root, frames: output.results.length, style_hash: output.style_hash, visual_validation: output.visual_validation }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
