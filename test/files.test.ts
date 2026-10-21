/**
 * @why 화면에 속한 컴포넌트를 찾는 기준(import로 닿는 파일)이 별칭(@/…) import까지 따라가는지 지킨다. 별칭을 쓰는 프로젝트에서 이것이 빠지면 대부분의 컴포넌트가 어느 화면에도 속하지 않게 된다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { screenFiles } from '../src/files.js';
import { tempProject } from './helpers.js';

test('상대 경로와 tsconfig paths 별칭 import를 모두 따라간다(주석·끝 쉼표가 있는 tsconfig도 읽는다)', () => {
  const { root, src } = tempProject();
  fs.writeFileSync(path.join(root, 'tsconfig.json'), `{\n  /* 별칭 */\n  "compilerOptions": {\n    "baseUrl": ".",\n    // 한 줄 주석\n    "paths": { "@/*": ["./src/*"], },\n    /* 별칭 뒤에도 주석이 있다 */\n    "strict": true,\n  },\n}\n`);
  fs.mkdirSync(path.join(src, 'ui')); fs.mkdirSync(path.join(src, 'lib'));
  fs.writeFileSync(path.join(src, 'Page.tsx'), `import { A } from '@/ui/A';\nimport { b } from './lib/b';\nimport x from 'react';\nconst L = lazy(() => import('@/ui/Lazy'));\n`);
  fs.writeFileSync(path.join(src, 'ui', 'A.tsx'), `import { c } from '@/lib/c';\nexport const A = 1;\n`);
  fs.writeFileSync(path.join(src, 'ui', 'Lazy.tsx'), 'export default 1;\n');
  fs.writeFileSync(path.join(src, 'lib', 'b.ts'), 'export const b = 1;\n');
  fs.writeFileSync(path.join(src, 'lib', 'c.ts'), 'export const c = 1;\n');
  const got = screenFiles(path.join(src, 'Page.tsx')).map((f) => path.relative(src, f)).sort();
  assert.deepEqual(got, ['Page.tsx', path.join('lib', 'b.ts'), path.join('lib', 'c.ts'), path.join('ui', 'A.tsx'), path.join('ui', 'Lazy.tsx')]);
});

test('tsconfig가 없으면 별칭은 따라가지 않고 상대 경로만 따라간다', () => {
  const { src } = tempProject();
  fs.writeFileSync(path.join(src, 'Page.tsx'), `import { A } from '@/A';\nimport { b } from './b';\n`);
  fs.writeFileSync(path.join(src, 'A.ts'), 'export const A = 1;\n');
  fs.writeFileSync(path.join(src, 'b.ts'), 'export const b = 1;\n');
  assert.deepEqual(screenFiles(path.join(src, 'Page.tsx')).map((f) => path.basename(f)).sort(), ['Page.tsx', 'b.ts']);
});
