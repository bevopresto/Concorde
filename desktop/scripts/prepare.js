/* Copies the Concorde app files into desktop/app and keeps the installer version in step with js/version.js. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), dest = path.join(__dirname, '..', 'app');
fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
['index.html', 'css', 'js', 'assets'].forEach((n) => fs.cpSync(path.join(root, n), path.join(dest, n), { recursive: true }));
const vsrc = fs.readFileSync(path.join(root, 'js', 'version.js'), 'utf8');
const m = /number:\s*'([^']+)'/.exec(vsrc);
if (!m) throw new Error('Could not read the version number from js/version.js');
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = m[1];
if (process.env.GITHUB_REPOSITORY) {
  pkg.repository = { type: 'git', url: 'https://github.com/' + process.env.GITHUB_REPOSITORY + '.git' };
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('Prepared Concorde v' + m[1]);
