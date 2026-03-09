const fs = require('fs');
const filePath = 'c:/Users/YASSINE BERKAOUI/Desktop/sonic-speakerbox/streaming-server/server.js';
let code = fs.readFileSync(filePath, 'utf8');

code = code.replace(/function liqCmd[\s\S]+?return new Promise[\s\S]+?\}\);\n\}/, 
`class LiqQueue {
  constructor() { this.q = []; this.busy = false; }
  exec(command) {
    return new Promise(resolve => {
      this.q.push({ command, resolve });
      this.next();
    });
  }
  next() {
    if (this.busy || !this.q.length) return;
    this.busy = true;
    const { command, resolve } = this.q.shift();
    const client = new require('net').Socket();
    let response = '';
    client.setTimeout(3000);
    const done = (res) => {
      client.destroy();
      resolve(res);
      this.busy = false;
      setTimeout(() => this.next(), 20);
    };
    client.on('error', e => done(''));
    client.on('timeout', () => done(''));
    client.connect(LIQ_TELNET, LIQ_HOST, () => client.write(command + '\\r\\nexit\\r\\n'));
    client.on('data', d => response += d.toString());
    client.on('close', () => done(response.trim()));
  }
}
const liqDispatcher = new LiqQueue();
function liqCmd(command) { return liqDispatcher.exec(command); }`);

code = code.replace(/amp_music_\$\{deck\}\.set 1\./g, 'var.set vol_${deck} = 1.');
code = code.replace(/amp_music_\$\{deck\}\.set 0\./g, 'var.set vol_${deck} = 0.');
code = code.replace(/amp_music_\$\{d\}\.set \$\{volume\}/g, 'var.set vol_${d} = ${volume}');

fs.writeFileSync(filePath, code);
console.log('Patched server.js successfully!');
