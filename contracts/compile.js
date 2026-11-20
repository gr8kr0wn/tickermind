// Compiles every contract in contracts/src with solc-js (no Foundry needed, works on Termux).
// Output: contracts/build/<Name>.json  ->  { abi, bytecode }
const fs = require('fs');
const path = require('path');
const solc = require('solc');

function compile() {
  const srcDir = path.join(__dirname, 'src');
  const sources = {};
  for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith('.sol'))) {
    sources[f] = { content: fs.readFileSync(path.join(srcDir, f), 'utf8') };
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  (out.errors || []).filter((e) => e.severity !== 'error').forEach((w) => console.warn(w.formattedMessage));
  if (errors.length) {
    errors.forEach((e) => console.error(e.formattedMessage));
    throw new Error('Solidity compilation failed');
  }
  const buildDir = path.join(__dirname, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const result = {};
  for (const file of Object.keys(out.contracts)) {
    for (const name of Object.keys(out.contracts[file])) {
      const c = out.contracts[file][name];
      const artifact = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
      fs.writeFileSync(path.join(buildDir, name + '.json'), JSON.stringify(artifact, null, 2));
      result[name] = artifact;
    }
  }
  return result;
}

if (require.main === module) {
  const r = compile();
  console.log('Compiled:', Object.keys(r).join(', '));
}
module.exports = { compile };
