'use strict';

/**
 * Accounts for the dashboard.
 *
 *   node tools/user.js add krish          add or replace an account, asking for the password
 *   node tools/user.js add krish hunter2  same, password on the command line (it lands in your shell history)
 *   node tools/user.js list               who has an account
 *   node tools/user.js remove krish       take an account away
 *   node tools/user.js export             users.json on one line, to paste into the host's UNISIS_USERS
 *   node tools/user.js google <id>        set the Google client id (sign-in with Google turns on)
 *   node tools/user.js allow <email>      let that address in; @a-domain.com lets everyone there in
 *   node tools/user.js deny <email>       take it off the list
 *   node tools/user.js config             what Google sign-in is set to
 *
 * Accounts live in users.json next to server.js. Keep that file off git: it holds the
 * password hashes, and anyone with it can try passwords against them offline.
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const auth = require('../auth.js');

const [cmd, name, passwordArg] = process.argv.slice(2);

function askPassword(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Hide the typing: the prompt is written once, keystrokes are not echoed back.
    const onData = () => rl.output.write(`\x1b[2K\r${prompt}`);
    rl.input.on('data', onData);
    rl.question(prompt, (answer) => {
      rl.input.off('data', onData);
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

(async () => {
  if (cmd === 'add') {
    if (!name) return fail('Which account? e.g. node tools/user.js add krish');
    const password = passwordArg || (await askPassword(`Password for ${name}: `));
    if (password.length < 8) return fail('Use at least 8 characters.');
    auth.addUser(name, password);
    console.log(`${name} can now sign in.`);
    return;
  }
  if (cmd === 'remove') {
    if (!name) return fail('Which account? e.g. node tools/user.js remove krish');
    console.log(auth.removeUser(name) ? `${name} can no longer sign in.` : `No account called ${name}.`);
    return;
  }
  if (cmd === 'list') {
    const users = auth.listUsers();
    if (!users.length) return console.log('No accounts yet. Add one: node tools/user.js add <name>');
    users.forEach((u) => console.log(`${u.name.padEnd(16)} added ${u.added}`));
    return;
  }
  if (cmd === 'export') {
    const file = path.join(__dirname, '..', 'users.json');
    if (!fs.existsSync(file)) return fail('No users.json yet. Add an account first.');
    console.log(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))));
    return;
  }
  if (cmd === 'google') {
    if (!name) return fail('Paste the client id from Google Cloud: node tools/user.js google 123....apps.googleusercontent.com');
    const conf = auth.config();
    auth.writeConfig({ googleClientId: name.trim(), allowed: conf.allowed });
    console.log('Google sign-in is on. Now allow an address: node tools/user.js allow you@example.com');
    return;
  }
  if (cmd === 'allow' || cmd === 'deny') {
    if (!name) return fail(`Which address? e.g. node tools/user.js ${cmd} krish@bookends.co.in`);
    const conf = auth.config();
    const who = name.trim().toLowerCase();
    const allowed = conf.allowed.filter((a) => a.toLowerCase() !== who);
    if (cmd === 'allow') allowed.push(who);
    auth.writeConfig({ googleClientId: conf.googleClientId, allowed });
    console.log(cmd === 'allow' ? `${who} can sign in with Google.` : `${who} can no longer sign in with Google.`);
    return;
  }
  if (cmd === 'config') {
    const conf = auth.config();
    console.log(conf.googleClientId ? `Google client id: ${conf.googleClientId}` : 'Google sign-in is off (no client id).');
    console.log(conf.allowed.length ? `Allowed: ${conf.allowed.join(', ')}` : 'Nobody is allowed yet.');
    return;
  }
  fail('Usage: node tools/user.js add|remove|list|export|google|allow|deny|config [name] [password]');
})();

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}
