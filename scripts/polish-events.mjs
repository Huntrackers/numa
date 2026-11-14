import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2] || process.cwd();
for (const f of [
  'apps/web/src/App.tsx',
  'apps/web/src/pages/Company.tsx',
  'apps/web/src/pages/Employee.tsx',
  'apps/web/src/pages/Admin.tsx',
]) {
  const file = path.join(root, f);
  let code = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(f, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  function visit(n) {
    if (
      ts.isVoidExpression(n) &&
      ts.isCallExpression(n.expression) &&
      ['run', 'ctx.run', 'decide', 'ctx.decide'].includes(n.expression.expression.getText(sf))
    )
      edits.push({ start: n.expression.end, text: '.catch(()=>{})' });
    ts.forEachChild(n, visit);
  }
  visit(sf);
  for (const e of edits.sort((a, b) => b.start - a.start))
    code = code.slice(0, e.start) + e.text + code.slice(e.start);
  fs.writeFileSync(file, code);
  console.log(f, edits.length);
}
