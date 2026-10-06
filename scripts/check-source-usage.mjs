import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceExtension = /\.(?:[cm]?ts|[cm]?js|vue)$/;
const isTest = (file) => /(?:^|[/\\])test[/\\]|\.(?:test|spec)\.[cm]?ts$/.test(file);
function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'generated'].includes(entry.name)) return [];
    const file = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : sourceExtension.test(file) ? [file] : [];
  });
}
const files = ['apps', 'packages', 'scripts', 'tools'].flatMap((folder) =>
  filesIn(resolve(root, folder)),
);
const sourceFiles = files.filter(
  (file) => /[/\\]src[/\\]/.test(file) && !isTest(file) && !file.endsWith('.d.ts'),
);
const fileSet = new Set(files);
const unresolved = new Set();
const packages = new Map(
  readdirSync(resolve(root, 'packages')).map((folder) => {
    const directory = resolve(root, 'packages', folder);
    const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    return [manifest.name, resolve(directory, manifest.main)];
  }),
);

function targetFor(specifier, importer) {
  if (packages.has(specifier)) return packages.get(specifier);
  if (!specifier.startsWith('.')) return undefined;
  const target = resolve(dirname(importer), specifier);
  return [
    target,
    target.replace(/\.js$/, '.ts'),
    target.replace(/\.mjs$/, '.mts'),
    target + '.ts',
    resolve(target, 'index.ts'),
  ].find((file) => fileSet.has(file));
}
function references(file) {
  const text = readFileSync(file, 'utf8');
  const code =
    extname(file) === '.vue'
      ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
          .map((match) => match[1])
          .join('\n')
      : text;
  const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const references = [];
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      specifier = node.moduleSpecifier;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      specifier = node.arguments[0];
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL'
    )
      specifier = node.arguments?.[0];
    if (specifier && ts.isStringLiteral(specifier)) {
      const target = targetFor(specifier.text, file);
      if (target) references.push(target);
      else if (specifier.text.startsWith('.') && sourceExtension.test(specifier.text))
        unresolved.add(`${relative(root, file)} -> ${specifier.text}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return references;
}
const entrypoints = [
  resolve(root, 'apps/web/src/main.ts'),
  resolve(root, 'apps/api/src/main.ts'),
  ...files.filter((file) => !/[/\\]src[/\\]/.test(file) && !isTest(file)),
];
const reachable = new Set();
function visit(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const target of references(file)) visit(target);
}
entrypoints.forEach(visit);
const unused = sourceFiles.filter((file) => !reachable.has(file));
if (unresolved.size) {
  console.error('Local source imports point to missing files:');
  unresolved.forEach((reference) => console.error('  ' + reference));
  process.exitCode = 1;
}
if (unused.length) {
  console.error('Source files unreachable from application and tool entrypoints:');
  unused.forEach((file) => console.error('  ' + relative(root, file)));
  process.exitCode = 1;
} else if (!unresolved.size) {
  console.log(`Source usage passed: ${sourceFiles.length} production source files are reachable.`);
}
