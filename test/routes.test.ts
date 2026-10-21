/**
 * @why <Route> 선언에서 주소를 읽어 화면에 이어 주는 일(중첩 주소 이어 붙이기, lazy import·별칭 따라가기, 껍데기 파일이 진짜 화면을 불러오는 경우, 한 화면이 주소 여러 개)이 깨지지 않게 지킨다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractSpecs } from '../src/extract.js';
import { readJsxRoutes } from '../src/routes.js';
import { tempTsProject } from './helpers.js';

const screen = (name: string, route = ''): string => `/**\n * @screen ${name}\n${route ? ` * @route ${route}\n` : ''} * @why 시험용\n */\n`;

/** 라우트가 JSX로 선언된 작은 프로젝트: 별칭(@/)과 lazy import를 쓰고, 한 화면(휴가)이 껍데기 두 개로 주소 둘을 맡는다 */
function project(): { root: string; src: string } {
  const p = tempTsProject();
  fs.writeFileSync(path.join(p.root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', jsx: 'preserve', noEmit: true, baseUrl: '.', paths: { '@/*': ['src/*'] } }, include: ['src'] }));
  fs.mkdirSync(path.join(p.src, 'pages'));
  fs.writeFileSync(path.join(p.src, 'App.tsx'), `
import { lazy } from 'react';
import Home from '@/pages/Home';
import Layout from './Layout';
const Board = lazy(() => import('./pages/Board'));
const MyLeave = lazy(() => import('./pages/MyLeave'));
const TeamLeave = lazy(() => import('./pages/TeamLeave'));
const Post = lazy(() => import('./pages/Post'));
export default function App() {
  return (
    <Routes>
      <Route element={<Guard />}>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="board" element={<Outlet />}>
            <Route index element={<Board />} />
            <Route path=":postId" element={<Post />} />
          </Route>
          <Route path="hr">
            <Route path="leave" element={<MyLeave />} />
            <Route path="leave/team" element={<TeamLeave />} />
          </Route>
          <Route path="old" element={<Navigate to="/board" />} />
        </Route>
      </Route>
    </Routes>
  );
}
`);
  fs.writeFileSync(path.join(p.src, 'Layout.tsx'), 'export default function Layout() { return null; }\n');
  fs.writeFileSync(path.join(p.src, 'pages', 'Home.tsx'), screen('홈') + 'export default function Home() { return null; }\n');
  fs.writeFileSync(path.join(p.src, 'pages', 'Board.tsx'), screen('게시판') + 'export default function Board() { return null; }\n');
  fs.writeFileSync(path.join(p.src, 'pages', 'Post.tsx'), screen('게시물', '/직접/쓴/주소') + 'export default function Post() { return null; }\n');
  fs.writeFileSync(path.join(p.src, 'pages', 'LeaveView.tsx'), screen('휴가') + 'export const LeaveView = (props: { section: string }) => props.section;\n');
  fs.writeFileSync(path.join(p.src, 'pages', 'MyLeave.tsx'), `import { LeaveView } from './LeaveView';\nexport default function MyLeave() { return LeaveView({ section: 'mine' }); }\n`);
  fs.writeFileSync(path.join(p.src, 'pages', 'TeamLeave.tsx'), `import { LeaveView } from './LeaveView';\nexport default function TeamLeave() { return LeaveView({ section: 'team' }); }\n`);
  return p;
}

test('중첩된 <Route>의 주소를 이어 붙이고 index는 부모 주소로 읽는다', () => {
  const { root, src } = project();
  const byComp = Object.fromEntries(readJsxRoutes(src, root).map((r) => [r.component, r.path]));
  assert.equal(byComp.Home, '/');
  assert.equal(byComp.Board, '/board');
  assert.equal(byComp.Post, '/board/:postId');
  assert.equal(byComp.MyLeave, '/hr/leave');
  assert.equal(byComp.TeamLeave, '/hr/leave/team');
});

test('별칭·lazy import를 따라 element가 어느 파일인지 찾고, 감싸는 컴포넌트를 남긴다', () => {
  const { root, src } = project();
  const r = readJsxRoutes(src, root);
  assert.equal(r.find((x) => x.component === 'Home')?.file, path.join('pages', 'Home.tsx'));
  assert.equal(r.find((x) => x.component === 'Board')?.file, path.join('pages', 'Board.tsx'));
  assert.deepEqual(r.find((x) => x.component === 'Board')?.wrappers, ['Guard', 'Layout', 'Outlet']);
});

test('@route가 없는 화면은 <Route> 선언에서 주소를 채우고 경고도 없다', () => {
  const { src } = project();
  const out = extractSpecs(src);
  const get = (n: string) => out.screens.find((s) => s.name === n);
  assert.deepEqual(get('홈')?.routes, ['/']);
  assert.equal(get('게시판')?.route, '/board');
  assert.deepEqual(out.warnings.filter((w) => /@route가 없다/.test(w)), []);
});

test('직접 쓴 @route가 있으면 그것을 쓴다', () => {
  const { src } = project();
  assert.deepEqual(extractSpecs(src).screens.find((s) => s.name === '게시물')?.routes, ['/직접/쓴/주소']);
});

test('껍데기 파일 둘이 한 화면을 불러오면 그 화면은 주소를 둘 갖는다', () => {
  const { src } = project();
  assert.deepEqual(extractSpecs(src).screens.find((s) => s.name === '휴가')?.routes.sort(), ['/hr/leave', '/hr/leave/team']);
});

test('<Route>가 없는 프로젝트는 예전처럼 @route 경고가 난다', () => {
  const p = tempTsProject();
  fs.writeFileSync(path.join(p.src, 'a.ts'), screen('혼자') + 'export const a = 1;\n');
  assert.match(extractSpecs(p.src).warnings.join('\n'), /혼자에 @route가 없다/);
});
