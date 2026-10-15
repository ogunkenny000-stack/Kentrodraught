import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Source names and declarations only; never read local environment values.
const root = process.cwd();
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sources = files.filter(f => /\.(tsx?|[cm]?js|sql|go)$/.test(f));
const declarations = pattern => sources.flatMap(file => [...read(file).matchAll(pattern)].map(m => ({file, name:m[1]})));
const inventory = {
  generatedAt: new Date().toISOString(),
  branch: execFileSync('git', ['branch', '--show-current'], {encoding:'utf8'}).trim(),
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  components: files.filter(f => f.startsWith('src/components/') && f.endsWith('.tsx')),
  frontendRoots: ['src/main.tsx','src/App.tsx','src/AuthScreen.tsx','src/AdminPanel.tsx'],
  frontendLibraries: files.filter(f => f.startsWith('src/lib/') && !f.includes('.test.')),
  backend: files.filter(f => f.startsWith('src/server/') && !f.includes('.test.')),
  httpRoutes: [],
  websocketEvents: [...new Set([...read('src/server/onlinePlay.ts').matchAll(/case\s+["']([^"']+)["']\s*:/g)].map(m=>m[1]))].sort(),
  databaseTables: declarations(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?([\w]+)/gi),
  sqlFiles: files.filter(f => f.endsWith('.sql')),
  environmentVariableNames: [...new Set(declarations(/(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g).map(m=>m.name))].sort(),
  tests: files.filter(f => /\.test\.tsx?$|scripts\/(?:e2e\/|.*smoke|.*bench)/.test(f)),
  nativeSources: files.filter(f => f.startsWith('nd_upgraded/') && /\.(cpp|hpp)$/.test(f)),
  deployment: ['Dockerfile','docker-compose.yml','.dockerignore','go-edge/go.mod','go-edge/main.go','scripts/start-go-edge.sh'],
};
inventory.httpRoutes = [...read('server.ts').matchAll(/app\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)/g)].map(m=>({method:m[1].toUpperCase(),path:m[2]}));
for (const [file,prefix] of [
  ['accountAuth.ts','/api/auth'], ['tournamentInvites.ts','/api/tournaments'],
  ['tournamentRuntime.ts','/api/tournaments'], ['mediaConfig.ts','/api/media'],
]) inventory.httpRoutes.push(...[...read('src/server/'+file).matchAll(/router\.(get|post|put|patch|delete)\s*\(\s*["']([^"']+)/g)].map(m=>({method:m[1].toUpperCase(),path:prefix+m[2]})));
fs.mkdirSync(path.join(root,'docs/audit'),{recursive:true});
fs.writeFileSync(path.join(root,'docs/audit/inventory.json'),JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify({components:inventory.components.length,routes:inventory.httpRoutes.length,websocketEvents:inventory.websocketEvents.length,sqlFiles:inventory.sqlFiles.length}));
